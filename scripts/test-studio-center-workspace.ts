import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const pageSource = read('src/app/page.tsx');
const studioPanelSource = read('src/components/studio/StudioPanel.tsx');
const layoutSource = read('src/components/layout/ThreeColumnLayout.tsx');

assert.match(
  pageSource,
  /centerPanel=\{\([\s\S]*<WorkbenchCenterPanel[\s\S]*compact=\{quiet\}/,
  'The center workbench panel should remain dedicated to document chat.',
);
assert.match(
  pageSource,
  /rightPanel=\{\([\s\S]*<StudioPanel[\s\S]*activeTab=\{activeStudioTab\}[\s\S]*onClose=\{closeStudioWorkspace\}/,
  'The right panel should own both the Studio directory and focused tool workspace.',
);
assert.match(
  studioPanelSource,
  /if \(activeTab\)[\s\S]*<StudioWorkspacePanel/,
  'Selecting a Studio tool should replace the right directory with a focused workspace.',
);
assert.match(
  studioPanelSource,
  /data-testid="studio-workspace-right"/,
  'The right tool workspace should expose a stable rendered contract.',
);
assert.match(
  studioPanelSource,
  /data-testid="studio-back-to-directory"[\s\S]*返回产物中心/,
  'The focused workspace should provide a clear return to the Studio directory.',
);
assert.match(
  studioPanelSource,
  /data-testid="studio-workspace-breadcrumb"[\s\S]*产物中心/,
  'A focused tool should show its location inside the product center.',
);
assert.match(
  studioPanelSource,
  /data-testid="studio-tool-content"/,
  'The selected tool input and results should stay inside a dedicated scroll area.',
);
assert.match(
  studioPanelSource,
  /activeTab === 'text-polishing'[\s\S]*<TextPolishingPanel/,
  'The right focused workspace should render the selected tool panel.',
);
assert.match(
  layoutSource,
  /rightFocusKey\?: string \| null/,
  'The three-column layout should accept a mobile right-focus request.',
);
assert.match(
  layoutSource,
  /if \(rightFocusKey\) setMobilePanel\('right'\)/,
  'Selecting a tool on mobile should keep the workflow inside the right panel.',
);

console.log(JSON.stringify({
  ok: true,
  checked: [
    'center panel remains document chat',
    'right panel switches between tool directory and focused workspace',
    'focused workspace has a clear breadcrumb and return action',
    'tool input and results use a dedicated right-side scroll area',
    'mobile tool selection focuses the right panel',
  ],
}, null, 2));
