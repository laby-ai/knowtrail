import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ClientRequestError, clientApiDownloadBlob, clientApiFetch, clientApiRequest,
} from '../src/lib/client-api';

const started = new Set<string>();
const server = createServer((request, response) => {
  const path = request.url || '/';
  const blob = path.includes('blob');
  response.writeHead(path.includes('unauthorized') ? 401 : 200, {
    'Content-Type': blob ? 'application/octet-stream' : 'application/json',
  });
  response.write(blob ? 'first' : '{"ok":');
  started.add(path);
  const timer = setTimeout(() => response.end(blob ? 'last' : 'true}'), path.includes('slow') ? 300 : 0);
  response.on('close', () => clearTimeout(timer));
});
let baseUrl = '';
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

for (const kind of ['json', 'blob'] as const) {
  const read = kind === 'json' ? clientApiFetch : clientApiDownloadBlob;
  test(`${kind}: completed bodies release the caller's abort listener`, async () => {
    const caller = new AbortController();
    for (let index = 0; index < 3; index += 1) {
      const result = await read(`${baseUrl}/${kind}`, { signal: caller.signal, skipAuth: true });
      if (result instanceof Blob) assert.equal(await result.text(), 'firstlast');
      else assert.deepEqual(result, { ok: true });
      assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
    }
  });

  test(`${kind}: timeout includes a body that stalls after headers`, async () => {
    const caller = new AbortController();
    const path = `/slow-${kind}-timeout`;
    await assert.rejects(read(`${baseUrl}${path}`, {
      timeoutMs: 100, signal: caller.signal, skipAuth: true,
    }), (error: unknown) => error instanceof ClientRequestError && error.code === 'timeout');
    assert.ok(started.has(path), 'the server must have sent the headers and first body bytes');
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  });

  test(`${kind}: cancelling a body read remains a cancellation`, async () => {
    const caller = new AbortController();
    const path = `/slow-${kind}-cancel`;
    const request = read(`${baseUrl}${path}`, { signal: caller.signal, skipAuth: true });
    const result = assert.rejects(request,
      (error: unknown) => error instanceof ClientRequestError && error.code === 'cancelled');
    await delay(50);
    assert.ok(started.has(path));
    caller.abort();
    await result;
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  });
}

test('a stalled unauthorized body reports timeout before login side effects', async () => {
  let sideEffects = 0;
  const storage = { removeItem: () => { sideEffects += 1; } };
  Object.assign(globalThis, { window: {
    localStorage: storage, sessionStorage: storage,
    location: { pathname: '/', search: '', hash: '', replace: () => { sideEffects += 1; } },
  } });
  try {
    await assert.rejects(clientApiFetch(`${baseUrl}/slow-unauthorized`, {
      timeoutMs: 100, skipAuth: true,
    }), (error: unknown) => error instanceof ClientRequestError && error.code === 'timeout');
    assert.equal(sideEffects, 0, 'an interrupted body must not clear login state or redirect');
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
});

test('raw streams keep caller cancellation after the header timeout window', async () => {
  const caller = new AbortController();
  const response = await clientApiRequest(`${baseUrl}/slow-stream`, {
    timeoutMs: 100, signal: caller.signal, skipAuth: true,
  });
  const reader = response.body!.getReader();
  assert.equal((await reader.read()).done, false);
  await delay(150);
  const next = reader.read();
  const rejected = assert.rejects(next, (error: unknown) => error instanceof Error && error.name === 'AbortError');
  caller.abort();
  await rejected;
});
