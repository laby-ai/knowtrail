import { ResearchMcpError } from './research-client';

/** Enforce actual streamed bytes, including clients without Content-Length. */
export async function readResearchBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new ResearchMcpError('请求内容超过大小限制。', 413); }
      chunks.push(item.value);
    }
    return Uint8Array.from(Buffer.concat(chunks));
  } finally { reader.releaseLock(); }
}
