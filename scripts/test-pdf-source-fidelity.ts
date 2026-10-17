import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-pdf-fidelity-'));
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const expectTruncated = process.argv.includes('--expect-truncated');
  const vision = 'VISION_FIXTURE: supplemental caption transcription; not a replacement for extracted text.';
  const checks: { visionSucceeded: boolean; rawChars: number; tailInRaw: boolean; tailInChunks: boolean; tailInRetrieval: boolean }[] = [];
  try {
    Object.assign(process.env, { FILE_STORAGE_ADAPTER: 'local', SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'), LOCAL_FILE_STORAGE_DIR: path.join(directory, 'uploads'), PAPER_HOST_SESSION_VERIFY_URL: 'https://sms-fixture.invalid/session', OPENAI_COMPAT_API_KEY: '', OPENAI_API_KEY: '', ARK_API_KEY: '', DASHSCOPE_API_KEY: '', MINERU_API_TOKEN: '' });
    let visionSucceeded = true;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://sms-fixture.invalid/')) return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: 'paper-user-' + 'a'.repeat(32), capabilities: ['verified-sms-session'] } });
      if (url.endsWith('/api/ai/analyze-pdf')) return visionSucceeded ? Response.json({ success: true, content: vision, pagesAnalyzed: 6 }) : Response.json({ error: 'Dedicated vision unavailable fixture' }, { status: 503 });
      if (url.endsWith('/api/ai/analyze')) {
        const body = JSON.parse(String(init?.body)) as { fileContent: string };
        assert.ok(body.fileContent.length <= 15000, 'Metadata model input remains bounded separately from stored source text');
        return Response.json({ success: true, analysis: { title: 'PDF software acceptance fixture', authors: [], abstract: 'Dedicated software fixture only.', content: 'Dedicated software fixture only.', keywords: [] } });
      }
      throw new Error('No model or other external request is permitted: ' + url);
    };
    const buffer = await readFile(path.resolve('scripts/fixtures/pdf-text-fidelity.pdf'));
    process.env.PDF_PARSER_DISABLE_TEST = '1';
    const pdfParse = (await import('pdf-parse-fixed')).default;
    const parsed = await pdfParse(buffer);
    assert.equal(parsed.numpages, 6);
    assert.ok(parsed.text.indexOf('PDFTAIL_832: retained=47; sample_unit=mock_rows') > 15000);
    const { POST: upload } = await import('../src/app/api/upload/route');
    const { buildGroundedRetrievalContext } = await import('../src/lib/grounded-retrieval');
    for (const success of [true, false]) {
      visionSucceeded = success;
      const book = 'pdf-fidelity-' + success;
      const form = new FormData(); form.set('notebookId', book);
      form.append('files', new File([buffer], 'pdf-text-fidelity.pdf', { type: 'application/pdf' }));
      const response = await upload(new NextRequest('https://knowtrail-fixture.invalid/api/upload', { method: 'POST', headers: { Cookie: 'userId=fixture; token=fixture-valid-a' }, body: form }));
      assert.equal(response.status, 200);
      const result = await response.json() as { results: { id: string; rawContent: string; error?: string }[] };
      const paper = result.results[0]; assert.equal(paper.error, undefined);
      const stored = JSON.parse(await readFile(path.join(directory, 'sources.json'), 'utf8')) as { sources: { id: string; rawContent: string; chunks: { text: string }[] }[] };
      const source = stored.sources.find(row => row.id === paper.id)!;
      assert.equal(source.rawContent, paper.rawContent);
      const context = await buildGroundedRetrievalContext('PDFTAIL_832', [{ id: paper.id }], undefined, { ownerMemberId: 'paper-host:paper-user-' + 'a'.repeat(32), notebookId: book });
      const row = { visionSucceeded: success, rawChars: source.rawContent.length, tailInRaw: source.rawContent.includes('retained=47; sample_unit=mock_rows'), tailInChunks: source.chunks.some(chunk => chunk.text.includes('retained=47; sample_unit=mock_rows')), tailInRetrieval: context.promptContext.includes('retained=47; sample_unit=mock_rows') };
      checks.push(row);
      if (expectTruncated && success) assert.equal(row.tailInRaw, false);
      else {
        assert.ok(source.rawContent.includes(parsed.text), 'Every character from the actual PDF text parser must remain in the stored source');
        assert.ok(row.tailInRaw && row.tailInChunks && row.tailInRetrieval);
      }
      if (success) assert.ok(source.rawContent.includes(vision));
      assert.ok(context.promptContext.length < 9000);
    }
    console.log(JSON.stringify({ ok: true, baselineDefect: expectTruncated, actualParser: 'pdf-parse-fixed', pages: parsed.numpages, extractedChars: parsed.text.length, checks, paidCalls: 0, smsAndVisionAreFixtures: true }));
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(directory).startsWith('knowtrail-pdf-fidelity-'));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
