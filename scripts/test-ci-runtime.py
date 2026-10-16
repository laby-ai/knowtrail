"""Exercise the real archive importer, including refusal without disk mutation."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('importer', ROOT / 'deploy/linux/import-ci-runtime.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class ImportRuntime(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='knowtrail-ci-runtime-test-')
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name) / 'baseline'
        self.base.mkdir()
        self.target = self.base.parent / 'candidate'
        self.files = {'package.json': b'{}\n', 'pnpm-lock.yaml': b'locked\n',
                      '.next/BUILD_ID': b'fixture-build', 'dist/server.js': b'// server\n',
                      '.next/server/app/page.html': b'<main>fixture</main>',
                      '.next/static/unchanged.js': b'const fixture = true;\n'}
        for name, data in self.files.items():
            path = self.base / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o644)
        (self.base / '.env.production').write_text('NEXT_PUBLIC_BASE_PATH=/knowtrail\n')
        (self.base / 'node_modules').mkdir(mode=0o755)
        self.manifest = {'schema': 1, 'buildId': 'fixture-build', 'platform': 'Linux',
                         'machine': 'x86_64', 'node': subprocess.check_output(
                             ['node', '--version'], text=True).strip(),
                         'publicEnv': {'NEXT_PUBLIC_BASE_PATH': '/knowtrail'},
                         'files': [{'path': n, 'size': len(b), 'mode': 0o644,
                                    'sha256': hashlib.sha256(b).hexdigest()}
                                   for n, b in self.files.items()]}
        self.manifest['dependencySha256'] = hashlib.sha256(json.dumps({k: None for k in (
            'dependencies', 'devDependencies', 'packageManager', 'engines')}, sort_keys=True).encode()).hexdigest()

    def archive(self, manifest=None, tamper=None, extra=None, omit=None):
        encoded = json.dumps(manifest or self.manifest).encode()
        out = io.BytesIO()
        with tarfile.open(fileobj=out, mode='w:gz') as archive:
            info = tarfile.TarInfo('CI_RUNTIME_MANIFEST.json')
            info.size = len(encoded)
            archive.addfile(info, io.BytesIO(encoded))
            for name, data in {**self.files, **(extra or {})}.items():
                if name == omit:
                    continue
                data = tamper if name == 'dist/server.js' and tamper else data
                info = tarfile.TarInfo(name)
                info.mode = 0o644
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        out.seek(0)
        return out, hashlib.sha256(encoded).hexdigest()

    def test_refuse_unsafe_manifest_paths(self):
        for name in ['../secret', '.next/../../secret', 'src/./secret', 'public/uploads/private',
                     '.env.production', 'src/.env.private', '/src/absolute', 'src\\windows']:
            manifest = copy.deepcopy(self.manifest)
            manifest['files'][0]['path'] = name
            with self.subTest(name=name), self.assertRaises(ValueError):
                importer.validate(manifest)

    def test_refuse_duplicate_paths(self):
        self.manifest['files'].append(self.manifest['files'][0])
        with self.assertRaises(ValueError):
            importer.validate(self.manifest)

    def test_packager_excludes_private_data_and_build_cache(self):
        pack_spec = importlib.util.spec_from_file_location('packager', ROOT / 'scripts/package-ci-runtime.py')
        packager = importlib.util.module_from_spec(pack_spec)
        pack_spec.loader.exec_module(packager)
        for name in ['.next/required-server-files.json', '.next/cache/test.bin',
                     '.next/server/test.js.map', 'public/uploads/private.txt', 'src/example.ts']:
            path = self.base / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('dedicated-test-fixture')
        tracked = ['package.json', 'pnpm-lock.yaml', '.env.production',
                   'public/uploads/private.txt', 'src/example.ts']
        original = subprocess.check_output

        def git_only(command, **kwargs):
            if command[:2] == ['git', 'ls-files']:
                return ('\0'.join(tracked) + '\0').encode()
            if command[:2] == ['git', 'rev-parse']:
                return '1' * 40 + '\n'
            return original(command, **kwargs)

        output = self.base.parent / 'fixture-artifact'
        with patch.object(packager.subprocess, 'check_output', side_effect=git_only):
            packager.package(self.base, output)
        manifest = json.loads(Path(str(output) + '.manifest.json').read_text())
        names = {e['path'] for e in manifest['files']}
        self.assertIn('src/example.ts', names)
        self.assertIn('.next/server/app/page.html', names)
        self.assertFalse(names & {'.env.production', 'public/uploads/private.txt',
                                 '.next/cache/test.bin', '.next/server/test.js.map'})
        with tarfile.open(str(output) + '.tar.gz') as archive:
            self.assertTrue(all(e.isfile() for e in archive))
        undeployed = self.base / next(iter(packager.EXCLUDED_SOURCES))
        undeployed.parent.mkdir(parents=True, exist_ok=True)
        undeployed.write_text('dedicated-unreleased-fixture')
        with patch.object(packager.subprocess, 'check_output', side_effect=git_only):
            with self.assertRaisesRegex(ValueError, 'production source profile'):
                packager.package(self.base, self.base.parent / 'refused-artifact')
        self.assertFalse((self.base.parent / 'refused-artifact.tar.gz').exists())

    @unittest.skipUnless(sys.platform == 'linux', 'Native filesystem import is verified on Linux CI')
    def test_materialize_hardlinks_but_keep_runtime_html_private(self):
        old_static = self.base / '.next/static/previous-page.js'
        old_static.write_bytes(b'// retained old browser chunk')
        old_static.chmod(0o644)
        stream, digest = self.archive()
        result = importer.import_runtime(self.base, self.target, stream, digest)
        self.assertTrue(result['ok'])
        self.assertFalse(result['activated'])
        self.assertEqual((self.target / '.next/static/unchanged.js').stat().st_ino,
                         (self.base / '.next/static/unchanged.js').stat().st_ino)
        self.assertNotEqual((self.target / '.next/server/app/page.html').stat().st_ino,
                            (self.base / '.next/server/app/page.html').stat().st_ino)
        for name, data in self.files.items():
            self.assertEqual((self.target / name).read_bytes(), data)
            self.assertEqual((self.base / name).read_bytes(), data)
        self.assertFalse((self.target / '.env.production').exists())
        self.assertEqual((self.target / 'node_modules').resolve(), self.base / 'node_modules')
        self.assertEqual((self.target / '.next/static/previous-page.js').stat().st_ino,
                         old_static.stat().st_ino)
        self.assertEqual(result['retainedPreviousStaticFiles'], 1)

    @unittest.skipUnless(sys.platform == 'linux', 'Linux capacity and streaming behavior')
    def test_capacity_refusal_creates_no_candidate(self):
        stream, digest = self.archive()
        usage = type('Usage', (), {'free': importer.FLOOR + 1})()
        with patch.object(importer.shutil, 'disk_usage', return_value=usage):
            with self.assertRaisesRegex(ValueError, 'no files created'):
                importer.import_runtime(self.base, self.target, stream, digest)
        self.assertFalse(self.target.exists())

    @unittest.skipUnless(sys.platform == 'linux', 'Linux failure cleanup')
    def test_tampered_truncated_and_extra_archives_leave_baseline_intact(self):
        for options in [{'tamper': b'tamper-1234'}, {'omit': 'dist/server.js'},
                        {'extra': {'src/unlisted.ts': b'unlisted'}}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                stream, digest = self.archive(**options)
                importer.import_runtime(self.base, self.target, stream, digest)
            self.assertFalse(self.target.exists())
            self.assertEqual((self.base / 'dist/server.js').read_bytes(), self.files['dist/server.js'])

    @unittest.skipUnless(sys.platform == 'linux', 'Linux immutable dependency gate')
    def test_dependency_or_public_configuration_mismatch_is_refused(self):
        for key in ['dependency', 'publicEnv']:
            manifest = copy.deepcopy(self.manifest)
            if key == 'dependency':
                manifest['files'][1]['sha256'] = '0' * 64
            else:
                manifest['publicEnv']['NEXT_PUBLIC_BASE_PATH'] = '/different'
            stream, digest = self.archive(manifest=manifest)
            with self.subTest(key=key), self.assertRaises(ValueError):
                importer.import_runtime(self.base, self.target, stream, digest)
            self.assertFalse(self.target.exists())


if __name__ == '__main__':
    unittest.main()
