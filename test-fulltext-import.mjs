import { createHmac } from 'node:crypto';

const API_BASE = 'http://127.0.0.1:5001';
const TEST_DOI = '10.48550/arXiv.2303.08774'; // GPT-4 paper on arXiv
const SECRET = process.env.LITERATURE_HMAC_SECRET || 'dev-literature-hmac-secret-change-in-prod';

function signResultToken(paper) {
  const payload = {
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    doi: paper.doi,
    arxivId: paper.arxivId,
    abstract: paper.abstract,
    venue: paper.venue,
    url: paper.url,
    source: paper.source,
    provider: paper.provider,
    evidenceScope: paper.evidenceScope,
    retrievedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(payload);
  const hmac = createHmac('sha256', SECRET).update(json).digest('hex');
  const b64 = Buffer.from(json).toString('base64url');
  return `${b64}.${hmac}`;
}

async function testImportWithFullText() {
  console.log('Testing literature import with automatic full text retrieval (arXiv paper)...\n');

  const loginRes = await fetch('http://127.0.0.1:8088/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com' }),
  });
  const loginData = await loginRes.json();
  const authToken = loginData.token;

  const paper = {
    title: 'GPT-4 Technical Report',
    authors: [{ name: 'OpenAI' }],
    year: 2023,
    doi: TEST_DOI,
    arxivId: '2303.08774',
    abstract: 'We report the development of GPT-4, a large-scale multimodal model.',
    venue: 'arXiv',
    url: 'https://arxiv.org/abs/2303.08774',
    source: 'arxiv',
    provider: 'arXiv',
    evidenceScope: 'abstract',
  };

  const resultToken = signResultToken(paper);

  const res = await fetch(`${API_BASE}/api/literature/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      notebookId: 'test-notebook-arxiv',
      resultToken,
    }),
  });

  const data = await res.json();

  if (data.source?.literature?.evidenceScope === 'fulltext') {
    console.log('✓ SUCCESS: Full text was automatically fetched!');
    console.log(`  Evidence scope: ${data.source.literature.evidenceScope}`);
    console.log(`  Chunk count: ${data.source.chunkCount}`);
    console.log(`  Token estimate: ${data.source.tokenEstimate}`);
  } else {
    console.log('✗ Full text not retrieved');
    console.log(`  Evidence scope: ${data.source?.literature?.evidenceScope}`);
    console.log(`  Chunk count: ${data.source?.chunkCount}`);
  }
}

testImportWithFullText().catch(console.error);
