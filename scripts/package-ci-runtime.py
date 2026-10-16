"""Package a completed CI build, without credentials, dependencies or user data."""
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import stat
import subprocess
import sys
import tarfile

PUBLIC_ENV = ('NEXT_PUBLIC_BASE_PATH', 'NEXT_PUBLIC_DOMAIN', 'NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN')
ROOT_FILES = {'package.json', 'pnpm-lock.yaml', 'next.config.ts', 'tsconfig.json',
              'postcss.config.mjs', 'components.json', '.npmrc'}
# These repository-only providers are absent from the verified production profile.
EXCLUDED_SOURCES = {'src/app/api/account/provider-profile/route.ts',
                    'src/components/account/BailianProviderButton.tsx',
                    'src/components/studio/ImagePptGenerationFeedback.tsx',
                    'src/lib/bailian-provider-profile.ts', 'src/lib/bailian-qwen-tts.ts',
                    'src/lib/bailian-wan-image.ts', 'scripts/test-bailian-byok.ts'}


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def runtime_file(name):
    parts = Path(name).parts
    if parts[0] != '.next':
        return False
    return not (set(parts) & {'cache', 'dev', 'types', 'diagnostics', 'node_modules'}
                or name.endswith('.map') or parts[-1].startswith('trace'))


def prepare(root):
    if os.environ.get('CI') != 'true' or root.resolve() != Path(os.environ['GITHUB_WORKSPACE']).resolve():
        raise ValueError('Source quarantine is restricted to the disposable CI checkout')
    quarantine = Path(os.environ['RUNNER_TEMP']).resolve() / 'knowtrail-unreleased-source'
    if quarantine.is_relative_to(root.resolve()):
        raise ValueError('CI quarantine must be outside the build workspace')
    for name in sorted(EXCLUDED_SOURCES):
        path = root / name
        original = subprocess.check_output(['git', 'show', 'HEAD:' + name], cwd=root)
        if path.is_symlink() or path.read_bytes() != original:
            raise ValueError('Refusing to move a modified source file')
        saved = quarantine / name
        saved.parent.mkdir(parents=True, exist_ok=True)
        saved.write_bytes(original)
        path.unlink()
    print(json.dumps({'productionProfile': True, 'repositoryOnlySourcesQuarantined': sorted(EXCLUDED_SOURCES)}))


def package(root, output):
    for name in ['.next/BUILD_ID', 'dist/server.js', '.next/required-server-files.json']:
        if not (root / name).is_file():
            raise ValueError(f'Missing completed build output: {name}')
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    names = {n for n in tracked if n and (n in ROOT_FILES or n.startswith(
        ('src/', 'scripts/', 'services/research-agent/', 'public/')))}
    if any((root / n).exists() for n in EXCLUDED_SOURCES):
        raise ValueError('Build the current production source profile before packaging')
    names.difference_update(EXCLUDED_SOURCES)
    names = {n for n in names if not any(p.startswith('.env') for p in Path(n).parts)
             and not set(Path(n).parts) & {'uploads', 'mineru-figures', '__pycache__'}}
    names.update(p.relative_to(root).as_posix() for tree in ['.next', 'dist']
                 for p in (root / tree).rglob('*') if p.is_file()
                 and not p.name.endswith('.map')
                 and (tree == 'dist' or runtime_file(p.relative_to(root).as_posix())))
    files = []
    for name in sorted(names):
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'Runtime inputs must be regular files: {name}')
        files.append({'path': name, 'size': path.stat().st_size,
                      'mode': stat.S_IMODE(path.stat().st_mode), 'sha256': sha(path)})
    manifest = {'schema': 1, 'commit': subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
        'tree': subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=root, text=True).strip(),
        'buildId': (root / '.next/BUILD_ID').read_text().strip(),
        'node': subprocess.check_output(['node', '--version'], text=True).strip(),
        'platform': platform.system(), 'machine': platform.machine(),
        'publicEnv': {k: os.environ.get(k, '') for k in PUBLIC_ENV},
        'excludedSources': sorted(EXCLUDED_SOURCES), 'files': files}
    pkg = json.loads((root / 'package.json').read_text())
    manifest['dependencySha256'] = hashlib.sha256(json.dumps({k: pkg.get(k) for k in (
        'dependencies', 'devDependencies', 'packageManager', 'engines')}, sort_keys=True).encode()).hexdigest()
    encoded = (json.dumps(manifest, indent=2) + '\n').encode()
    with tarfile.open(str(output) + '.tar.gz', 'x:gz', dereference=True) as archive:
        info = tarfile.TarInfo('CI_RUNTIME_MANIFEST.json')
        info.size = len(encoded)
        archive.addfile(info, io.BytesIO(encoded))
        for entry in files:
            if sha(root / entry['path']) != entry['sha256']:
                raise ValueError('Build changed while packaging')
            archive.add(root / entry['path'], arcname=entry['path'], recursive=False)
    Path(str(output) + '.manifest.json').write_bytes(encoded)
    print(json.dumps({'ok': True, 'buildId': manifest['buildId'], 'commit': manifest['commit'],
                      'files': len(files), 'runtimeBytes': sum(f['size'] for f in files),
                      'manifestSha256': hashlib.sha256(encoded).hexdigest()}))


if __name__ == '__main__':
    if sys.argv[1] == '--prepare':
        prepare(Path.cwd())
    else:
        package(Path.cwd(), Path(sys.argv[1]).resolve())
