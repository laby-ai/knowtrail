export type ZhiqiHostContext = {
  enabled: boolean;
  workspaceKey: string;
  notebookId: string;
  workspaceTitle: string;
};

export const EMPTY_ZHIQI_HOST_CONTEXT: ZhiqiHostContext = {
  enabled: false,
  workspaceKey: '',
  notebookId: '',
  workspaceTitle: '',
};

function sanitizeWorkspaceKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 96);
}

function normalizeWorkspaceTitle(value: string): string {
  return value.trim().slice(0, 80);
}

export function parseZhiqiHostContext(params: URLSearchParams): ZhiqiHostContext {
  const requested = params.get('embed') === 'zhiqi-research' && params.get('host') === 'zhiqi-studio';
  const workspaceKey = sanitizeWorkspaceKey(params.get('workspaceKey') || '');
  if (!requested || !workspaceKey) return EMPTY_ZHIQI_HOST_CONTEXT;

  return {
    enabled: true,
    workspaceKey,
    notebookId: `zhiqi-${workspaceKey}`,
    workspaceTitle: normalizeWorkspaceTitle(params.get('workspaceTitle') || '') || '论文研究工作区',
  };
}
