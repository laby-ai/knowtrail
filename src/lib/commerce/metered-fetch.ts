import { commerceContext, keyHash } from './context';
import { CommerceError } from './account-client';
import type { CommerceResource } from './contracts';

type ProviderPayload = { usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number }; data?: { url?: string; b64_json?: string }[]; output?: { choices?: { message?: { content?: { image?: string }[] } }[]; results?: { url?: string }[] } };
function applyPayload(resource: CommerceResource, data: ProviderPayload) {
  const usage = data.usage;
  if (usage) {
    const input = usage.prompt_tokens ?? usage.input_tokens;
    const output = usage.completion_tokens ?? usage.output_tokens;
    if (Number.isSafeInteger(input) && Number.isSafeInteger(output) && input! >= 0 && output! >= 0) {
      resource.inputTokens = input; resource.outputTokens = output; resource.usageMissing = false;
    }
  }
  const images = (data.data || []).filter(item => item.url || item.b64_json).length +
    (data.output?.choices || []).flatMap(item => item.message?.content || []).filter(item => item.image).length + (data.output?.results || []).filter(item => item.url).length;
  if (images) { resource.images = images; resource.usageMissing = false; }
}

export function installMeteredFetch() {
  const root = globalThis as typeof globalThis & { lingbiMeterInstalled?: boolean };
  if (root.lingbiMeterInstalled) return;
  root.lingbiMeterInstalled = true;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const context = commerceContext.getStore();
    if (!context || init?.method !== 'POST' || typeof init.body !== 'string') return original(input, init);
    let address: URL;
    try { address = new URL(String(input)); } catch { return original(input, init); }
    if (!/\/chat\/completions|\/images\/generations|\/aigc\/|\/api\/v1\/search/.test(address.pathname)) return original(input, init);
    let body: { model?: string; stream?: boolean; stream_options?: unknown };
    try { body = JSON.parse(init.body) as typeof body; } catch { return original(input, init); }
    const apiKey = new Headers(init.headers).get('Authorization')?.replace(/^Bearer\s+/i, '') || new Headers(init.headers).get('X-API-Key') || '';
    const source = context.providers.get(keyHash(apiKey)) || 'platform';
    const rateKey = `${address.hostname}:${body.model || 'search'}`;
    const callHash = keyHash(address.origin + address.pathname + init.body);
    const resource: CommerceResource = { rateKey, source, usageMissing: true, retry: context.calls.has(callHash) };
    context.calls.add(callHash);
    if (context.enforcing && !context.quote?.resources.some(item => item.rateKey === rateKey && item.source === source)) throw new CommerceError(402, 'resource_not_in_confirmed_quote');
    context.resources.push(resource);
    const requestInit = body.stream && /\/chat\/completions/.test(address.pathname)
      ? { ...init, body: JSON.stringify({ ...body, stream_options: { include_usage: true } }) } : init;
    let response: Response;
    try { response = await original(input, requestInit); } catch (error) { resource.status = 0; throw error; }
    resource.status = response.status;
    if (!response.ok || !response.body) return response;
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      try { applyPayload(resource, await response.clone().json() as ProviderPayload); } catch { /* No invented usage. */ }
      return response;
    }
    const decoder = new TextDecoder();
    let buffer = '';
    const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) if (line.startsWith('data:')) {
          try { applyPayload(resource, JSON.parse(line.slice(5).trim()) as ProviderPayload); } catch { /* Keepalive or DONE. */ }
        }
        if (buffer.length > 1_000_000) buffer = ''; // bounded transient parser; never persist text
        controller.enqueue(chunk);
      },
    }));
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
