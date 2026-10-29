"""Import one verified CI tar stream into a new sibling release; never activate it."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile

FLOOR = 10_000_000_000
RESERVE = 0
ROOT_FILES = {'package.json', 'pnpm-lock.yaml', 'next.config.ts', 'tsconfig.json',
              'postcss.config.mjs', 'components.json', '.npmrc'}


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate(manifest):
    if manifest.get('schema') != 1 or not manifest.get('buildId'):
        raise ValueError('Unsupported or incomplete manifest')
    entries = {}
    for entry in manifest['files']:
        name = entry['path']
        parts = PurePosixPath(name).parts
        allowed = name in ROOT_FILES or name.startswith((
            '.next/', 'dist/', 'public/', 'src/', 'scripts/', 'services/research-agent/'))
        if (not allowed or not parts or PurePosixPath(name).as_posix() != name
                or '\\' in name or '..' in parts or name in entries
                or any(p.startswith('.env') for p in parts)
                or set(parts) & {'.data', '.logs', 'logs', 'uploads', 'mineru-figures',
                                 'node_modules', '__pycache__', 'cache'}):
            raise ValueError(f'Unsafe or duplicate runtime path: {name}')
        if (entry['size'] < 0 or entry['mode'] not in (0o644, 0o755)
                or not re.fullmatch(r'[a-f0-9]{64}', entry['sha256'])):
            raise ValueError(f'Invalid file descriptor: {name}')
        entries[name] = entry
    if not {'.next/BUILD_ID', 'dist/server.js', 'package.json', 'pnpm-lock.yaml'} <= entries.keys():
        raise ValueError('Incomplete runtime')
    if sum(e['size'] for e in entries.values()) > 256_000_000:
        raise ValueError('Unexpected runtime size; inspect before importing')
    return entries


def immutable(name):
    return not name.startswith('.next/') or name.startswith('.next/static/') or name.endswith(('.js', '.map'))


def import_runtime(base, target, stream, expected_sha):
    base = base.resolve(strict=True)
    if target.exists() or target.is_symlink() or target.parent.resolve() != base.parent:
        raise ValueError('Destination must be a new sibling of the current release')
    target = target.parent.resolve() / target.name
    with tarfile.open(fileobj=stream, mode='r|gz') as archive:
        first = archive.next()
        if first.name != 'CI_RUNTIME_MANIFEST.json' or not first.isfile() or first.size > 4_000_000:
            raise ValueError('Missing leading manifest')
        encoded = archive.extractfile(first).read()
        if hashlib.sha256(encoded).hexdigest() != expected_sha:
            raise ValueError('Manifest does not match the trusted CI artifact')
        manifest = json.loads(encoded)
        entries = validate(manifest)
        if (manifest['platform'] != 'Linux' or manifest['machine'] != os.uname().machine
                or manifest['node'] != subprocess.check_output(['node', '--version'], text=True).strip()):
            raise ValueError('CI and deployed runtime differ')
        if sha(base / 'pnpm-lock.yaml') != entries['pnpm-lock.yaml']['sha256']:
            raise ValueError('Dependency change requires a separate dependency rollout')
        pkg = json.loads((base / 'package.json').read_text())
        dependency_hash = hashlib.sha256(json.dumps({k: pkg.get(k) for k in (
            'dependencies', 'devDependencies', 'packageManager', 'engines')}, sort_keys=True).encode()).hexdigest()
        if dependency_hash != manifest['dependencySha256']:
            raise ValueError('Dependency specification differs from the verified current tree')
        env = dict(line.split('=', 1) for line in (base / '.env.production').read_text().splitlines()
                   if line.startswith('NEXT_PUBLIC_') and '=' in line)
        if any(env.get(k, '').strip('"\'') != v for k, v in manifest['publicEnv'].items()):
            raise ValueError('Public build configuration differs from production')
        deps = (base / 'node_modules').resolve(strict=True)
        if stat.S_IMODE(deps.stat().st_mode) & 0o022:
            raise ValueError('Dependencies are writable by other users')
        index = {}
        for prefix in ['.next', 'dist', 'public', 'src', 'scripts', 'services/research-agent']:
            for path in (base / prefix).rglob('*'):
                relative = path.relative_to(base)
                if (path.is_symlink() or not path.is_file() or not immutable(relative.as_posix())
                        or set(relative.parts) & {'cache', 'node_modules', 'uploads', 'mineru-figures', '__pycache__'}):
                    continue
                if path.resolve().is_relative_to(base):
                    index[(path.stat().st_size, stat.S_IMODE(path.stat().st_mode), sha(path))] = path
        reusable = {name: index.get((e['size'], e['mode'], e['sha256'])) if immutable(name) else None
                    for name, e in entries.items()}
        public = (base / 'public').resolve()
        public_entries = {n: e for n, e in entries.items() if n.startswith('public/')}
        public_files = list(public.rglob('*')) if public.exists() else []
        borrow_public = bool(public_entries) and public.is_relative_to(base.parent) and not any(
            p.is_symlink() and p.is_dir() for p in public_files)
        if borrow_public:
            existing = {p.relative_to(public).as_posix(): p.resolve() for p in public_files if p.is_file()}
            borrow_public = existing.keys() == {n[7:] for n in public_entries} and all(
                p.is_relative_to(base.parent) and p.stat().st_uid == os.getuid() and p.stat().st_gid == os.getgid()
                and sha(p) == public_entries['public/' + name]['sha256']
                for name, p in existing.items())
        if borrow_public:
            reusable.update({n: existing[n[7:]] for n in public_entries})
        retained_static = [p for p in (base / '.next/static').rglob('*') if p.is_file()
                           and not p.is_symlink() and p.suffix != '.map'
                           and p.relative_to(base).as_posix() not in entries]
        needed = sum(((e['size'] + 4095) // 4096) * 4096 for n, e in entries.items() if not reusable[n])
        paths = list(entries) + [p.relative_to(base).as_posix() for p in retained_static]
        directories = {str(parent) for name in paths for parent in PurePosixPath(name).parents}
        needed += len(directories) * 4096 + len(paths) * 512 + 2_000_000
        if borrow_public:
            needed += len(public_entries) * 4096
        before = shutil.disk_usage(base).free
        if before - needed < FLOOR + RESERVE:
            raise ValueError(f'Insufficient capacity: free={before}, boundedImport={needed}; no files created')
        target.mkdir()
        seen = set()
        try:
            while (member := archive.next()) is not None:
                name = member.name
                if name not in entries or name in seen or not member.isfile():
                    raise ValueError('Unexpected, duplicate or linked archive member')
                entry = entries[name]
                if member.size != entry['size'] or stat.S_IMODE(member.mode) != entry['mode']:
                    raise ValueError('Archive descriptor differs from manifest')
                source = archive.extractfile(member)
                destination = target / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                reuse = reusable[name]
                public_reference = borrow_public and name.startswith('public/')
                with destination.open('xb') if reuse is None else open(os.devnull, 'wb') as out:
                    for chunk in iter(lambda: source.read(1024 * 1024), b''):
                        digest.update(chunk)
                        if reuse is None:
                            out.write(chunk)
                            if shutil.disk_usage(base).free < FLOOR + RESERVE:
                                raise ValueError('Capacity changed during streamed allocation')
                if digest.hexdigest() != entry['sha256']:
                    raise ValueError('Streamed file hash mismatch')
                if public_reference:
                    if sha(reuse) != entry['sha256']:
                        raise ValueError('Referenced public snapshot changed')
                    destination.symlink_to(reuse)
                elif reuse:
                    if (sha(reuse) != entry['sha256'] or reuse.stat().st_uid != os.getuid()
                            or reuse.stat().st_gid != os.getgid()):
                        raise ValueError('Reusable file changed or has a different owner')
                    os.link(reuse, destination)
                else:
                    destination.chmod(entry['mode'])
                seen.add(name)
            if seen != entries.keys():
                raise ValueError('Truncated runtime archive')
            for source in retained_static:
                if not source.resolve().is_relative_to(base) or source.stat().st_uid != os.getuid():
                    raise ValueError('Retained static asset has an unexpected owner or path')
                dest = target / source.relative_to(base)
                dest.parent.mkdir(parents=True, exist_ok=True)
                os.link(source, dest)
            (target / 'node_modules').symlink_to(deps, target_is_directory=True)
            aliases = {'pg': 'pg', '@aws-sdk/client-s3': '@aws-sdk/client-s3', '@zvec/zvec': '@zvec/zvec'}
            for path in (target / '.next/server').rglob('*.js'):
                for alias, package in re.findall(r'["\'`]((@aws-sdk/client-s3|@zvec/zvec|pg)-[a-f0-9]{16,})["\'`]', path.read_text()):
                    dest = target / '.next/node_modules' / alias
                    if not dest.is_symlink():
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        dest.symlink_to(deps / aliases[package], target_is_directory=True)
            after = shutil.disk_usage(base).free
            if after < FLOOR + RESERVE:
                raise ValueError('Capacity changed during import; retaining the reserve')
            (target / 'CI_RUNTIME_MANIFEST.json').write_bytes(encoded)
            return {'ok': True, 'buildId': manifest['buildId'], 'manifestSha256': expected_sha,
                    'candidate': str(target), 'files': len(seen), 'freeBefore': before, 'freeAfter': after,
                    'boundedImportBytes': needed, 'reusedBytes': sum(entries[n]['size'] for n in seen if reusable[n]),
                    'copiedBytes': sum(entries[n]['size'] for n in seen if not reusable[n]),
                    'retainedPreviousStaticFiles': len(retained_static),
                    'publicSnapshotReference': str(public) if borrow_public else None,
                    'credentialsCopied': False, 'activated': False}
        except BaseException:
            assert target.parent == base.parent and target != base and not target.is_symlink()
            shutil.rmtree(target)
            raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--current', type=Path, required=True)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--manifest-sha', required=True)
    args = parser.parse_args()
    print(json.dumps(import_runtime(args.current, args.candidate, sys.stdin.buffer, args.manifest_sha)))
