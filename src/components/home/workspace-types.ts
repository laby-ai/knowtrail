import type { AccountAuthSession } from '@/lib/account-auth-client';

export interface WorkspaceNotebook {
  id: string;
  title: string;
  sourceCount: number;
  updatedAt: string;
  accent: string;
}

export type AccountCenterStatus = {
  configured: boolean;
  publicUrl: string | null;
  billingMode: 'not_configured' | 'portal_only' | 'reservation_ready';
  billingReservationReady: boolean;
  authRequired?: boolean;
};

export const NOTEBOOKS_STORAGE_KEY = 'lingbi-workspace-notebooks';
export const ACTIVE_NOTEBOOK_STORAGE_KEY = 'lingbi-active-workspace-notebook';
export const DEFAULT_WORKSPACE_UPDATED_AT = '2026-01-01T00:00:00.000Z';
// The app is mounted under /lingbi/ on airai.world, so post-login return
// targets must be prefixed — otherwise login bounces users to the company
// homepage (/) instead of back into the workbench.
export const NOTEBOOK_HOME_HREF = '/lingbi/?view=notebooks';
export const ACCOUNT_NOTEBOOK_NEXT = '%2Flingbi%2F%3Fview%3Dnotebooks';

export function scopedStorageKey(base: string, session: AccountAuthSession | null): string {
  return `${base}:${session?.member.id || 'guest'}`;
}

export function normalizeNotebookTitle(title: string, index = 0): string {
  if (title === '默认工作本' || title === 'Untitled notebook') return '未命名工作本';
  if (title.startsWith('资料工作台') || title.startsWith('Untitled notebook')) return index > 0 ? `未命名工作本 ${index + 1}` : '未命名工作本';
  return title || '未命名工作本';
}

export function createDefaultNotebooks(): WorkspaceNotebook[] {
  return [
    {
      id: 'default-workspace',
      title: '未命名工作本',
      sourceCount: 0,
      updatedAt: DEFAULT_WORKSPACE_UPDATED_AT,
      accent: 'from-sky-50 via-white to-cyan-50',
    },
  ];
}

export function formatNotebookDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}
