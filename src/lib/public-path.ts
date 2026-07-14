function publicBasePath(): string {
  const configured = process.env.NEXT_PUBLIC_BASE_PATH?.trim();
  if (!configured || configured === '/') return '';
  return `/${configured.replace(/^\/+|\/+$/g, '')}`;
}

export function publicAssetPath(value: string): string {
  const normalized = `/${value.trim().replace(/^\/+/, '')}`;
  return `${publicBasePath()}${normalized}`;
}
