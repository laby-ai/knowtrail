import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const studioPanelSource = read('src/components/studio/StudioPanel.tsx');
const switcherSource = read('src/components/studio/StudioToolSwitcher.tsx');
const presentationPanelSource = read('src/components/studio/PresentationPanels.tsx');
const structuredPresentationPanelSource = read('src/components/studio/StructuredPresentationPanel.tsx');
const structuredOutlineDraftSource = read('src/components/studio/StructuredPresentationOutlineDraft.tsx');
const pptV2RouteSource = read('src/app/api/ai/ppt-v2/route.ts');
const presentationModeSelectorSource = read('src/components/studio/PresentationModeSelector.tsx');
const knowledgeMapPanelSource = read('src/components/studio/KnowledgeMapPanel.tsx');
const knowledgeMapWorkspaceSource = read('src/components/studio/KnowledgeMapWorkspace.tsx');
const virtualClassroomPanelSource = read('src/components/studio/VirtualClassroomPanel.tsx');
const paperSearchPanelPath = path.join(process.cwd(), 'src/components/studio/PaperSearchPanel.tsx');
assert.ok(fs.existsSync(paperSearchPanelPath), 'Paper search product should provide a real Studio panel');
const paperSearchPanelSource = fs.readFileSync(paperSearchPanelPath, 'utf8');
const discoverSourcesModalSource = read('src/components/library/DiscoverSourcesModal.tsx');
const virtualClassroomWorkspaceSource = read('src/components/studio/VirtualClassroomWorkspace.tsx');
const workbenchTopBarSource = read('src/components/workbench/WorkbenchTopBar.tsx');
const realPptArtifactSource = read('scripts/generate-real-ppt-v2-artifact.mjs');
const taxonomyPath = path.join(process.cwd(), 'src/lib/studio-research-taxonomy.ts');
assert.ok(fs.existsSync(taxonomyPath), 'Studio research taxonomy should define the four user-approved research categories');
const taxonomySource = fs.readFileSync(taxonomyPath, 'utf8');
const productCenterSource = `${studioPanelSource}\n${switcherSource}`;
const retainedSource = `${productCenterSource}\n${presentationPanelSource}\n${virtualClassroomPanelSource}\n${virtualClassroomWorkspaceSource}`;

const studioPanelStart = studioPanelSource.indexOf('export function StudioPanel()');
const panelContentStart = studioPanelSource.indexOf('{activeTab ===', studioPanelStart);
assert.ok(studioPanelStart >= 0, 'StudioPanel export not found');
assert.ok(panelContentStart > studioPanelStart, 'StudioPanel content switch not found');

