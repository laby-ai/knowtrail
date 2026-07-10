import path from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function selectVerifiedClassroom(status, expectedId = '') {
  assert(status?.ok === true && status?.mode === 'external' && status?.health?.ok === true,
    'Virtual classroom runtime is not ready.');
  const recent = Array.isArray(status.recentClassrooms) ? status.recentClassrooms : [];
  const classroom = expectedId ? recent.find(item => item?.id === expectedId) : recent[0];
  assert(classroom, expectedId
    ? `Expected classroom ${expectedId} is not present in recent history.`
    : 'Virtual classroom has no completed classroom in recent history.');
  assert(Number(classroom.scenesCount) > 0, 'Recent classroom has no scenes.');
  assert(Number(classroom.actionsCount) > 0, 'Recent classroom has no actions.');
  assert(typeof classroom.url === 'string' && classroom.url.startsWith('/classroom-runtime/classroom/'),
    'Recent classroom URL is outside the public runtime proxy.');
  assert(typeof classroom.exportUrl === 'string' && classroom.exportUrl.startsWith('/classroom-runtime/api/classroom'),
    'Recent classroom export URL is outside the public runtime proxy.');
  return classroom;
}

export function validateClassroomExport(payload, expectedId) {
  const classroom = payload?.classroom || payload?.data || payload;
  assert(classroom?.id === expectedId, 'Classroom export ID does not match recent history.');
  assert(Array.isArray(classroom.scenes) && classroom.scenes.length > 0, 'Classroom export has no scenes.');
  const actions = classroom.scenes.reduce((sum, scene) => sum + (Array.isArray(scene?.actions) ? scene.actions.length : 0), 0);
  assert(actions > 0, 'Classroom export has no actions.');
  return {
    id: classroom.id,
    scenes: classroom.scenes.length,
    actions,
    sceneTypes: Array.from(new Set(classroom.scenes.map(scene => scene?.type).filter(Boolean))),
  };
}

export function validateBrowserProbe(probe) {
  const hydrated = Boolean(probe.text?.trim()) && !probe.text.includes('Loading classroom...');
  const overflow = Number(probe.scrollWidth) > Number(probe.clientWidth);
  const errors = Array.isArray(probe.errors) ? probe.errors.length : 0;
  const failedResponses = Array.isArray(probe.failedResponses) ? probe.failedResponses.length : 0;
  assert(hydrated && !overflow && errors === 0 && failedResponses === 0,
    `Virtual classroom browser probe failed for ${probe.viewport || 'unknown viewport'}.`);
  return { viewport: probe.viewport, hydrated, overflow, errors, failedResponses };
}

export function validateSharedStoreLink(actualPath, expectedPath) {
  const actual = path.resolve(actualPath);
  const expected = path.resolve(expectedPath);
  assert(actual === expected, `Virtual classroom shared classroom store mismatch: ${actual}`);
  return { ok: true, path: actual };
}
