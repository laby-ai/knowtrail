import { commerceContext, keyHash } from './context';
import { CommerceError } from './account-client';
import type { CommerceResource } from './contracts';

type ProviderPayload = { usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }; data?: { url?: string; b64_json?: string }[]; output?: { task_id?: string; choices?: { message?: { content?: { image?: string }[] } }[]; results?: { url?: string }[] } };
function applyPayload(resource: CommerceResource, data: ProviderPayload) {
  const usage = data.usage;
  if (usage) {
    const input = usage.prompt_tokens ?? usage.input_tokens;
    const output = usage.completion_tokens ?? usage.output_tokens;
    if (Number.isSafeInteger(input) && Number.isSafeInteger(output) && input! >= 0 && output! >= 0) {
      resource.inputTokens = input; resource.outputTokens = output; resource.usageMissing = false;
      const cached = usage.prompt_tokens_details?.cached_tokens;
      if (Number.isSafeInteger(cached) && cached! >= 0 && cached! <= input!) resource.cachedInputTokens = cached;
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
    if (!context) return original(input, init);
    const taskId = String(input).match(/dashscope\.aliyuncs\.com\/api\/v1\/tasks\/([A-Za-z0-9_-]+)/)?.[1];
    if (taskId && (!init?.method || init.method === 'GET')) {
      const response = await original(input, init);
      const resource = context.imageTasks?.get(taskId);
      if (response.ok && resource) {
        try { applyPayload(resource, await response.clone().json() as ProviderPayload); } catch { /* Await a verified provider result. */ }
      }
      return response;
    }
    if (init?.method !== 'POST' || typeof init.body !== 'string') return original(input, init);
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
    let requestBody: typeof body & { max_tokens?: number } = body;
    if (context.enforcing) {
      const budget = context.quote!.resources.filter(item => item.rateKey === rateKey && item.source === source).reduce((sum, item) => ({ input: sum.input + (item.inputTokens || 0), output: sum.output + (item.outputTokens || 0), images: sum.images + (item.images || 0), queries: sum.queries + (item.queries || 0) }), { input: 0, output: 0, images: 0, queries: 0 });
      const previous = context.resources.filter(item => item !== resource && item.rateKey === rateKey && item.source === source && !item.retry && (item.status === undefined || (item.status >= 200 && item.status < 300)));
      const used = previous.reduce((sum, item) => ({ input: sum.input + (item.inputTokens ?? item.boundedInputTokens ?? 0), output: sum.output + (item.outputTokens ?? item.boundedOutputTokens ?? 0), images: sum.images + (item.images ?? item.requestedImages ?? 0), queries: sum.queries + (item.queries || 0) }), { input: 0, output: 0, images: 0, queries: 0 });
      if (source === 'platform' && previous.some(item => item.status !== undefined && item.usageMissing)) throw new CommerceError(402, 'previous_provider_usage_unverified');
      if (/\/chat\/completions/.test(address.pathname)) {
        if (Buffer.byteLength(init.body) + used.input > budget.input || used.output >= budget.output) throw new CommerceError(402, 'confirmed_usage_limit_reached');
        requestBody = { ...body, max_tokens: Math.min(8000, budget.output - used.output) };
        resource.boundedInputTokens = Buffer.byteLength(init.body); resource.boundedOutputTokens = requestBody.max_tokens;
      } else if (/\/images\/|\/aigc\//.test(address.pathname)) {
        resource.requestedImages = 1;
        if (used.images + resource.requestedImages > budget.images) throw new CommerceError(402, 'confirmed_image_limit_reached');
      }
      else if (/\/api\/v1\/search/.test(address.pathname) && used.queries >= budget.queries) throw new CommerceError(402, 'confirmed_search_limit_reached');
    }
    const requestInit = body.stream && /\/chat\/completions/.test(address.pathname)
      ? { ...init, body: JSON.stringify({ ...requestBody, stream_options: { include_usage: true } }) } : { ...init, body: JSON.stringify(requestBody) };
    let response: Response;
    try { response = await original(input, requestInit); } catch (error) { resource.status = 0; throw error; }
    resource.status = response.status;
    if (!response.ok || !response.body) return response;
    if (/\/api\/v1\/search/.test(address.pathname)) { resource.queries = 1; resource.usageMissing = false; }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      try {
        const payload = await response.clone().json() as ProviderPayload;
        applyPayload(resource, payload);
        if (payload.output?.task_id) (context.imageTasks ||= new Map()).set(payload.output.task_id, resource);
      } catch { /* No invented usage. */ }
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
