import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http';
import https, { type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { PassThrough } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { NextRequest } from 'next/server';
import { POST as extractFullText } from '../src/app/api/literature/fulltext/route';
import {
  discoverOaLocations,
  fetchFullText,
  fetchFullTextFromUrl,
  fetchLiteratureFullText,
  FullTextError,
} from '../src/lib/literature/fulltext';
import type { FullTextFailureCode } from '../src/lib/literature/types';

const PUBLIC_IP = '93.184.216.34';
const PDF_URL = 'https://papers.example/paper.pdf';
const DOI = '10.1234/paper';
const API_URL = `https://api.unpaywall.org/v2/${encodeURIComponent(DOI)}?email=${encodeURIComponent(process.env.UNPAYWALL_EMAIL || 'research@tashan.chat')}`;
const MAX_BYTES = 20 * 1024 * 1024;

// A real one-page PDF exercises pdf-parse-fixed, not a mocked extractor.
function pdfFixture(text = 'Offline literature full text'): Buffer {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

interface Reply {
  status?: number;
  headers?: IncomingHttpHeaders;
  body?: string | Buffer | Buffer[];
  hang?: 'headers' | 'body';
  error?: Error;
}

// Mock only DNS and HTTPS boundaries; never open real sockets.
function offline(
  t: TestContext,
  routes: Record<string, Reply>,
  lookup: (hostname: string) => Promise<LookupAddress[]> = async () => [{ address: PUBLIC_IP, family: 4 }],
) {
  const calls: { url: string; options: RequestOptions; request: FakeRequest; response?: PassThrough }[] = [];
  const dnsCalls: string[] = [];
  const unexpected: string[] = [];
  class FakeRequest extends EventEmitter {
    destroyed = false;
    constructor(private readonly start: () => void) { super(); }
    end() { queueMicrotask(this.start); return this; }
    destroy(error?: Error) {
      if (this.destroyed) return this;
      this.destroyed = true;
      if (error) this.emit('error', error);
      return this;
    }
  }
  t.mock.method(dns, 'lookup', async (hostname: string) => {
    dnsCalls.push(hostname);
    return lookup(hostname);
  });
  t.mock.method(https, 'request', (url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const request = new FakeRequest(() => {
      if (request.destroyed) return;
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      assert.equal(options.agent, false);
      assert.equal(options.rejectUnauthorized, true);
      assert.ok(options.family === 4 || options.family === 6);
      assert.equal(options.servername, isIP(hostname) ? undefined : hostname);
      assert.ok(options.lookup);
      // Both lookup forms must expose only the previously verified address.
      options.lookup(hostname, { all: false }, (error, address, family) => {
        assert.ifError(error);
        assert.equal(typeof address, 'string');
        assert.equal(family, options.family);
      });
      options.lookup(hostname, { all: true }, (error, addresses) => {
        assert.ifError(error);
        assert.ok(Array.isArray(addresses));
        assert.equal(addresses.length, 1);
        assert.equal(addresses[0].family, options.family);
      });
      const reply = routes[url.href];
      if (!reply) {
        unexpected.push(url.href);
        request.destroy(new Error('Unexpected offline request'));
        return;
      }
      if (reply.error) { request.destroy(reply.error); return; }
      if (reply.hang === 'headers') return;
      const response = Object.assign(new PassThrough(), {
        statusCode: reply.status ?? 200,
        headers: reply.headers ?? {},
        complete: false,
      });
      entry.response = response;
      callback(response as unknown as IncomingMessage);
      if (response.destroyed || reply.hang === 'body') return;
      const chunks = Array.isArray(reply.body) ? reply.body : [reply.body ?? ''];
      for (const chunk of chunks) {
        if (response.destroyed) break;
        response.write(chunk);
      }
      if (!response.destroyed) { response.complete = true; response.end(); }
    });
    const entry: (typeof calls)[number] = { url: url.href, options, request };
    calls.push(entry);
    const abort = () => {
      entry.response?.destroy();
      request.destroy(new Error('Aborted'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    t.after(() => options.signal?.removeEventListener('abort', abort));
    return request as unknown as ClientRequest;
  });
  t.after(() => assert.deepEqual(unexpected, []));
  return { calls, dnsCalls };
}

function hasCode(code: FullTextFailureCode) {
  return (error: unknown) => error instanceof FullTextError && error.code === code;
}

function oaReply(urls: string[], landingUrl?: string): Reply {
  return { body: JSON.stringify({
    is_oa: urls.length > 0 || Boolean(landingUrl),
    best_oa_location: { url_for_pdf: urls[0] ?? null, url: landingUrl ?? null },
    oa_locations: urls.slice(1).map(url_for_pdf => ({ url_for_pdf })),
  }) };
}

// Yield to stream end/nextTick callbacks as well as promises, without sleeps.
async function flushPromises() {
  await new Promise<void>(resolve => setImmediate(resolve));
}

test('direct signed PDF succeeds with real extraction and no Unpaywall lookup', async t => {
  const url = `${PDF_URL}?X-Amz-Signature=a%2Fb&expires=9999`;
  const { calls } = offline(t, { [url]: { body: pdfFixture() } });
  const before = process.env.PDF_PARSER_DISABLE_TEST;
  const result = await fetchLiteratureFullText({ doi: DOI, arxivId: 'not-an-id', url });
  assert.equal(result.fullText, 'Offline literature full text');
  assert.equal(result.charCount, result.fullText.length);
  assert.equal(result.pdfUrl, url);
  assert.equal(result.source, 'direct');
  assert.equal(calls.length, 1);
  assert.equal(process.env.PDF_PARSER_DISABLE_TEST, before);
});

test('read-only route preserves direct extraction and typed failure responses', async t => {
  const routes: Record<string, Reply> = { [PDF_URL]: { body: pdfFixture() }, [API_URL]: oaReply([]) };
  offline(t, routes);
  const request = (body: unknown) => extractFullText(new NextRequest('https://app.example/api/literature/fulltext', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const success = await request({ type: 'url', pdfUrl: PDF_URL });
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), {
    success: true, fullText: 'Offline literature full text', pdfUrl: PDF_URL,
    source: 'direct', charCount: 'Offline literature full text'.length,
  });
  for (const [body, status, code] of [
    [{ type: 'doi', doi: DOI }, 404, 'no_oa'],
    [{ type: 'url', pdfUrl: 'https://127.0.0.1/private.pdf' }, 400, 'unsafe_url'],
  ] as const) {
    const response = await request(body);
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, code);
  }
  routes[PDF_URL] = { body: '<html>landing page</html>' };
  assert.equal((await request({ type: 'url', pdfUrl: PDF_URL })).status, 422);
  routes[PDF_URL] = { headers: { 'content-length': String(MAX_BYTES + 1) } };
  assert.equal((await request({ type: 'url', pdfUrl: PDF_URL })).status, 413);
  routes[PDF_URL] = { status: 503 };
  assert.equal((await request({ type: 'url', pdfUrl: PDF_URL })).status, 502);
});

test('legacy direct-URL API returns nonempty text even for an explicitly supplied extensionless URL', async t => {
  const url = 'https://papers.example/download?token=signed';
  offline(t, { [url]: { body: pdfFixture() } });
  assert.equal(await fetchFullTextFromUrl(url), 'Offline literature full text');
});

for (const id of ['2501.01234v2', '0704.0001', 'hep-th/9901001v2', 'math.GT/0309136']) {
  test(`valid arXiv ID ${id} uses its canonical PDF URL`, async t => {
    const url = `https://arxiv.org/pdf/${id}`;
    const { calls } = offline(t, { [url]: { body: pdfFixture() } });
    const result = await fetchLiteratureFullText({ arxivId: id, url: 'https://arxiv.org/abs/ignored' });
    assert.equal(result.pdfUrl, url);
    assert.equal(result.source, 'direct');
    assert.equal(calls.length, 1);
  });
}

test('missing/malformed identifiers and landing pages make no network requests', async t => {
  const { calls, dnsCalls } = offline(t, {});
  for (const arxivId of [undefined, '', '../private', '2500.12345', '2513.12345', '2501.0123', '2501.00000', '2501.12345v0', 'hep-th/2501001']) {
    await assert.rejects(fetchLiteratureFullText({ arxivId, url: 'https://publisher.example/article/123' }), hasCode('no_identifier'));
  }
  await assert.rejects(fetchLiteratureFullText({ url: '' }), hasCode('no_identifier'));
  await assert.rejects(fetchFullText(''), hasCode('no_identifier'));
  await assert.rejects(discoverOaLocations('invalid DOI'), hasCode('no_identifier'));
  assert.equal(calls.length + dnsCalls.length, 0);
});

test('DOI discovery preserves landing URL but never downloads it as a PDF', async t => {
  const landing = 'https://publisher.example/article/123';
  const { calls } = offline(t, { [API_URL]: oaReply([], landing) });
  assert.deepEqual(await discoverOaLocations(DOI), { pdfUrl: null, landingUrl: landing });
  await assert.rejects(fetchFullText(DOI), hasCode('no_oa'));
  assert.deepEqual(calls.map(call => call.url), [API_URL, API_URL]);
});

test('closed access is no_oa; malformed JSON, DNS failure and HTTP errors are network_error', async t => {
  const routes: Record<string, Reply> = { [API_URL]: oaReply([]) };
  offline(t, routes, async hostname => {
    if (hostname === 'dns-failure.example') throw new Error('ENOTFOUND');
    return [{ address: PUBLIC_IP, family: 4 }];
  });
  await assert.rejects(fetchFullText(DOI), hasCode('no_oa'));
  for (const body of ['{', '{}', 'null']) {
    routes[API_URL] = { body };
    await assert.rejects(fetchFullText(DOI), hasCode('network_error'));
  }
  routes[API_URL] = { status: 503 };
  await assert.rejects(fetchFullText(DOI), hasCode('network_error'));
  await assert.rejects(fetchFullTextFromUrl('https://dns-failure.example/p.pdf'), hasCode('network_error'));
});

test('tries arXiv, direct PDF, and all distinct Unpaywall PDFs until one succeeds', async t => {
  const arxiv = 'https://arxiv.org/pdf/2501.01234';
  const bad = 'https://repository.example/bad.pdf';
  const good = 'https://repository.example/good.pdf';
  const { calls } = offline(t, {
    [arxiv]: { status: 503 },
    [PDF_URL]: { body: '<html>not a PDF</html>' },
    [API_URL]: oaReply([PDF_URL, bad, bad, good]),
    [bad]: { body: pdfFixture('') },
    [good]: { body: pdfFixture() },
  });
  const result = await fetchLiteratureFullText({ doi: DOI, arxivId: '2501.01234', url: PDF_URL });
  assert.equal(result.pdfUrl, good);
  assert.equal(result.source, 'unpaywall');
  assert.deepEqual(calls.map(call => call.url), [arxiv, PDF_URL, API_URL, bad, good]);
});

test('unsafe candidate does not prevent a usable DOI alternative', async t => {
  const { calls } = offline(t, { [API_URL]: oaReply([PDF_URL]), [PDF_URL]: { body: pdfFixture() } });
  const result = await fetchLiteratureFullText({ doi: DOI, url: 'https://127.0.0.1/private.pdf' });
  assert.equal(result.pdfUrl, PDF_URL);
  assert.deepEqual(calls.map(call => call.url), [API_URL, PDF_URL]);
});

for (const [name, body] of [
  ['HTML with PDF content type', Buffer.from('<html>landing page</html>')],
  ['corrupt PDF', Buffer.from('%PDF-1.4\nbroken')],
  ['scanned/empty PDF', pdfFixture('')],
  ['high-bit fake magic', Buffer.from([0xa5, 0xd0, 0xc4, 0xc6, 0xad])],
] as const) {
  test(`${name} is extraction_failed`, async t => {
    offline(t, { [PDF_URL]: { body, headers: { 'content-type': 'application/pdf' } } });
    await assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('extraction_failed'));
  });
}

test('rejects unsafe URL schemes, credentials, ports and all special-use literal address classes', async t => {
  const { calls, dnsCalls } = offline(t, {});
  const hosts = [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.88.99.1', '192.168.1.1',
    '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255',
    '2130706433', '0x7f000001', '[::]', '[::1]', '[::ffff:127.0.0.1]',
    '[::ffff:93.184.216.34]', '[fc00::1]', '[fe80::1]', '[ff02::1]',
    '[64:ff9b::7f00:1]', '[2001::1]', '[2001:db8::1]', '[2002:7f00:1::]', '[3ffe::1]', '[3fff::1]',
  ];
  for (const url of [
    ...hosts.map(host => `https://${host}/p.pdf`),
    'http://papers.example/p.pdf', 'ftp://papers.example/p.pdf', 'file:///p.pdf',
    'https://name:secret@papers.example/p.pdf', 'https://papers.example:8443/p.pdf', 'not a url',
  ]) await assert.rejects(fetchFullTextFromUrl(url), hasCode('unsafe_url'), url);
  assert.equal(calls.length + dnsCalls.length, 0);
});

test('rejects blocked and mixed DNS answers, including IPv4-mapped IPv6', async t => {
  const addresses = ['127.0.0.1', '169.254.169.254', '100.100.100.200', '::1', '::ffff:127.0.0.1', 'fd00::1'];
  let answer: LookupAddress[] = [];
  const { calls } = offline(t, {}, async () => answer);
  for (const address of addresses) {
    answer = [{ address, family: isIP(address) }];
    await assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('unsafe_url'));
    answer.unshift({ address: PUBLIC_IP, family: 4 });
    await assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('unsafe_url'));
  }
  answer = [];
  await assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('unsafe_url'));
  assert.equal(calls.length, 0);
});

