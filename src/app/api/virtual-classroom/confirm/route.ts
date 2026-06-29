import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import {
  buildConfirmedClassroomDraft,
  type VirtualClassroomConfirmedOutline,
  type VirtualClassroomOutlineDraft,
} from '@/lib/virtual-classroom/outline-draft';
import { publicClassroomOrigin } from '@/lib/virtual-classroom/runtime-config';

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'virtual-classroom');

function configuredClassroomOrigin(): string {
  return publicClassroomOrigin();
}

function isDraft(value: unknown): value is VirtualClassroomOutlineDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<VirtualClassroomOutlineDraft>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    candidate.status === 'draft' &&
    Array.isArray(candidate.scenes) &&
    candidate.scenes.length > 0
  );
}

async function writeConfirmedEvidence(confirmed: VirtualClassroomConfirmedOutline): Promise<string> {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const fileName = `confirmed-outline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const fullPath = path.join(OUTPUT_DIR, fileName);
  await writeFile(fullPath, JSON.stringify(confirmed, null, 2), 'utf8');
  return fullPath;
}

function buildRuntimeClassroomUrl(draft: VirtualClassroomOutlineDraft): string {
  const classroomOrigin = configuredClassroomOrigin();
  if (!classroomOrigin) {
    throw new Error('课堂服务未连接，请稍后再试。');
  }

  if (classroomOrigin.startsWith('/')) {
    const params = new URLSearchParams({
      draft: buildConfirmedClassroomDraft(draft).slice(0, 1800),
      embed: 'lingbi',
    });
    return `${classroomOrigin}?${params.toString()}`;
  }

  const url = new URL(classroomOrigin);
  url.searchParams.set('draft', buildConfirmedClassroomDraft(draft).slice(0, 1800));
  url.searchParams.set('embed', 'lingbi');
  return url.toString();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const draft = body?.draft;
    if (!isDraft(draft)) {
      return NextResponse.json({ ok: false, error: '缺少可确认的课程大纲。' }, { status: 400 });
    }

    const classroomUrl = buildRuntimeClassroomUrl(draft);

    const confirmed: VirtualClassroomConfirmedOutline = {
      ...draft,
      confirmationStatus: 'confirmed',
      confirmedAt: new Date().toISOString(),
      classroomUrl,
    };
    const artifactPath = await writeConfirmedEvidence(confirmed);

    return NextResponse.json({
      ok: true,
      confirmed,
      classroomUrl,
      artifactPath,
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '确认课程大纲失败';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
