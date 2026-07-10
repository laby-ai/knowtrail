export const CLASSROOM_RUNTIME_PREFIX = '/classroom-runtime';

const classroomRootProxyPrefixes = [
  '/api/access-code/',
  '/api/azure-voices',
  '/api/chat',
  '/api/classroom',
  '/api/classroom-media/',
  '/api/generate/',
  '/api/generate-classroom',
  '/api/parse-pdf',
  '/api/pbl/',
  '/api/proxy-media',
  '/api/quiz-grade',
  '/api/server-providers',
  '/api/transcription',
  '/api/verify-',
  '/api/web-search',
  '/avatars/',
  '/logos/',
];

export function resolveClassroomProxyTarget(requestUrl: string, pathname: string) {
  const runtimePath = pathname === CLASSROOM_RUNTIME_PREFIX
    || pathname.startsWith(`${CLASSROOM_RUNTIME_PREFIX}/`);
  const rootPath = classroomRootProxyPrefixes.some(prefix => pathname.startsWith(prefix));

  if (!runtimePath && !rootPath) return { shouldProxy: false, targetPath: '' };
  if (!runtimePath) return { shouldProxy: true, targetPath: requestUrl || pathname };

  const stripped = (requestUrl || pathname).slice(CLASSROOM_RUNTIME_PREFIX.length);
  return { shouldProxy: true, targetPath: stripped || '/' };
}