test('pins verified DNS addresses with original hostname and TLS SNI', async t => {
  let lookups = 0;
  const { calls, dnsCalls } = offline(t, { [PDF_URL]: { body: pdfFixture() } }, async () => {
    lookups++;
    return [{ address: lookups === 1 ? PUBLIC_IP : '127.0.0.1', family: 4 }];
  });
  await fetchFullTextFromUrl(PDF_URL);
  const { options } = calls[0];
  options.lookup?.('papers.example', { all: false }, (error, address) => {
    assert.ifError(error);
    assert.equal(address, PUBLIC_IP);
  });
  assert.deepEqual(dnsCalls, ['papers.example']);
  assert.equal(options.servername, 'papers.example');
});

test('public IPv6 and explicit default HTTPS port are accepted', async t => {
  const url = 'https://[2606:4700:4700::1111]/p.pdf';
  const { dnsCalls } = offline(t, { [url]: { body: pdfFixture() }, [PDF_URL]: { body: pdfFixture() } });
  await fetchFullTextFromUrl(url);
  await fetchFullTextFromUrl(PDF_URL.replace('papers.example', 'papers.example:443'));
  assert.deepEqual(dnsCalls, ['papers.example']);
});

test('validates redirect protocol, literal and DNS destinations before connecting', async t => {
  const routes: Record<string, Reply> = {};
  const { calls } = offline(t, routes, async host => [{ address: host === 'private.example' ? '10.0.0.1' : PUBLIC_IP, family: 4 }]);
  for (const location of ['http://papers.example/p.pdf', 'https://127.0.0.1/p.pdf', 'https://private.example/p.pdf', 'https://user:pass@papers.example/p.pdf', 'https://papers.example:444/p.pdf']) {
    routes[PDF_URL] = { status: 302, headers: { location } };
    await assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('unsafe_url'));
  }
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call.url === PDF_URL));
});

