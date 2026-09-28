import dns from 'node:dns/promises';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { FullTextFailureCode, FullTextResult, LiteratureMetadata } from './types';

const UNPAYWALL_API = 'https://api.unpaywall.org/v2';
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const ATTEMPT_TIMEOUT_MS = 15_000;
const TOTAL_TIMEOUT_MS = 60_000;
const MAX_CANDIDATES = 8;

export class FullTextError extends Error {
  constructor(public readonly code: FullTextFailureCode, message: string) {
    super(message);
    this.name = 'FullTextError';
  }
}

// Reject special-use and IPv6 translation/tunnel ranges, including mapped public IPv4.
const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3ffe::', 16], ['3fff::', 20],
] as const) blockedAddresses.addSubnet(address, prefix, 'ipv6');
const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, 'ipv4');
  return family === 6 && globalIpv6.check(address, 'ipv6') &&
    !blockedAddresses.check(address, 'ipv6');
}

function safeUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FullTextError('unsafe_url', '全文地址无效');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new FullTextError('unsafe_url', '全文地址必须使用 HTTPS，且不能包含凭据或非默认端口');
  }
  return url;
}

function asNetworkError(error: unknown): FullTextError {
  return error instanceof FullTextError ? error :
    new FullTextError('network_error', '全文网络请求失败');
}

// Recheck cancellation after DNS: a late answer must not open a socket past the shared deadline.
async function withinDeadline<T>(deadline: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const remaining = Math.min(ATTEMPT_TIMEOUT_MS, deadline - Date.now());
  if (remaining <= 0) throw new FullTextError('network_error', '全文获取超时');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new FullTextError('network_error', '全文获取超时');
      controller.abort(error);
      reject(error);
    }, remaining);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } catch (error: unknown) {
    throw asNetworkError(error);
  } finally {
    clearTimeout(timer);
  }
}

async function requestBody(value: string, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  let url = safeUrl(value);
  for (let redirects = 0; ; redirects++) {
    signal.throwIfAborted();
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const literalFamily = isIP(hostname);
    const addresses = literalFamily ? [{ address: hostname, family: literalFamily }] :
      await dns.lookup(hostname, { all: true, verbatim: true });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(({ address, family }) =>
      family !== isIP(address) || !isPublicAddress(address))) {
      throw new FullTextError('unsafe_url', '全文地址解析到非公网地址');
    }
    const pinned = addresses[0];
    const result = await new Promise<Buffer | URL>((resolve, reject) => {
      const request = https.request(url, {
        method: 'GET',
        agent: false,
        signal,
        family: pinned.family,
        rejectUnauthorized: true,
        servername: literalFamily ? undefined : hostname,
        // Pin the verified IP without replacing the original TLS hostname.
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [pinned]);
          else callback(null, pinned.address, pinned.family);
        },
        headers: {
          Accept: maxBytes === MAX_PDF_BYTES ? 'application/pdf' : 'application/json',
          'Accept-Encoding': 'identity',
          'User-Agent': 'KnowTrail literature fulltext',
        },
      }, response => {
        let finished = false;
        const fail = (error: FullTextError) => {
          if (finished) return;
          finished = true;
          reject(error);
          response.destroy();
          request.destroy();
        };
        response.on('error', error => fail(asNetworkError(error)));
        response.on('aborted', () => fail(new FullTextError('network_error', '全文下载中断')));
        response.on('close', () => {
          if (!finished) fail(new FullTextError('network_error', '全文下载中断'));
        });
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          try {
            if (redirects >= 3 || !response.headers.location) {
              throw new FullTextError('network_error', '全文重定向次数过多或缺少地址');
            }
            const next = safeUrl(new URL(response.headers.location, url).href);
            finished = true;
            resolve(next);
            response.destroy();
          } catch (error: unknown) {
            fail(error instanceof FullTextError ? error : new FullTextError('unsafe_url', '全文重定向地址无效'));
          }
          return;
        }
        if (status < 200 || status >= 300) {
          fail(new FullTextError('network_error', `全文请求失败：HTTP ${status}`));
          return;
        }
        const declared = response.headers['content-length'];
        if (declared !== undefined && !/^\d+$/.test(declared)) {
          fail(new FullTextError('network_error', '全文响应长度无效'));
          return;
        }
        if (declared !== undefined && Number(declared) > maxBytes) {
          fail(new FullTextError('too_large', '全文响应超过大小限制'));
          return;
        }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          fail(new FullTextError('network_error', '全文响应使用了不支持的压缩编码'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          if (finished) return;
          size += chunk.length;
          if (size > maxBytes) {
            fail(new FullTextError('too_large', '全文响应超过大小限制'));
          } else {
            chunks.push(chunk);
          }
        });
        response.on('end', () => {
          if (finished) return;
          if (declared !== undefined && Number(declared) !== size) {
            fail(new FullTextError('network_error', '全文响应不完整'));
          } else {
            finished = true;
            resolve(Buffer.concat(chunks, size));
          }
        });
      });
      request.on('error', error => reject(asNetworkError(error)));
      request.end();
    });
    if (Buffer.isBuffer(result)) return result;
    url = result;
  }
}

