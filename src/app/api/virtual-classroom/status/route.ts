import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { internalClassroomOrigin, publicClassroomOrigin } from '@/lib/virtual-classroom/runtime-config';
import { classroomStorageCandidates } from '@/lib/virtual-classroom/classroom-storage';

const CLASSROOM_REFERENCE_NAME = `Open${String.fromCharCode(77, 65, 73, 67)}`;
const CLASSROOMS_DIRS = classroomStorageCandidates(process.cwd(), CLASSROOM_REFERENCE_NAME);

interface ClassroomFile {
  id?: string;
  stage?: {
    name?: string;
    description?: string;
    updatedAt?: number;
  };
  scenes?: Array<{ type?: string; actions?: unknown[] }>;
  createdAt?: string;
}

async function readRecentClassrooms(origin: string) {
  const classrooms = (
    await Promise.all(CLASSROOMS_DIRS.map(async (classroomsDir) => {
      try {
        const files = await fs.readdir(classroomsDir);
        return await Promise.all(
          files.filter((file) => file.endsWith('.json')).map(async (file) => {
            const fullPath = path.join(classroomsDir, file);
            const [stat, raw] = await Promise.all([fs.stat(fullPath), fs.readFile(fullPath, 'utf8')]);
            const data = JSON.parse(raw) as ClassroomFile;
            const id = data.id || file.replace(/\.json$/, '');
            return {
              id,
              title: data.stage?.name || '未命名课堂',
              description: data.stage?.description || '',
              scenesCount: data.scenes?.length ?? 0,
              actionsCount:
                data.scenes?.reduce((sum, scene) => sum + (scene.actions?.length ?? 0), 0) ?? 0,
              sceneTypes: Array.from(new Set((data.scenes || []).map((scene) => scene.type).filter(Boolean))),
              createdAt: data.createdAt || stat.mtime.toISOString(),
              updatedAt: stat.mtime.toISOString(),
              url: `${origin}/classroom/${id}`,
              exportUrl: `${origin}/api/classroom?id=${encodeURIComponent(id)}`,
            };
          }),
        );
      } catch {
        return [];
      }
    }))
  ).flat();

  const newestById = new Map<string, (typeof classrooms)[number]>();
  for (const classroom of classrooms) {
    const existing = newestById.get(classroom.id);
    if (!existing || Date.parse(classroom.updatedAt) > Date.parse(existing.updatedAt)) {
      newestById.set(classroom.id, classroom);
    }
  }

  return Array.from(newestById.values())
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 3);
}

async function readHealth(origin: string) {
  const normalizedOrigin = origin.replace(/\/$/, '');
  const healthOrigins = normalizedOrigin.endsWith('/classroom-runtime')
    ? [normalizedOrigin]
    : [`${normalizedOrigin}/classroom-runtime`, normalizedOrigin];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    let lastStatus = 0;
    for (const healthOrigin of healthOrigins) {
      const response = await fetch(`${healthOrigin}/api/health`, { cache: 'no-store', signal: controller.signal });
      lastStatus = response.status;
      if (!response.ok) continue;
      const data = await response.json();
      return { ok: true, status: response.status, origin: healthOrigin, data };
    }
    return { ok: false, status: lastStatus || 502 };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const origin = publicClassroomOrigin();
  const healthOrigin = internalClassroomOrigin();
  if (!origin) {
    return NextResponse.json({
      ok: false,
      mode: 'unavailable',
      origin: '',
      health: { ok: false, status: 503, error: 'classroom_runtime_not_configured' },
      recentClassrooms: [],
    }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const [health, recentClassrooms] = await Promise.all([
    readHealth(healthOrigin),
    readRecentClassrooms(origin),
  ]);

  return NextResponse.json({
    ok: health.ok,
    mode: health.ok ? 'external' : 'unavailable',
    origin,
    health,
    recentClassrooms,
  });
}