test('allows three verified relative redirects but refuses a fourth', async t => {
  const routes: Record<string, Reply> = {};
  for (let i = 0; i < 4; i++) routes[`https://papers.example/${i}.pdf`] = { status: 307, headers: { location: `/${i + 1}.pdf` } };
  const { calls, dnsCalls } = offline(t, routes);
  await assert.rejects(fetchFullTextFromUrl('https://papers.example/0.pdf'), hasCode('network_error'));
  assert.equal(calls.length, 4);
  routes['https://papers.example/3.pdf'] = { body: pdfFixture() };
  await fetchFullTextFromUrl('https://papers.example/0.pdf');
  assert.equal(calls.length, 8);
  assert.equal(dnsCalls.length, 8);
});

test('bounds declared and streamed bytes, and rejects incomplete/compressed responses', async t => {
  const routes: Record<string, Reply> = {};
  const { calls } = offline(t, routes);
  routes[PDF_URL] = { headers: { 'content-length': String(MAX_BYTES + 1) }, hang: 'body' };
  await assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('too_large'));
  assert.equal(calls[0].response?.destroyed, true);
  routes[PDF_URL] = { body: [Buffer.alloc(MAX_BYTES), Buffer.from('x')] };
  await assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('too_large'));
  assert.equal(calls[1].response?.destroyed, true);
  for (const headers of [{ 'content-length': '10000' }, { 'content-length': 'invalid' }, { 'content-encoding': 'gzip' }]) {
    routes[PDF_URL] = { body: pdfFixture(), headers };
    await assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('network_error'));
  }
  routes[API_URL] = { headers: { 'content-length': String(1024 * 1024 + 1) } };
  await assert.rejects(fetchFullText(DOI), hasCode('too_large'));
});

