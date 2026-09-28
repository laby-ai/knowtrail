import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { searchAllSources } from '@/lib/literature/service';
import type { LiteratureProviderId } from '@/lib/literature/types';
import { LITERATURE_PROVIDER_IDS } from '@/lib/literature/types';

const sourceEnum = z.enum([
  'crossref', 'europepmc', 'semantic-scholar', 'openalex', 'arxiv', 'pubmed', 'scite',
]);

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  sources: z.array(sourceEnum).min(1).max(7).optional(),
  limitPerSource: z.number().int().min(1).max(50).optional(),
  yearFrom: z.number().int().min(1900).max(2100).optional(),
  yearTo: z.number().int().min(1900).max(2100).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = searchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数错误', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { query, sources, limitPerSource, yearFrom, yearTo } = parsed.data;
    const userId = request.headers.get('x-user-id') || 'anonymous';

    const results = await searchAllSources({
      query,
      sources: sources as LiteratureProviderId[],
      limitPerSource: limitPerSource || 10,
      userId,
      yearFrom,
      yearTo,
    });

    return NextResponse.json({
      success: true,
      query,
      total: results.length,
      sources: sources || [...LITERATURE_PROVIDER_IDS],
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '搜索失败';
    console.error('[Literature Search]', message);

    if (message.includes('频率超限')) {
      return NextResponse.json({ error: message }, { status: 429 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    sources: LITERATURE_PROVIDER_IDS,
    displayNames: {
      crossref: 'Crossref',
      europepmc: 'Europe PMC',
      'semantic-scholar': 'Semantic Scholar',
      openalex: 'OpenAlex',
      arxiv: 'arXiv',
      pubmed: 'PubMed',
      scite: 'Scite',
    },
  });
}
