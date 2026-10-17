import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

async function main() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'knowtrail-vision-qa-'));
  const originalEnv = { ...process.env }, originalFetch = globalThis.fetch;
  const tests: string[] = [];
  let visionCalls = 0, failedPage = 0, emptyPage = 0, smsDown = false;
  const authenticated = { cookie: 'userId=fixture; token=fixture-valid-a' };
  try {
    Object.assign(process.env, { TMPDIR: directory, FILE_STORAGE_ADAPTER: 'local', SOURCE_STORE_ADAPTER: 'local-json', SOURCE_STORE_PATH: path.join(directory, 'sources.json'), LOCAL_FILE_STORAGE_DIR: path.join(directory, 'uploads'), ZVEC_STORE_PATH: path.join(directory, 'zvec'), PAPER_HOST_SESSION_VERIFY_URL: 'https://sms-fixture.invalid/session', OPENAI_COMPAT_API_BASE: 'https://vision-fixture.invalid/v1', OPENAI_COMPAT_API_KEY: 'fixture-key', OPENAI_COMPAT_MODEL: 'qwen3.8-flash', OPENAI_COMPAT_VISION_MODEL: 'qwen3.8-flash', REAL_SERVICE_LLM_RETRIES: '1', REAL_SERVICE_FETCH_RETRIES: '0', ARK_API_KEY: '', OPENAI_API_KEY: '', DASHSCOPE_API_KEY: '', MINERU_API_TOKEN: '' });
    const { POST: analyze } = await import('../src/app/api/ai/analyze-pdf/route');
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://sms-fixture.invalid/')) {
        if (smsDown) return Response.json({}, { status: 503 });
        const headers = new Headers(init?.headers);
        if (!headers.get('cookie')?.includes('fixture-valid-a')) return Response.json({}, { status: 401 });
        return Response.json({ data: { authenticated: true, provider: 'knowtrail', workspaceKey: 'paper-user-' + 'a'.repeat(32), capabilities: ['verified-sms-session'] } });
      }
      if (url.endsWith('/api/ai/analyze-pdf')) {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get('cookie'), authenticated.cookie, 'Upload must forward the verified request identity, never a claimed owner');
        return analyze(new NextRequest(url, { ...init, headers, signal: init?.signal ?? undefined }));
      }
      if (url.endsWith('/api/ai/analyze')) return Response.json({ success: true, analysis: { title: 'Dedicated scanned PDF fixture', authors: [], abstract: 'Software acceptance only.', content: 'Software acceptance only.', keywords: [] } });
      if (url.startsWith('https://vision-fixture.invalid/')) {
        if (url.endsWith('/embeddings')) return Response.json({ data: (JSON.parse(String(init?.body)).input as string[]).map((_, index) => ({ index, embedding: [1, 0, 0, 0] })) });
        const body = JSON.parse(String(init?.body)) as { model: string; messages: { content: { type: string; text?: string; image_url?: { url: string } }[] }[] };
        assert.equal(body.model, 'qwen3.8-flash', 'Fixtures use Flash without changing production routing');
        const content = body.messages.at(-1)!.content;
        const image = content.find(p => p.type === 'image_url')!.image_url!.url;
        assert.equal(Buffer.from(image.split(',')[1], 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        const page = Number(content.find(p => p.type === 'text')!.text!.match(/第(\d+)页/)?.[1]);
        assert.ok(page > 0); visionCalls++;
        if (page === failedPage) return Response.json({ error: { message: 'fixture-secret-should-not-be-source' } }, { status: 503 });
        const text = page === emptyPage ? '' : `SCANPAGE_${String(page).padStart(2, '0')}: retained=${71 + page}; unit=mock_counts. Software acceptance only.`;
        return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      }
      throw new Error('External request forbidden: ' + url);
    };
    const pdf = async (pages: number) => (await readFile(path.resolve(`scripts/fixtures/scan-${pages}.pdf`))).toString('base64');
    async function call(pages: number, headers: Record<string, string> = authenticated, extra: Record<string, unknown> = {}) {
      return analyze(new NextRequest('https://fixture.invalid/api/ai/analyze-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ pdfBase64: await pdf(pages), ...extra }) }));
    }
    for (const [headers, status] of [[{}, 401], [{ cookie: 'userId=fixture; token=expired' }, 401], [{ ...authenticated, 'x-paper-host': 'paper-web', 'x-paper-host-workspace': 'paper-user-' + 'b'.repeat(32) }, 403]] as const) {
      const before = visionCalls; const response = await call(1, headers);
      assert.equal(response.status, status); assert.equal(visionCalls, before); tests.push('reject identity ' + status);
    }
    smsDown = true; assert.equal((await call(1)).status, 503); smsDown = false; tests.push('verification unavailable fails closed');
    const all = await call(12); assert.equal(all.status, 200); assert.equal(all.headers.get('cache-control'), 'private, no-store');
    const complete = await all.json(); assert.equal(complete.totalPages, 12); assert.equal(complete.pagesAnalyzed, 12); assert.equal(complete.complete, true);
    assert.deepEqual([...complete.content.matchAll(/--- 第(\d+)页 ---/g)].map((x: RegExpMatchArray) => Number(x[1])), Array.from({ length: 12 }, (_, i) => i + 1));
    assert.ok(complete.content.includes('retained=83; unit=mock_counts')); tests.push('all 12 real rendered pages in numeric order');
    const beforeLimit = visionCalls; const limited = await call(21); assert.equal(limited.status, 422); const limit = await limited.json();
    assert.equal(limit.totalPages, 21); assert.equal(limit.pageLimit, 20); assert.equal(limit.content, ''); assert.equal(visionCalls, beforeLimit); tests.push('21 pages explicitly rejected before paid inference');
    for (const maxPages of [0, -1, 1.2, '12']) { assert.equal((await call(1, authenticated, { maxPages })).status, 400); } tests.push('invalid page limits rejected');
    failedPage = 3; const partial = await call(12); assert.equal(partial.status, 502); const failure = await partial.json();
    assert.deepEqual(failure.failedPages, [3]); assert.equal(failure.pagesAnalyzed, 11); assert.equal(failure.content, ''); assert.ok(!JSON.stringify(failure).includes('fixture-secret')); tests.push('failed page cannot become successful partial text');
    failedPage = 0; emptyPage = 1; const empty = await call(1); assert.equal(empty.status, 502); assert.deepEqual((await empty.json()).failedPages, [1]); emptyPage = 0; tests.push('empty page transcription rejected');
    const { POST: upload } = await import('../src/app/api/upload/route');
    const { GET: getSource } = await import('../src/app/api/ingestion/sources/route');
    async function uploadPdf(pages: number, book: string) {
      const form = new FormData(); form.set('notebookId', book); form.append('files', new File([await readFile(path.resolve(`scripts/fixtures/scan-${pages}.pdf`))], `scan-${pages}.pdf`, { type: 'application/pdf' }));
      return upload(new NextRequest('https://fixture.invalid/api/upload', { method: 'POST', headers: authenticated, body: form }));
    }
    const tooMany = await (await uploadPdf(21, 'scan-rejected')).json(); assert.ok(tooMany.results[0].error.includes('21')); assert.equal(tooMany.results[0].id, undefined); tests.push('over-limit scan never ingested as summary');
    failedPage = 1; const failed = await (await uploadPdf(1, 'scan-rejected')).json(); assert.ok(failed.results[0].error); assert.equal(failed.results[0].id, undefined); failedPage = 0; tests.push('failed scan never ingested as model error');
    const restored = await (await uploadPdf(12, 'scan-restored')).json(); const paper = restored.results[0]; assert.equal(paper.error, undefined); assert.ok(paper.rawContent.includes('retained=83; unit=mock_counts'));
    const saved = await getSource(new NextRequest('https://fixture.invalid/api/ingestion/sources?notebookId=scan-restored&id=' + paper.id, { headers: authenticated }));
    assert.equal(saved.status, 200); assert.equal((await saved.json()).source.rawContent, paper.rawContent); tests.push('upload retry, same-owner stored source and re-open');
    assert.equal((await getSource(new NextRequest('https://fixture.invalid/api/ingestion/sources?notebookId=other&id=' + paper.id, { headers: authenticated }))).status, 404); tests.push('other notebook cannot read stored scan');
    const scratch = (await readdir(directory)).filter(name => name.startsWith('knowtrail-pdf-ocr-')); assert.deepEqual(scratch, []); tests.push('all own page scratch cleaned after success, rejection and failure');
    console.log(JSON.stringify({ ok: true, tests, visionCalls, paidCalls: 0, actualRenderer: 'pdftoppm', modelAndSMSAreFixtures: true }));
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of Object.keys(process.env)) if (!(name in originalEnv)) delete process.env[name];
    Object.assign(process.env, originalEnv);
    assert.ok(path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith('knowtrail-vision-qa-'));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