test('socket errors and premature body closure are network_error', async t => {
  const routes: Record<string, Reply> = { [PDF_URL]: { error: new Error('TLS handshake failed') } };
  const { calls } = offline(t, routes);
  await assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('network_error'));
  routes[PDF_URL] = { hang: 'body' };
  const rejected = assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('network_error'));
  await flushPromises();
  calls[1].response?.destroy();
  await rejected;
  assert.equal(calls[1].request.destroyed, true);
});

test('redirect to the same host revalidates DNS instead of trusting its earlier answer', async t => {
  let lookups = 0;
  const { calls } = offline(t, {
    [PDF_URL]: { status: 302, headers: { location: '/new.pdf' } },
  }, async () => [{ address: ++lookups === 1 ? PUBLIC_IP : '127.0.0.1', family: 4 }]);
  await assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('unsafe_url'));
  assert.equal(lookups, 2);
  assert.equal(calls.length, 1);
});

test('DNS timeout cannot open a socket after a late public answer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let completeLookup: (addresses: LookupAddress[]) => void = () => assert.fail('DNS not started');
  const { calls } = offline(t, {}, () => new Promise(resolve => { completeLookup = resolve; }));
  const rejected = assert.rejects(fetchFullTextFromUrl(PDF_URL), hasCode('network_error'));
  await flushPromises();
  t.mock.timers.tick(15_001);
  await rejected;
  completeLookup([{ address: PUBLIC_IP, family: 4 }]);
  await flushPromises();
  assert.equal(calls.length, 0);
});