const navSection = studioPanelSource.slice(studioPanelStart, panelContentStart);
assert.match(navSection, /<StudioToolSwitcher activeTab=\{activeTab\} onSelect=\{setActiveTab\} \/>/, 'StudioPanel should delegate tool switching to StudioToolSwitcher');
assert.match(switcherSource, /onClick=\{\(\) => onSelect\(item\.id\)\}/, 'Studio tool switcher should only request active tab changes');
assert.doesNotMatch(navSection, /queueStudioPrompt|fetch\(|handleGenerate|generate|\/api\/ai\//, 'Studio nav must not trigger generation side effects');
assert.doesNotMatch(switcherSource, /queueStudioPrompt|fetch\(|handleGenerate|generate|\/api\/ai\//, 'Studio tool switcher must not trigger generation side effects');
assert.match(navSection, /data-testid="studio-nav-helper"/, 'Studio nav should explain that generation happens in the detail panel');

assert.match(taxonomySource, /id: 'literature-evidence', label: '文献证据'/, 'Taxonomy should define literature evidence');
assert.match(taxonomySource, /id: 'research-ideation', label: '研究构思'/, 'Taxonomy should define research ideation even while it has no ready product');
assert.match(taxonomySource, /id: 'results-expression', label: '成果表达'/, 'Taxonomy should define results expression');
assert.match(taxonomySource, /id: 'collaboration-memory', label: '协作沉淀'/, 'Taxonomy should define collaboration and memory');
assert.match(taxonomySource, /id: 'knowledge'[\s\S]*label: '研究脉络'[\s\S]*categoryId: 'literature-evidence'/, 'Original knowledge map should be mapped as research context under literature evidence');
assert.match(taxonomySource, /id: 'paper-search'[\s\S]*label: '论文检索'[\s\S]*categoryId: 'literature-evidence'[\s\S]*availability: 'ready'/, 'Paper search should be a real literature-evidence product');
assert.match(taxonomySource, /id: 'presentation'[\s\S]*label: 'PPT 制作'[\s\S]*categoryId: 'results-expression'/, 'Original presentation product should be mapped as PPT creation under results expression');
assert.match(taxonomySource, /id: 'virtual-classroom'[\s\S]*label: '虚拟课堂'[\s\S]*categoryId: 'collaboration-memory'[\s\S]*availability: 'runtime-dependent'/, 'Virtual classroom should be mapped under collaboration without being marked ready');
const productDefinitions = taxonomySource.slice(taxonomySource.indexOf('STUDIO_RESEARCH_PRODUCTS'));
assert.equal((productDefinitions.match(/\n\s+id: '/g) || []).length, 4, 'Taxonomy should expose one new paper-search product plus the three original products');
assert.match(switcherSource, /getVisibleStudioCategories/, 'Product center should render taxonomy categories through the empty-category filter');
assert.doesNotMatch(switcherSource, /即将上线|敬请期待|coming soon/i, 'Product center must not render placeholder products');
assert.doesNotMatch(productCenterSource, /presentation2/, 'Structured PPT should remain a mode inside the original presentation product, not a hidden fourth product');
assert.doesNotMatch(productCenterSource, /核心产物|科研产物|更多工具|练习工具/, 'Product center should not keep the later grouping labels');
assert.doesNotMatch(workbenchTopBarSource, /科研产物/, 'Workbench copy should not reintroduce the removed research-artifact concept');
assert.doesNotMatch(productCenterSource, /互动页面|测验练习|项目研习|组会材料|实验记录|Results 初稿|Discussion 初稿/, 'Later artifact tools should not remain in the product center');
assert.doesNotMatch(productCenterSource, /STUDIO_ARTIFACT_TOOLS|StudioArtifactToolPanel|studio-tools/, 'Product center should not retain the later artifact registry or panel');

assert.ok(!fs.existsSync(path.join(process.cwd(), 'src/components/studio/StudioArtifactToolPanel.tsx')), 'Removed artifact panel should not remain as dead code');
assert.ok(!fs.existsSync(path.join(process.cwd(), 'src/components/studio/KnowledgeCardPanel.tsx')), 'Unreachable legacy knowledge-card panel should not remain beside the active knowledge-map product');
assert.ok(!fs.existsSync(path.join(process.cwd(), 'src/lib/studio-tools.ts')), 'Removed artifact registry should not remain as dead code');
assert.ok(!fs.existsSync(path.join(process.cwd(), 'src/lib/studio-tool-api-contract.ts')), 'Removed artifact API contract should not remain as dead code');
assert.ok(!fs.existsSync(path.join(process.cwd(), 'src/app/api/ai/studio-tool/route.ts')), 'Removed artifact API route should not remain without a product consumer');

assert.match(studioPanelSource, /activeTab === 'presentation' && <PresentationWorkspacePanel \/>/, 'PPT product should render its original workspace');
assert.match(studioPanelSource, /activeTab === 'knowledge' && <KnowledgeMapPanel \/>/, 'Knowledge map product should render its original panel');
assert.match(studioPanelSource, /activeTab === 'paper-search' && <PaperSearchPanel \/>/, 'Paper search product should render its real search panel');
assert.match(studioPanelSource, /activeTab === 'virtual-classroom' && <VirtualClassroomPanel \/>/, 'Virtual classroom should render its original panel');
assert.match(paperSearchPanelSource, /<DiscoverSourcesModal[\s\S]*variant="embedded"/, 'Paper search should reuse the existing discover and ingest workspace');
assert.match(discoverSourcesModalSource, /待核验/, 'Search results should state their verification boundary');
assert.match(retainedSource, /data-testid="virtual-classroom-open"/, 'Virtual classroom needs a full-page entry for real use');
assert.match(retainedSource, /data-testid="virtual-classroom-iframe"/, 'Virtual classroom should embed the classroom runtime in Studio');
assert.match(retainedSource, /NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN/, 'Virtual classroom origin should remain configurable');
assert.doesNotMatch(retainedSource, /参考 OpenMAIC|OpenMAIC 对齐|grounded retrieval|grounded context|citation audit/i, 'User-facing Studio copy must not expose reference names or implementation jargon');
assert.doesNotMatch(realPptArtifactSource, /OpenMAIC|openmaic|OPENMAIC/, 'Generated PPT content must not expose internal reference names');

assert.match(presentationPanelSource, /data-testid="image-ppt-generate"/, 'Image PPT still needs an explicit generate button');
assert.match(structuredPresentationPanelSource, /data-testid="academic-ppt-generate"/, 'Structured PPT still needs an explicit generate button');
assert.match(structuredPresentationPanelSource, /StructuredPresentationOutlineDraft/, 'Structured PPT should use the editable outline draft before generation');
assert.match(structuredOutlineDraftSource, /data-testid="academic-ppt-outline-confirm"/, 'Structured PPT outline draft needs an explicit confirmation button');
assert.match(structuredPresentationPanelSource, /请先检查并确认下方简报大纲/, 'Structured PPT generation should require outline confirmation');
assert.match(structuredPresentationPanelSource, /outlineDraft,/, 'Structured PPT should send the confirmed outline draft to the backend');
assert.match(structuredOutlineDraftSource, /buildPptOutlineDraft/, 'Structured PPT outline draft should reuse the shared outline contract');
assert.match(pptV2RouteSource, /sanitizePptOutlineDraft\(body\.outlineDraft\)/, 'PPT-v2 route should sanitize the user-edited outline draft');
assert.match(pptV2RouteSource, /formatPptOutlineDraftForPrompt\(outlineDraft\)/, 'PPT-v2 route should format the outline draft for generation prompts');
assert.match(pptV2RouteSource, /outlineDraftApplied/, 'PPT-v2 observability should report whether a confirmed outline was applied');
assert.doesNotMatch(structuredPresentationPanelSource, /ArcDeck|真实模型/, 'Structured PPT panel should not expose implementation jargon');
assert.match(presentationModeSelectorSource, /data-testid=\{`presentation-mode-\$\{option\.id\}`\}/, 'PPT mode selector should expose stable test ids');
assert.match(presentationModeSelectorSource, /<span>PPT 制作<\/span>/, 'PPT detail panel should use the approved product name');
assert.doesNotMatch(`${knowledgeMapPanelSource}\n${knowledgeMapWorkspaceSource}`, /['">]资料脉络[<'"]/, 'Knowledge-map UI should consistently use the approved research-context name');
assert.match(virtualClassroomPanelSource, /课堂服务未连接/, 'Virtual classroom should expose its unavailable runtime state');
assert.match(presentationModeSelectorSource, /id: 'image'[\s\S]*label: '图片页简报'/, 'PPT mode selector should keep the image PPT option');
assert.match(presentationModeSelectorSource, /id: 'structured'[\s\S]*label: '结构化 PPT'/, 'PPT mode selector should keep the structured PPT option');

console.log(JSON.stringify({
  ok: true,
  checked: 'Studio product center exposes paper search plus the three original products without navigation side effects',
  products: ['论文检索', '研究脉络', 'PPT 制作', '虚拟课堂'],
  explicitButtons: ['discover-search', 'image-ppt-generate', 'academic-ppt-generate', 'virtual-classroom-open'],
}, null, 2));
