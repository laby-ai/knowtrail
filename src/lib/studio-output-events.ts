export const STUDIO_OUTPUT_SAVED = 'knowtrail:studio-output-saved';

export function announceStudioOutputSaved(scopeKey: string, toolId: string) {
  if (toolId === 'chat-history') return;
  window.dispatchEvent(new CustomEvent(STUDIO_OUTPUT_SAVED, { detail: { scopeKey, toolId } }));
}
