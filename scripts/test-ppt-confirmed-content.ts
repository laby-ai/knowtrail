import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { genAcademicOutline } from '../src/lib/ppt/academic-planner';
import { buildAcademicPptx } from '../src/lib/ppt/academic-renderer';
import { formatPptOutlineDraftForPrompt, sanitizePptOutlineDraft } from '../src/lib/ppt/outline-draft';
import { saveStructuredPpt, readStructuredPpt } from '../src/lib/structured-ppt-store';

// Gillon et al., arXiv:1703.01424v1, PDF p.3, "In a third phase".
// Real source excerpt; the provider response below is an engineering replay.
const source = 'In a third phase, we used the results obtained above to investigate the TTV signals themselves. By performing a series of analytical and numerical N-body integrations (see Methods), we could determine initial mass estimates for the six inner planets, along with their orbital eccentricities. We emphasise the preliminary nature of this dynamical solution which may not correspond to a global minimum of the parameter space, and that additional transit observations of the system will be required to lift the existing degeneracies (see Methods).';
const bodies = [
  ['作者将六颗内行星的凌日时间变化与N体模拟比较，以初步估计质量和轨道偏心率。', '这是一项初步动力学分析，输入为观测到的TTV，不能据此将候选拟合认定为最终解。'],
  ['作者提醒初步质量估计可能并非拟合的全局最小值，因此推断仍保留不确定性。', '作者指出需要更多凌日观测解除TTV分析的现有简并，本段没有给出已解除简并的结果。'],
];

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-ppt-content-'));
  const originalEnv = { ...process.env };
  let calls = 0;
  const gateway = createServer(async (request, response) => {
    for await (const chunk of request) assert(Buffer.isBuffer(chunk));
    const bullets = bodies[calls++];
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify([{ bullets, layout: 'full_text', note: 'arXiv:1703.01424v1, PDF p.3, In a third phase.' }]) }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }));
  });
  await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
  try {
    const address = gateway.address();
    assert(address && typeof address !== 'string');
    Object.assign(process.env, { NODE_ENV: 'test', STRUCTURED_PPT_STORE_DIR: directory,
      OPENAI_COMPAT_API_BASE: `http://127.0.0.1:${address.port}/v1`, OPENAI_COMPAT_API_KEY: 'fixture-key',
      OPENAI_COMPAT_MODEL: 'fixture-flash', REAL_SERVICE_LLM_RETRIES: '1' });
    const outlineDraft = sanitizePptOutlineDraft([
      { title: '动力学方法', focus: '直接说明TTV与N体模拟比较的目的，不要封面。', sourceLabel: 'Gillon2017，第3页' },
      { title: '初步质量估计的局限', focus: '区分初步估计与全局最优解，并说明作者提出的后续观测需求。', sourceLabel: 'Gillon2017，第3页' },
    ]);
    const papers = [{ id: 'gillon-p3', title: 'TRAPPIST-1：动力学段落', authors: ['Gillon et al.'], year: 2017, rawContent: source }];
    const options = { outlineDraft, outlineDraftPrompt: formatPptOutlineDraftForPrompt(outlineDraft), duration: 5,
      runtimeConfig: { apiBase: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fixture-key', model: 'fixture-flash' } };
    const slides = await genAcademicOutline(papers, options);
    assert.equal(slides[0].type, 'method', 'A confirmed content page must not silently become a cover');
    assert.equal(calls, 2, 'Both confirmed content pages must reach the generator exactly once');
    assert.deepEqual(slides.map(slide => slide.title), outlineDraft.map(slide => slide.title));
    assert.deepEqual(slides.map(slide => slide.bullets), bodies);
    const buffer = await buildAcademicPptx(papers, slides, options);
    const archive = await JSZip.loadAsync(buffer);
    const page1 = await archive.file('ppt/slides/slide1.xml')!.async('string');
    assert(page1.includes(bodies[0][0]), 'The exported first page must contain its confirmed content');
    assert(!page1.includes('<p:pic>'), 'Content must remain native text');
    assert.equal(Object.keys(archive.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 2);
    const scope = { ownerMemberId: 'ppt-content-fixture', notebookId: 'trappist-dynamics-fixture' };
    const artifact = await saveStructuredPpt({ ...scope, buffer, fileName: 'trappist-dynamics.pptx', slideCount: 2, sourceIds: ['gillon-p3'], expectedArtifactId: null });
    assert((await readStructuredPpt(scope))?.buffer.equals(buffer));
    assert((await readStructuredPpt(scope, artifact.id))?.buffer.equals(buffer));
    assert.equal(await readStructuredPpt({ ...scope, ownerMemberId: 'other-fixture' }, artifact.id), null);
    console.log(JSON.stringify({ ok: true, confirmedContentFirst: true, nativePages: 2, sameStoredBytes: true, paidCalls: 0, scientificModelGeneration: false, browserOrPowerPointEditing: false }));
  } finally {
    await new Promise<void>((resolve, reject) => gateway.close(error => error ? reject(error) : resolve()));
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await rm(directory, { recursive: true, force: true });
  }
}
void main();
