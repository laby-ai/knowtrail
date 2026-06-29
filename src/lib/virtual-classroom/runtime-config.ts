export const CLASSROOM_RUNTIME_PROXY_ORIGIN = '/classroom-runtime';

function normalizeOrigin(value: string | undefined): string {
  return (value || '').trim().replace(/\/$/, '');
}

export function publicClassroomOrigin(): string {
  const publicOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_VIRTUAL_CLASSROOM_ORIGIN);
  if (publicOrigin) return publicOrigin;
  return normalizeOrigin(process.env.VIRTUAL_CLASSROOM_INTERNAL_ORIGIN)
    ? CLASSROOM_RUNTIME_PROXY_ORIGIN
    : '';
}

export function internalClassroomOrigin(): string {
  return normalizeOrigin(process.env.VIRTUAL_CLASSROOM_INTERNAL_ORIGIN) || publicClassroomOrigin();
}

export function classroomRuntimeConfigured(): boolean {
  return Boolean(publicClassroomOrigin() && internalClassroomOrigin());
}
