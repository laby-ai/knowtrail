export function appPublicPath(path: string): string {
  const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/$/, '');
  return `${basePath}${path}`;
}