function normalizeDoi(value: string | undefined): string | null {
  const doi = value?.trim().replace(/^(?:https:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '');
  return doi && /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : null;
}

function arxivPdfUrl(value: string | undefined): string | null {
  const id = value?.trim();
  if (!id) return null;
  const modern = /^(\d{2})(0[1-9]|1[0-2])\.(\d{4,5})(?:v[1-9]\d*)?$/.exec(id);
  const legacy = /^[a-z]+(?:-[a-z]+)*(?:\.[A-Z]{2})?\/(\d{2})(0[1-9]|1[0-2])(\d{3})(?:v[1-9]\d*)?$/.exec(id);
  const match = modern ?? legacy;
  if (!match || Number(match[3]) === 0) return null;
  const year = Number(match[1]) + (legacy && Number(match[1]) >= 91 ? 1900 : 2000);
  const date = year * 100 + Number(match[2]);
  if (modern ? date < 200704 || match[3].length !== (date < 201501 ? 4 : 5) :
    date < 199108 || date > 200703) return null;
  return `https://arxiv.org/pdf/${id}`;
}

function isExplicitPdfUrl(value: string): boolean {
  try {
    const path = decodeURIComponent(new URL(value).pathname);
    return /\.pdf\/?$/i.test(path) || /\/(?:pdf|epdf)(?:\/|$)/i.test(path);
  } catch {
    return false;
  }
}

function isLikelyHtml(buffer: Buffer): boolean {
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html');
}

function extractPdfUrlsFromHtml(buffer: Buffer, baseUrl: string): string[] {
  const html = buffer.toString('utf8', 0, Math.min(buffer.length, 512 * 1024));
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  const seen = new Set<string>();
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = hrefRe.exec(html)) !== null && results.length < 5) {
    try {
      const resolved = new URL(match[1], baseUrl);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
      const path = decodeURIComponent(resolved.pathname);
      if (/\.pdf(?:\?|$)/i.test(path) && !seen.has(resolved.href)) {
        seen.add(resolved.href);
        results.push(resolved.href);
      }
    } catch { /* skip malformed URLs */ }
  }
  return results;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ?
    value as Record<string, unknown> : null;
}

async function discover(doi: string, deadline: number): Promise<{ pdfUrls: string[]; landingUrl: string | null }> {
  const email = process.env.UNPAYWALL_EMAIL || 'research@tashan.chat';
  const url = `${UNPAYWALL_API}/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`;
  return withinDeadline(deadline, async signal => {
    const body = await requestBody(url, signal, 1024 * 1024);
    let data: Record<string, unknown> | null;
    try {
      data = record(JSON.parse(body.toString('utf8')) as unknown);
    } catch {
      throw new FullTextError('network_error', 'Unpaywall 响应格式无效');
    }
    if (!data || typeof data.is_oa !== 'boolean') {
      throw new FullTextError('network_error', 'Unpaywall 响应格式无效');
    }
    const locations = [data.best_oa_location, ...(Array.isArray(data.oa_locations) ? data.oa_locations : [])];
    const pdfUrls = new Set<string>();
    let landingUrl: string | null = null;
    for (const location of locations) {
      const item = record(location);
      if (typeof item?.url_for_pdf === 'string' && item.url_for_pdf.trim()) pdfUrls.add(item.url_for_pdf.trim());
      if (!landingUrl && typeof item?.url === 'string') landingUrl = item.url || null;
    }
    return { pdfUrls: [...pdfUrls].slice(0, MAX_CANDIDATES), landingUrl };
  });
}

