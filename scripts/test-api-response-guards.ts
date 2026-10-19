import assert from 'node:assert/strict';
import { assertApiResponse, checkedApiFetch } from '../src/lib/api-response';
import { clientApiFetch, clientApiRequest, clientApiDownloadBlob, ClientRequestError } from '../src/lib/client-api';

async function main() {
  const original = globalThis.fetch;
  let makeResponse = () => new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async () => makeResponse();
  try {
    for (const status of [200, 413, 502, 504]) {
      makeResponse = () => new Response('<html><h1>Proxy error</h1></html>', { status, headers: { 'Content-Type': 'text/html' } });
      for (const call of [() => clientApiRequest('/api/test'), () => clientApiFetch('/api/test'), () => clientApiDownloadBlob('/api/test'), () => checkedApiFetch('/api/test')]) {
        await assert.rejects(call, error => error instanceof Error && !/Unexpected token|<html>/.test(error.message) && (status === 200 || error.message.includes(`HTTP ${status}`)));
      }
    }
    makeResponse = () => new Response('{"broken":', { headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(clientApiRequest('/api/test'), error => error instanceof ClientRequestError && error.code === 'invalid_payload');
    makeResponse = () => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } });
    assert.deepEqual(await (await clientApiRequest('/api/test')).json(), { ok: true });
    assert.deepEqual(await clientApiFetch('/api/test'), { ok: true });
    makeResponse = () => new Response('{"error":"余额不足"}', { status: 409, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(clientApiFetch('/api/test'), /余额不足/);
    makeResponse = () => new Response('data: hello\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    assert.equal(await (await clientApiRequest('/api/stream')).text(), 'data: hello\n\n');
    makeResponse = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
    assert.equal((await clientApiDownloadBlob('/api/image')).size, 3);
    await assertApiResponse(new Response('<html>user-owned document</html>', { headers: { 'Content-Type': 'text/html', 'Content-Disposition': 'attachment; filename="document.html"' } }), '下载', true);
    await assert.rejects(assertApiResponse(new Response('<html>error</html>')), /非预期数据/);
    console.log('PASS: central and direct API guards, gateway HTML, malformed JSON, preserved JSON errors, streams, binary downloads and intentional HTML attachments');
  } finally { globalThis.fetch = original; }
}
void main();
