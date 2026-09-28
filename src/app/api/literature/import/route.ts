import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { accountAuthRequired, resolveAccountSessionFromRequest } from '@/lib/account-session';
import { importLiteratureSource } from '@/lib/ingestion-store';
import { MAX_LITERATURE_RESULT_TOKEN_LENGTH, verifyLiteratureResult } from '@/lib/literature/result-token';
import { normalizeNotebookId } from '@/lib/notebook-scope';

const importSchema = z.object({
  resultToken: z.string().min(1).max(MAX_LITERATURE_RESULT_TOKEN_LENGTH),
  notebookId: z.string().min(1).max(128),
}).strict();

export async function POST(request: NextRequest) {
  let ownerMemberId: string;
  try {
    const session = await resolveAccountSessionFromRequest(request);
    if (!session?.member.id) {
      if (!accountAuthRequired()) {
        ownerMemberId = 'local';
      } else {
        return NextResponse.json({ error: '请先登录账号，再将文献加入文献本。' }, { status: 401 });
      }
    } else {
      ownerMemberId = session.member.id;
    }
  } catch {
    return NextResponse.json({ error: '账号登录已过期，请重新登录。' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '文献导入参数无效，请重新选择文献。' }, { status: 400 });
  }
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '文献导入参数无效，请重新选择文献。' }, { status: 400 });
  }
  const notebookId = normalizeNotebookId(parsed.data.notebookId);
  const literature = verifyLiteratureResult(parsed.data.resultToken);
  if (!notebookId || !literature) {
    return NextResponse.json({ error: '文献本或检索结果无效，请重新检索后再试。' }, { status: 400 });
  }

  try {
    const abstract = literature.abstract.trim();
    const result = await importLiteratureSource({
      ...literature,
      abstract,
      evidenceScope: abstract ? 'abstract' : 'metadata',
    }, { ownerMemberId, notebookId });
    return NextResponse.json({ success: true, ...result }, {
      status: result.alreadyExists ? 200 : 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: '暂时无法保存文献，请稍后重试。' }, { status: 500 });
  }
}
