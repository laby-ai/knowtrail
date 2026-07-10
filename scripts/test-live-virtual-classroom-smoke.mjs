import assert from 'node:assert/strict';
import path from 'node:path';
import {
  selectVerifiedClassroom,
  validateBrowserProbe,
  validateClassroomExport,
  validateSharedStoreLink,
} from './lib/live-virtual-classroom-smoke.mjs';

const classroom = selectVerifiedClassroom({
  ok: true,
  mode: 'external',
  origin: '/classroom-runtime',
  health: { ok: true, status: 200 },
  recentClassrooms: [{
    id: 'classroom-1',
    scenesCount: 3,
    actionsCount: 18,
    url: '/classroom-runtime/classroom/classroom-1',
    exportUrl: '/classroom-runtime/api/classroom?id=classroom-1',
  }],
});
assert.equal(classroom.id, 'classroom-1');

assert.throws(
  () => selectVerifiedClassroom({ ok: false, mode: 'unavailable', recentClassrooms: [] }),
  /runtime is not ready/,
);
assert.throws(
  () => selectVerifiedClassroom({ ok: true, mode: 'external', health: { ok: true }, recentClassrooms: [] }),
  /no completed classroom/,
);

const exportSummary = validateClassroomExport({
  id: 'classroom-1',
  scenes: [
    { type: 'slide', actions: [{}, {}] },
    { type: 'quiz', actions: [{}] },
    { type: 'interactive', actions: [{}, {}, {}] },
  ],
}, 'classroom-1');
assert.deepEqual(exportSummary, {
  id: 'classroom-1',
  scenes: 3,
  actions: 6,
  sceneTypes: ['slide', 'quiz', 'interactive'],
});
assert.equal(validateClassroomExport({
  success: true,
  classroom: {
    id: 'classroom-1',
    scenes: [{ type: 'slide', actions: [{}] }],
  },
}, 'classroom-1').actions, 1);
assert.throws(
  () => validateClassroomExport({ id: 'classroom-1', scenes: [] }, 'classroom-1'),
  /no scenes/,
);

assert.deepEqual(validateBrowserProbe({
  viewport: 'desktop',
  text: '核心方法讲解',
  scrollWidth: 1400,
  clientWidth: 1440,
  errors: [],
  failedResponses: [],
}), {
  viewport: 'desktop',
  hydrated: true,
  overflow: false,
  errors: 0,
  failedResponses: 0,
});
assert.throws(
  () => validateBrowserProbe({
    viewport: 'mobile',
    text: 'Loading classroom...',
    scrollWidth: 400,
    clientWidth: 390,
    errors: ['console error'],
    failedResponses: [{ status: 404 }],
  }),
  /browser probe failed/,
);

assert.deepEqual(
  validateSharedStoreLink(
    '/opt/knowtrail/shared/virtual-classroom',
    '/opt/knowtrail/shared/virtual-classroom',
  ),
  { ok: true, path: path.resolve('/opt/knowtrail/shared/virtual-classroom') },
);
assert.throws(
  () => validateSharedStoreLink('/opt/knowtrail/releases/current/data', '/opt/knowtrail/shared/virtual-classroom'),
  /shared classroom store mismatch/,
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'runtime status and recent classroom contract',
    'classroom export scenes/actions contract',
    'desktop/mobile hydration and failure contract',
    'shared classroom store link contract',
  ],
}, null, 2));
