import assert from 'node:assert/strict';
import { mock } from 'node:test';
import dns from 'node:dns/promises';
import http, { type ClientRequest, type RequestOptions, IncomingMessage } from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { fetchPublicSource, isPublicSourceAddress, PublicSourceError } from '../src/lib/public-source-fetch';

const html = Buffer.from('<html><title>Public software fixture</title><article>12 records, 2 missing timestamps, 10 retained. Steps: import, check, exclude, verify. Software acceptance only; no scientific performance or significance.</article></html>');
const requests: { url: string; addresses: string[]; options: RequestOptions }[] = [];
let dnsCalls = 0;
let lookupAddresses = [{ address: '93.184.216.34', family: 4 }];
let responses: { status?: number; headers?: Record<string, string>; body?: Buffer }[] = [];
const lookup = mock.method(dns, 'lookup', async () => { dnsCalls++; return lookupAddresses; });

function requestStub(input: URL, options: RequestOptions, callback: (message: IncomingMessage) => void): ClientRequest {
  const req = Object.assign(new EventEmitter(), { end() {
    void (async () => {
      const addresses = await new Promise<string[]>((resolve, reject) => {
        assert.ok(options.lookup);
        options.lookup(input.hostname, { all: true }, (error, address) => {
          if (error) reject(error);
          else resolve((Array.isArray(address) ? address : [{ address }]).map(item => item.address));
        });
      });
      requests.push({ url: input.toString(), addresses, options });
      const fixture = responses.shift() || {};
      const response = new IncomingMessage(new Socket());
      response.statusCode = fixture.status || 200;
      response.headers = { 'content-type': 'text/html', ...fixture.headers };
      callback(response);
      response.push(fixture.body || html); response.push(null);
    })().catch(error => req.emit('error', error));
  } });
  return req as unknown as ClientRequest;
}
mock.method(http, 'request', requestStub);
mock.method(https, 'request', requestStub);

async function run() {
  const checked: string[] = [];
  for (const address of ['0.0.0.0','10.1.2.3','100.100.100.200','127.0.0.1','169.254.169.254','172.31.255.255','192.168.1.1','192.0.0.8','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::','::1','::ffff:127.0.0.1','::ffff:8.8.8.8','fc00::1','fe80::1','ff02::1','64:ff9b::7f00:1','2001:db8::1','2001::1','2002:7f00:1::','3fff::1']) {
    assert.equal(isPublicSourceAddress(address), false, address);
  }
  for (const address of ['8.8.8.8','1.1.1.1','93.184.216.34','2001:4860:4860::8888','2606:4700:4700::1111']) assert.equal(isPublicSourceAddress(address), true, address);
  const fetch = (url: string, signal = new AbortController().signal) => fetchPublicSource(new URL(url), signal);
  const rejected = async (url: string, status: number) => assert.rejects(fetch(url), (error: unknown) => error instanceof PublicSourceError && error.status === status, url);
  for (const url of ['http://127.0.0.1/','http://2130706433/','http://0x7f000001/','http://0177.0.0.1/','http://169.254.169.254/','https://[::1]/','https://[::ffff:127.0.0.1]/','http://10.1.2.3/','https://public.example:5098/','https://user:password@public.example/']) await rejected(url, 403);
  await rejected('file:///etc/passwd', 400);
  assert.equal(requests.length, 0);
  checked.push('literal, encoded IPv4, mapped IPv6, private/special address, credentials and nonstandard port refused before transport');
  lookupAddresses = [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }];
  await rejected('https://mixed.example/', 403); assert.equal(requests.length, 0);
  lookupAddresses = [{ address: '127.0.0.1', family: 4 }];
  await rejected('https://private.example/', 403); assert.equal(requests.length, 0);
  checked.push('DNS private or mixed public/private answers refused before connection');
  lookupAddresses = [{ address: '93.184.216.34', family: 4 }]; dnsCalls = 0;
  const publicResult = await fetch('https://public.example/paper');
  assert.deepEqual(publicResult.buffer, html); assert.equal(dnsCalls, 1);
  assert.deepEqual(requests.at(-1)?.addresses, ['93.184.216.34']);
  assert.equal(requests.at(-1)?.url, 'https://public.example/paper');
  assert.equal(requests.at(-1)?.options.agent, false);
  assert.ok(!('rejectUnauthorized' in requests.at(-1)!.options));
  assert.ok(!('Authorization' in requests.at(-1)!.options.headers!) && !('Cookie' in requests.at(-1)!.options.headers!));
  checked.push('one checked DNS lookup pinned at connection; original TLS hostname retained, no credentials or shared agent');
  responses = [{ status: 302, headers: { location: 'http://127.0.0.1/secret' } }];
  const before = requests.length; await rejected('https://public.example/redirect', 403);
  assert.equal(requests.length, before + 1);
  responses = [{ status: 302, headers: { location: '/paper' } }, {}];
  assert.deepEqual((await fetch('https://public.example/relative')).buffer, html);
  assert.equal(requests.at(-1)?.url, 'https://public.example/paper');
  responses = Array.from({ length: 6 }, () => ({ status: 302, headers: { location: '/again' } }));
  const loopBefore = requests.length; await rejected('https://public.example/loop', 502);
  assert.equal(requests.length, loopBefore + 6);
  checked.push('each redirect revalidated, public relative redirect preserved, redirect loop bounded');
  for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]] as const) {
    responses = [{ headers: { 'content-encoding': encoding }, body: compress(html) }];
    assert.deepEqual((await fetch('https://public.example/compressed')).buffer, html);
  }
  responses = [{ headers: { 'content-type': 'application/pdf' } }]; await rejected('https://public.example/pdf', 415);
  responses = [{ body: Buffer.alloc(3_000_001, 97) }]; await rejected('https://public.example/large', 413);
  responses = [{ headers: { 'content-encoding': 'gzip' }, body: gzipSync(Buffer.alloc(3_000_001, 97)) }]; await rejected('https://public.example/zip-large', 413);
  checked.push('public HTML and gzip/deflate/brotli preserved; PDF and oversized decoded responses rejected');
  lookup.mock.mockImplementation(async () => new Promise<never>(() => {}));
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(new DOMException('Fixture timeout', 'TimeoutError')), 10);
  try { await assert.rejects(fetch('https://slow.example/', controller.signal), (error: unknown) => error instanceof Error && error.name === 'TimeoutError'); }
  finally { clearTimeout(timeout); }
  const stopped = new AbortController(); stopped.abort(); await assert.rejects(fetch('https://public.example/', stopped.signal));
  checked.push('deadline covers DNS, cancellation rejects without network');
  console.log(JSON.stringify({ ok: true, checked, outboundNetworkRequests: 0, paidCalls: 0 }, null, 2));
}
run().finally(() => mock.restoreAll()).catch(error => { console.error(error); process.exitCode = 1; });
