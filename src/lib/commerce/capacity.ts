import type { NextRequest } from 'next/server';
import { resolveAccountSessionFromRequest } from '@/lib/account-session';
import { listIngestionSources } from '@/lib/ingestion-store';
import { listNotebooks } from '@/lib/notebook-store';
import { commerceAccount } from './account-client';
export async function reserveCapacity(request: NextRequest, addBytes: number, notebookIds: string[] = []): Promise<(() => Promise<void>) | undefined> {
  if (!process.env.LINGBI_COMMERCE_MODE) return;
  const session = await resolveAccountSessionFromRequest(request);
  if (!session) return;
  const ownerMemberId = session.member.id;
  const [sources, notebooks] = await Promise.all([listIngestionSources({ ownerMemberId }), listNotebooks(ownerMemberId)]);
  const existing = new Set(notebooks.map(item => item.id));
  const addNotebooks = [...new Set(notebookIds)].filter(id => !existing.has(id)).length;
  const accountId = request.headers.get('X-Lingbi-Payer') || `personal:${session.tenant_id}:${ownerMemberId}`;
  const body = { tenantId: session.tenant_id, memberId: ownerMemberId, accountId, action: 'reserve', usedBytes: sources.filter(item => item.ownerMemberId === ownerMemberId).reduce((sum, item) => sum + (item.fileSize || 0), 0), usedNotebooks: existing.size, addBytes, addNotebooks };
  const result = await commerceAccount<{ leaseId: string }>('internal/capacity', { internal: true, body });
  return async () => { await commerceAccount('internal/capacity', { internal: true, body: { tenantId: session.tenant_id, memberId: ownerMemberId, accountId, action: 'release', leaseId: result.leaseId } }); };
}