export async function discoverOaLocations(doi: string): Promise<{ pdfUrl: string | null; landingUrl: string | null }> {
  const normalized = normalizeDoi(doi);
  if (!normalized) throw new FullTextError('no_identifier', '缺少有效 DOI');
  const { pdfUrls, landingUrl } = await discover(normalized, Date.now() + TOTAL_TIMEOUT_MS);
  return { pdfUrl: pdfUrls[0] ?? null, landingUrl };
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new FullTextError('extraction_failed', '下载内容不是 PDF，无法提取全文');
  }
  try {
    const pdfParse = (await import('pdf-parse-fixed')).default;
    // PDF.js needs Uint8Array copy semantics rather than pooled Buffer views.
    const result = await pdfParse(new Uint8Array(buffer));
    const text = result.text.trim();
    if (!text) throw new Error('Empty PDF text');
    return text;
  } catch {
    throw new FullTextError('extraction_failed', 'PDF 文本提取失败，文件可能损坏或为扫描件');
  }
}

async function fetchCandidate(pdfUrl: string, deadline: number, tried?: Set<string>): Promise<string> {
  return withinDeadline(deadline, async signal => {
    const buffer = await requestBody(pdfUrl, signal, MAX_PDF_BYTES);
    signal.throwIfAborted();
    if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      if (isLikelyHtml(buffer)) {
        const pdfLinks = extractPdfUrlsFromHtml(buffer, pdfUrl);
        for (const link of pdfLinks) {
          if ((tried?.has(link)) || (tried && tried.size >= MAX_CANDIDATES)) continue;
          tried?.add(link);
          try {
            const linkBuffer = await requestBody(link, signal, MAX_PDF_BYTES);
            signal.throwIfAborted();
            if (linkBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
              return extractPdfText(linkBuffer);
            }
          } catch { /* try next link */ }
        }
      }
      throw new FullTextError('extraction_failed', '下载内容不是 PDF，无法提取全文');
    }
    return extractPdfText(buffer);
  });
}

export async function fetchLiteratureFullText(
  literature: Pick<LiteratureMetadata, 'doi' | 'arxivId' | 'url' | 'oaLocations'>,
): Promise<FullTextResult> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const doi = normalizeDoi(literature.doi);
  const arxivUrl = arxivPdfUrl(literature.arxivId);
  const candidates = [arxivUrl, literature.url || null];
  const tried = new Set<string>();
  let failure: FullTextError | undefined;
  const tryCandidates = async (urls: (string | null)[], source: FullTextResult['source']) => {
    for (const pdfUrl of urls) {
      if (!pdfUrl || tried.has(pdfUrl) || tried.size >= MAX_CANDIDATES) continue;
      tried.add(pdfUrl);
      try {
        const fullText = await fetchCandidate(pdfUrl, deadline, tried);
        return { fullText, pdfUrl, source, charCount: fullText.length };
      } catch (error: unknown) {
        failure = asNetworkError(error);
      }
      if (Date.now() >= deadline) break;
    }
    return null;
  };
  const direct = await tryCandidates(candidates, 'direct');
  if (direct) return direct;
  const oaPdfUrls = (literature.oaLocations || [])
    .map(loc => loc.pdfUrl || loc.url)
    .filter((url): url is string => !!url);
  const oa = await tryCandidates(oaPdfUrls, 'oa');
  if (oa) return oa;
  if (doi && Date.now() < deadline) {
    try {
      const { pdfUrls } = await discover(doi, deadline);
      const result = await tryCandidates(pdfUrls, 'unpaywall');
      if (result) return result;
    } catch (error: unknown) {
      failure ??= asNetworkError(error);
    }
  }
  if (failure) throw failure;
  if (!doi && !arxivUrl && !tried.size) throw new FullTextError('no_identifier', '缺少有效 DOI、arXiv ID 或直接 PDF 地址');
  throw new FullTextError('no_oa', '该论文暂无开放获取 PDF 全文');
}

export async function fetchFullText(doi: string): Promise<FullTextResult> {
  return fetchLiteratureFullText({ doi, url: '' });
}

export async function fetchFullTextFromUrl(pdfUrl: string): Promise<string> {
  return fetchCandidate(pdfUrl, Date.now() + TOTAL_TIMEOUT_MS, new Set<string>());
}
