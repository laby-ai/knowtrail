import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { formatCitation, formatBibliography } from '@/lib/literature/citations';
import { verifyLiteratureResult } from '@/lib/literature/result-token';
import type { CitationPaper, CitationStyle } from '@/lib/literature/types';

const citationStyleEnum = z.enum(['bibtex', 'apa', 'mla', 'chicago', 'ieee', 'GB/T 7714']);

const paperSchema = z.object({
  title: z.string(),
  authors: z.array(z.object({ name: z.string() })),
  year: z.union([z.number(), z.string()]),
  doi: z.string().optional(),
  arxivId: z.string().optional(),
  venue: z.string().optional(),
  url: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  publisher: z.string().optional(),
});

const citeSchema = z.object({
  papers: z.array(paperSchema).optional(),
  resultIds: z.array(z.string()).optional(),
  style: citationStyleEnum,
}).refine(data => data.papers || data.resultIds, {
  message: '必须提供 papers 或 resultIds',
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = citeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: '参数错误', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { papers, resultIds, style } = parsed.data;
    let citationPapers: CitationPaper[] = [];

    if (papers) {
      citationPapers = papers as CitationPaper[];
    } else if (resultIds) {
      for (const resultId of resultIds) {
        const payload = verifyLiteratureResult(resultId);
        if (payload) {
          citationPapers.push({
            title: payload.title,
            authors: payload.authors,
            year: payload.year,
            doi: payload.doi,
            arxivId: payload.arxivId,
            venue: payload.venue,
            url: payload.url,
          });
        }
      }
    }

    if (citationPapers.length === 0) {
      return NextResponse.json(
        { error: '没有有效的论文数据' },
        { status: 400 }
      );
    }

    const citations = citationPapers.map(p => formatCitation(p, style as CitationStyle));
    const bibliography = formatBibliography(citationPapers, style as CitationStyle);

    return NextResponse.json({
      success: true,
      style,
      count: citationPapers.length,
      citations,
      bibliography,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '引用格式化失败';
    console.error('[Literature Cite]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
