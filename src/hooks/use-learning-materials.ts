'use client';

import { usePrivateNotebookDocument } from '@/hooks/use-private-notebook-document';
import { emptyLearningMaterials, isLearningMaterials, type LearningMaterials } from '@/lib/learning-materials';
import { studioSessionStorageKey } from '@/lib/studio-session-storage';

function sessionMaterials(scopeKey: string): LearningMaterials | null {
  try {
    const read = (field: string) => JSON.parse(window.sessionStorage.getItem(studioSessionStorageKey(scopeKey, 'learning-artifacts', field)) || 'null');
    const snapshot: unknown = read('snapshot');
    if (isLearningMaterials(snapshot) && snapshot.cards.length) return snapshot;
    const legacy: unknown = {
      cards: read('cards') || [], citations: read('citations') || [], retrieval: read('retrieval'), citationAudit: read('citation-audit'),
      cardIndex: read('card-index') || 0, quizIndex: read('quiz-index') || 0, answers: read('quiz-answers') || {},
    };
    return isLearningMaterials(legacy) && legacy.cards.length ? legacy : null;
  } catch { return null; }
}


export function useLearningMaterials(scopeKey: string, options: { openSavedRequest?: { revision: string }; busy?: boolean } = {}) {
  return usePrivateNotebookDocument({ scopeKey, toolId: 'learning-artifacts', endpoint: '/api/ai/knowledge-cards',
    empty: emptyLearningMaterials, validate: isLearningMaterials, readLegacy: sessionMaterials, ...options });
}
