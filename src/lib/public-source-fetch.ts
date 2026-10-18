import dns from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import http, { type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

const MAX_HTML_BYTES = 3_000_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export class PublicSourceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function isPublicSourceAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const parts = address.split(':');
    const first = parseInt(parts[0], 16);
    const second = parseInt(parts[1] || '0', 16);
    // Global unicast only; exclude special-use, documentation and IPv4 tunnels.
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3ffe
      && !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8))
      && !(first === 0x3fff && second < 0x1000);
  }
  return false;
}

async function publicAddresses(url: URL, signal: AbortSignal): Promise<LookupAddress[]> {
  if (!['http:', 'https:'].includes(url.protocol)) throw new PublicSourceError('仅支持 http/https 链接', 400);
  if (url.username || url.password || url.port) throw new PublicSourceError('仅支持标准端口、无需账号密码的公开网页链接', 403);
  signal.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: LookupAddress[];
  if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) }];
  else {
    let abort = () => {};
    try {
      addresses = await Promise.race([
        dns.lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
    } finally { signal.removeEventListener('abort', abort); }
  }
  if (!addresses.length || addresses.some(item => !isPublicSourceAddress(item.address))) {
    throw new PublicSourceError('仅支持公开网页，无法读取本机或内网地址', 403);
  }
  return addresses;
}

function connect(url: URL, addresses: LookupAddress[], signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      agent: false, signal,
      // Use the addresses just checked, preserving the original Host and TLS name.
      // A second DNS lookup here could resolve to an unchecked private address.
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KnowTrailBot/1.0; +https://airai.world)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    };
    const request = (url.protocol === 'https:' ? https : http).request(url, options, resolve);
    request.once('error', reject);
    request.end();
  });
}

export async function fetchPublicSource(initial: URL, signal: AbortSignal) {
  let url = initial;
  for (let hop = 0; hop <= 5; hop++) {
    const addresses = await publicAddresses(url, signal);
    const response = await connect(url, addresses, signal);
    const status = response.statusCode || 502;
    if (REDIRECTS.has(status)) {
      response.destroy();
      if (!response.headers.location || hop === 5) throw new PublicSourceError('网页跳转过多或缺少有效跳转地址', 502);
      url = new URL(response.headers.location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new PublicSourceError(`网页返回 HTTP ${status}`, 502);
    }
    const contentType = response.headers['content-type'] || '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      response.destroy();
      throw new PublicSourceError(`暂不支持的内容类型:${contentType.split(';')[0] || '未知'}`, 415);
    }
    const encoding = response.headers['content-encoding']?.trim().toLowerCase();
    const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null;
    if (encoding && encoding !== 'identity' && !decoder) {
      response.destroy();
      throw new PublicSourceError('暂不支持此网页的压缩格式', 415);
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    const sink = new Writable({ write(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_HTML_BYTES) return callback(new PublicSourceError('网页过大,无法抓取', 413));
      chunks.push(chunk); callback();
    } });
    if (decoder) await pipeline(response, decoder, sink, { signal });
    else await pipeline(response, sink, { signal });
    return { buffer: Buffer.concat(chunks), contentType };
  }
  throw new PublicSourceError('网页跳转过多', 502);
}
