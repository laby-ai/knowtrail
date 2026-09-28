import crypto from 'crypto';
import { z } from 'zod';
import { LITERATURE_PROVIDER_IDS, type LiteratureMetadata, type LiteraturePaper } from './types';

const HMAC_SECRET_ENV = 'LITERATURE_HMAC_SECRET';
export const MAX_LITERATURE_RESULT_TOKEN_LENGTH = 512_000;

function getSecret(): string {
  return process.env[HMAC_SECRET_ENV] || 'dev-literature-hmac-secret-change-in-prod';
}

type SignedPayload = LiteratureMetadata;

function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.href.replace(/[<>]/g, char => encodeURIComponent(char));
  } catch {
    return undefined;
  }
}

const signedPayloadSchema: z.ZodType<SignedPayload> = z.object({
  title: z.string().trim().min(1).max(2_000),
  authors: z.array(z.object({ name: z.string().trim().min(1).max(500) })).max(2_000),
  year: z.union([
    z.number().int().min(0).max(9999),
    z.string().trim().max(32).regex(/^(?:\d{4}|n\.?d\.?|unknown|未知|)$/i),
  ]),
  doi: z.string().trim().max(2_048).optional(),
  arxivId: z.string().trim().max(256).optional(),
  abstract: z.string().max(200_000),
  venue: z.string().max(2_000),
  url: z.string().trim().max(8_192).refine(value => value === '' || Boolean(safeHttpUrl(value))),
  source: z.enum(LITERATURE_PROVIDER_IDS),
  provider: z.string().trim().min(1).max(200),
  evidenceScope: z.enum(['abstract', 'metadata', 'fulltext']),
  retrievedAt: z.string().datetime({ offset: true }),
  oaLocations: z.array(z.object({
    url: z.string().trim().max(8_192),
    pdfUrl: z.string().trim().max(8_192).optional(),
    source: z.string().trim().max(200),
    license: z.string().trim().max(200).optional(),
  })).optional(),
});

export function signLiteratureResult(paper: LiteraturePaper): string {
  const payload: SignedPayload = {
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
    oaLocations: paper.oaLocations,
  };

  const json = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', getSecret()).update(json).digest('hex');
  const b64 = Buffer.from(json).toString('base64url');
  return `${b64}.${hmac}`;
}

export function verifyLiteratureResult(token: string): SignedPayload | null {
  if (typeof token !== 'string' || !token || token.length > MAX_LITERATURE_RESULT_TOKEN_LENGTH) return null;
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 1) return null;
  const b64 = token.slice(0, dotIdx);
  const providedHmac = token.slice(dotIdx + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(b64) || !/^[a-f0-9]{64}$/.test(providedHmac)) return null;

  try {
    const json = Buffer.from(b64, 'base64url').toString('utf-8');
    const expectedHmac = crypto.createHmac('sha256', getSecret()).update(json).digest();
    const signature = Buffer.from(providedHmac, 'hex');
    if (signature.length !== expectedHmac.length || !crypto.timingSafeEqual(signature, expectedHmac)) return null;
    const parsed = signedPayloadSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function literatureSourceId(payload: SignedPayload): string {
  return `${payload.source}:${payload.doi || payload.arxivId || payload.title.slice(0, 50)}`;
}

export function literatureText(payload: SignedPayload, fullText?: string): string {
  const authors = payload.authors.map(a => a.name).join(', ');
  const originalUrl = safeHttpUrl(payload.url);
  const lines = [
    `# ${payload.title}`,
    '',
    `**作者**: ${authors}`,
    `**年份**: ${payload.year}`,
    `**来源**: ${payload.venue}`,
    `**DOI**: ${payload.doi || 'N/A'}`,
    `**数据源**: ${payload.provider}`,
    ...(originalUrl ? [`**原文链接**: [查看原文](<${originalUrl}>)`] : []),
    '',
    '## 摘要',
    '',
    payload.abstract || '(无摘要)',
  ];

  if (fullText) {
    lines.push('', '## 全文', '', fullText);
  }

  return lines.join('\n');
}