for (const hang of ['headers', 'body'] as const) {
  test(`${hang} timeout destroys request and permits the next candidate`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const arxiv = 'https://arxiv.org/pdf/2501.01234';
    const { calls } = offline(t, { [arxiv]: { hang }, [PDF_URL]: { body: pdfFixture() } });
    const pending = fetchLiteratureFullText({ arxivId: '2501.01234', url: PDF_URL });
    await flushPromises();
    t.mock.timers.tick(15_001);
    const result = await pending;
    assert.equal(result.pdfUrl, PDF_URL);
    assert.equal(calls[0].request.destroyed, true);
    if (hang === 'body') assert.equal(calls[0].response?.destroyed, true);
  });
}

test('all candidates and discovery share one finite total timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const urls = Array.from({ length: 8 }, (_, i) => `https://papers.example/${i}.pdf`);
  const routes: Record<string, Reply> = { [API_URL]: oaReply(urls) };
  for (const url of urls) routes[url] = { hang: 'headers' };
  const { calls } = offline(t, routes);
  const rejected = assert.rejects(fetchFullText(DOI), hasCode('network_error'));
  await flushPromises();
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(15_000);
    await flushPromises();
  }
  await rejected;
  assert.equal(Date.now(), 61_000);
  assert.equal(calls.length, 5); // One discovery plus four timed-out PDFs, not eight.
  assert.ok(calls.slice(1).every(call => call.request.destroyed));
});
