import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { classroomStorageCandidates } from '../src/lib/virtual-classroom/classroom-storage';

const root = path.resolve('/opt/knowtrail/releases/candidate');
const candidates = classroomStorageCandidates(root, 'OpenMAIC');

assert.deepEqual(candidates, [
  path.join(root, '.references', 'OpenMAIC', '.next', 'standalone', 'data', 'classrooms'),
  path.join(root, '.references', 'OpenMAIC', '.next', 'standalone', '.references', 'OpenMAIC', 'data', 'classrooms'),
]);

const startScript = readFileSync(path.join(process.cwd(), 'deploy', 'linux', 'start.sh'), 'utf8');
assert.match(startScript, /VIRTUAL_CLASSROOM_STORE_DIR/);
assert.match(startScript, /STUDIO_JOB_STORE_PATH/);
assert.match(startScript, /cp -a "\$CLASSROOM_DATA_DIR\/\." "\$VIRTUAL_CLASSROOM_STORE_DIR\/"/);
assert.match(startScript, /ln -s "\$VIRTUAL_CLASSROOM_STORE_DIR" "\$CLASSROOM_DATA_DIR"/);
assert.match(startScript, /Refusing unsafe classroom data path/);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'root standalone classroom storage is scanned',
    'nested standalone classroom storage remains backward compatible',
    'release startup migrates classroom data into a shared persistent store',
    'classroom data linking is guarded to the packaged runtime path',
  ],
}, null, 2));
