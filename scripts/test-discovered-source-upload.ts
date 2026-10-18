import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.join(process.cwd(), 'src/lib/discovered-source-upload.ts');
type UploadRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function main() {
  assert.ok(fs.existsSync(modulePath), 'Paper search should upload selected sources through a focused adapter');
  const { uploadDiscoveredSourceFiles } = await import('../src/lib/discovered-source-upload');
  const { createDiscoveredSourceFile } = await import('../src/lib/discovered-source-file');
  const { sourceBibliography } = await import('../src/lib/source-bibliography');
  const requests: Array<{ url: string; method?: string }> = [];
  const request: UploadRequest = async (input, init) => {
    requests.push({ url: String(input), method: init?.method });
    return new Response(JSON.stringify({
      results: [
        {
          id: 'paper-1',
          title: 'Grounded Paper',
          authors: ['Ada Researcher'],
          year: 2025,
          keywords: ['retrieval'],
          abstract: 'A grounded abstract.',
          content: 'Full source content.',
          rawContent: 'Full source content.',
          shortName: 'Grounded Paper',
          fileName: 'grounded-paper.txt',
          fileType: 'txt',
          fileSize: 120,
          uploadTime: '2026-07-10T00:00:00.000Z',
        },
        { error: 'second source failed' },
      ],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const outcome = await uploadDiscoveredSourceFiles({
    files: [
      new File(['first'], 'first.txt', { type: 'text/plain' }),
      new File(['second'], 'second.txt', { type: 'text/plain' }),
    ],
    notebookId: 'notebook-1',
    request,
  });

  assert.deepEqual(requests, [{ url: '/api/upload', method: 'POST' }]);
  assert.equal(outcome.papers.length, 1);
  assert.equal(outcome.papers[0]?.title, 'Grounded Paper');
  assert.deepEqual(outcome.errors, ['second source failed']);
  assert.deepEqual(outcome.successfulFileIndexes, [0]);

  const files = Array.from({ length: 10 }, (_, index) => new File([String(index)], `candidate-${index}.txt`));
  const batchSizes: number[] = [];
  const partial = await uploadDiscoveredSourceFiles({ files, notebookId: 'notebook-1', request: async (_url, init) => {
    const body = init!.body as FormData;
    assert.equal(body.get('notebookId'), 'notebook-1');
    const batch = body.getAll('files') as File[]; batchSizes.push(batch.length);
    assert.ok(batch.length <= 5, 'The existing upload API must not receive more than five files.');
    return Response.json({ results: batch.map(file => file.name === 'candidate-1.txt' ? { error: 'candidate 1 failed' } : { ...outcome.papers[0], id: file.name, fileName: file.name }) });
  } });
  assert.deepEqual(batchSizes, [5, 5]);
  assert.equal(partial.papers.length, 9);
  assert.deepEqual(partial.successfulFileIndexes, [0, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(partial.errors, ['candidate 1 failed']);
  const pending = files.filter((_file, index) => !partial.successfulFileIndexes.includes(index));
  assert.deepEqual(pending.map(file => file.name), ['candidate-1.txt']);
  let lateRequests = 0;
  const lateFailure = await uploadDiscoveredSourceFiles({ files, request: async (_url, init) => {
    if (++lateRequests === 2) return new Response('unavailable', { status: 503 });
    return Response.json({ results: ((init!.body as FormData).getAll('files') as File[]).map(file => ({ ...outcome.papers[0], id: file.name })) });
  } });
  assert.equal(lateFailure.papers.length, 5, 'Later HTTP failure must retain acknowledged earlier sources.');
  assert.deepEqual(lateFailure.successfulFileIndexes, [0, 1, 2, 3, 4]);
  assert.match(lateFailure.errors[0], /503/);
  assert.equal(lateFailure.errors.length, 5);
  let abortedRequests = 0; const midAbort = new AbortController();
  await assert.rejects(() => uploadDiscoveredSourceFiles({ files, signal: midAbort.signal, request: async () => {
    abortedRequests++; midAbort.abort(); return Response.json({ results: [] });
  } }), /abort/i);
  assert.equal(abortedRequests, 1, 'Identity cancellation must not start a later batch.');
  const { isResearchToolCall } = await import('../src/lib/research-agent-contract');
  const importedCall = { id: 'search', plugin: 'paper-search', query: 'sample', status: 'ready', results: [{ title: 'Sample', link: 'https://arxiv.org/abs/2501.01234', snippet: 'metadata only' }], ingestedSources: [{ link: 'https://arxiv.org/abs/2501.01234', sourceId: 'paper-1' }] };
  assert.equal(isResearchToolCall(importedCall), true);
  assert.equal(isResearchToolCall({ ...importedCall, ingestedSources: [{ ...importedCall.ingestedSources[0], sourceId: '../other' }] }), false);
  assert.equal(isResearchToolCall({ ...importedCall, ingestedSources: [{ ...importedCall.ingestedSources[0], link: 'https://other.invalid/unselected' }] }), false);
  assert.equal(isResearchToolCall({ ...importedCall, ingestedSources: [...importedCall.ingestedSources, ...importedCall.ingestedSources] }), false);

  await assert.rejects(
    () => uploadDiscoveredSourceFiles({
      files: [new File(['x'], 'x.txt', { type: 'text/plain' })],
      notebookId: 'notebook-1',
      request: async () => new Response('upstream unavailable', { status: 502 }),
    }),
    /上传失败\(HTTP 502\)/,
  );

  const unknown = await uploadDiscoveredSourceFiles({ files: [new File(['x'], 'x.txt')], request: async () => Response.json({ results: [{ ...outcome.papers[0], year: undefined, authors: [] }] }) });
  assert.equal(unknown.papers.length, 1); assert.equal(unknown.papers[0].year, undefined);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(() => uploadDiscoveredSourceFiles({ files: [new File(['x'], 'x.txt')], signal: aborted.signal, request: async () => { throw new Error('must not call'); } }), /abort/i);
  let fetchCount = 0;
  const openSourceFile = await createDiscoveredSourceFile({
    title: 'Open Candidate',
    link: 'https://arxiv.org/abs/2501.01234',
    snippet: 'summary',
    content: 'A traceable open-source abstract with enough content to enter the literature library without scraping a publisher page. It still requires verification before citation.',
    date: '2025-01-10',
    authors: ['Ada Researcher'],
    provider: 'arxiv',
    verificationStatus: 'open-source-candidate',
  }, async () => {
    fetchCount += 1;
    throw new Error('embedded abstract must bypass page fetch');
  });
  assert.equal(fetchCount, 0);
  assert.match(await openSourceFile.text(), /来源类型:arXiv 开放元数据候选/);
  assert.match(await openSourceFile.text(), /requires verification before citation/);
  assert.deepEqual(sourceBibliography({ rawContent: await openSourceFile.text() }), { authors: ['Ada Researcher'], year: 2025 });
  assert.equal(sourceBibliography({ rawContent: '发布时间:2023-02-30\n作者:Sample' }).year, undefined);
  assert.equal(sourceBibliography({ rawContent: '正文在2018年讨论观测。' }).year, undefined);
  assert.equal(sourceBibliography({ rawContent: '发布时间:三年前\n作者:Sample' }).year, undefined);

  const fetchedFile = await createDiscoveredSourceFile({
    title: 'Fetched Candidate',
    link: 'https://example.org/paper',
    snippet: 'short',
  }, async () => {
    fetchCount += 1;
    return { title: 'Fetched Source Title', text: 'Fetched source content is long enough to be stored as a real source for later grounded retrieval and citation checks.' };
  });
  assert.equal(fetchCount, 1);
  assert.equal(fetchedFile.name, 'Fetched Source Title.txt');

  console.log(JSON.stringify({
    ok: true,
    checked: [
      'discovered source upload reuses /api/upload and preserves partial failures',
      'open-source abstracts bypass fragile publisher-page scraping',
      'candidates without usable content still use the existing fetch path',
    ],
  }, null, 2));
}

void main();
