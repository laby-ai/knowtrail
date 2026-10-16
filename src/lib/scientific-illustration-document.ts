import type { ScientificIllustrationKind, ScientificIllustrationAspectRatio } from '@/lib/scientific-illustration-contract';
import { studioSessionStorageKey } from '@/lib/studio-session-storage';

export interface IllustrationResult {
  id: string; imageUrl: string; downloadUrl: string; mimeType: string; width: number | null; height: number | null; bytes: number;
  purpose: string; figureKind: ScientificIllustrationKind; aspectRatio: ScientificIllustrationAspectRatio; sourceLabels: string[]; createdAt: string; reviewRequired: boolean; boundary: string;
}
export interface IllustrationDocument { runId: string | null; form: { purpose: string; figureKind: ScientificIllustrationKind; aspectRatio: ScientificIllustrationAspectRatio; requiredLabels: string }; result: IllustrationResult | null }
export const emptyIllustration = (): IllustrationDocument => ({ runId: null, form: { purpose: '', figureKind: 'workflow', aspectRatio: '16:9', requiredLabels: '' }, result: null });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function localImageUrl(value: string, id: string) {
  try { const url = new URL(value, 'https://local.invalid'); return url.origin === 'https://local.invalid' && ['/api/ai/scientific-illustration/' + id, '/knowtrail/api/ai/scientific-illustration/' + id].includes(url.pathname); } catch { return false; }
}
export function isIllustrationDocument(value: unknown): value is IllustrationDocument {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<IllustrationDocument>; const f = d.form;
  if (!f || typeof f.purpose !== 'string' || f.purpose.length > 1200 || typeof f.requiredLabels !== 'string' || f.requiredLabels.length > 1200
    || !['workflow', 'conceptual-framework', 'method-diagram', 'mechanism-schematic'].includes(f.figureKind) || !['1:1', '4:3', '16:9'].includes(f.aspectRatio) || d.runId !== null && (typeof d.runId !== 'string' || !uuid.test(d.runId))) return false;
  if (d.result === null) return true;
  const r = d.result;
  return Boolean(r && uuid.test(r.id) && typeof r.imageUrl === 'string' && localImageUrl(r.imageUrl, r.id) && typeof r.downloadUrl === 'string' && localImageUrl(r.downloadUrl, r.id)
    && ['image/png', 'image/jpeg', 'image/webp'].includes(r.mimeType) && Number.isFinite(r.bytes) && r.bytes > 0 && typeof r.purpose === 'string' && typeof r.createdAt === 'string'
    && Array.isArray(r.sourceLabels) && r.sourceLabels.every(x => typeof x === 'string') && typeof r.boundary === 'string' && r.reviewRequired === true);
}
export function legacyIllustration(scopeKey: string): IllustrationDocument | null {
  const doc = emptyIllustration(); let found = false;
  for (const [key, field] of Object.entries({ purpose: 'purpose', figureKind: 'figure-kind', aspectRatio: 'aspect-ratio', requiredLabels: 'required-labels' })) {
    try { const value: unknown = JSON.parse(window.sessionStorage.getItem(studioSessionStorageKey(scopeKey, 'scientific-illustration', field)) || 'null'); if (typeof value === 'string') { Object.assign(doc.form, { [key]: value }); found = true; } } catch { /* Keep only valid identity-scoped form fields. */ }
  }
  return found && isIllustrationDocument(doc) ? doc : null;
}
