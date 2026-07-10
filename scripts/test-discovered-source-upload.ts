import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const modulePath = path.join(process.cwd(), 'src/lib/discovered-source-upload.ts');
type UploadRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function main() {
  assert.ok(fs.existsSync(modulePath), 'Paper search should upload selected sources through a focused adapter');
  const { uploadDiscoveredSourceFiles } = await import('../src/lib/discovered-source-upload');
  const { createDiscoveredSourceFile } = await import('../src/lib/discovered-source-file');
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

  await assert.rejects(
    () => uploadDiscoveredSourceFiles({
      files: [new File(['x'], 'x.txt', { type: 'text/plain' })],
      notebookId: 'notebook-1',
      request: async () => new Response('upstream unavailable', { status: 502 }),
    }),
    /上传失败\(HTTP 502\)/,
  );

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
