import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseZhiqiHostContext } from '../src/lib/zhiqi-host-context';

const embedded = parseZhiqiHostContext(new URLSearchParams({
  embed: 'zhiqi-research',
  host: 'zhiqi-studio',
  workspaceKey: 'student:42/paper 7',
  workspaceTitle: '企业数字化转型研究',
}));

assert.deepEqual(embedded, {
  enabled: true,
  workspaceKey: 'student_42_paper_7',
  notebookId: 'zhiqi-student_42_paper_7',
  workspaceTitle: '企业数字化转型研究',
});

const missingWorkspace = parseZhiqiHostContext(new URLSearchParams({
  embed: 'zhiqi-research',
  host: 'zhiqi-studio',
}));
assert.equal(missingWorkspace.enabled, false, 'embedded mode must fail closed without a workspace key');

const standalone = parseZhiqiHostContext(new URLSearchParams({ view: 'workbench' }));
assert.deepEqual(standalone, {
  enabled: false,
  workspaceKey: '',
  notebookId: '',
  workspaceTitle: '',
});

const oversizedTitle = parseZhiqiHostContext(new URLSearchParams({
  embed: 'zhiqi-research',
  host: 'zhiqi-studio',
  workspaceKey: 'workspace-1',
  workspaceTitle: 'A'.repeat(200),
}));
assert.equal(oversizedTitle.workspaceTitle.length, 80);

const pageSource = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');
assert.match(pageSource, /parseZhiqiHostContext/);
assert.match(pageSource, /hostContext\.notebookId/);
assert.match(pageSource, /embedded=\{hostContext\.enabled\}/);

const topBarSource = readFileSync(join(process.cwd(), 'src/components/workbench/WorkbenchTopBar.tsx'), 'utf8');
assert.match(topBarSource, /embedded\?: boolean/);
assert.match(topBarSource, /!embedded/);

console.log('Zhiqi host context contract passed');
