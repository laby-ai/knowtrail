import { learningCardExtra } from './learning-materials';
import type { KnowledgeCardData } from './knowledge-card-types';

export interface QuizQuestion { id: string; prompt: string; options: string[]; correctIndex: number; explanation: string }
function conciseOption(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  const sentence = text.split(/[。！？.!?]/)[0] || text;
  return sentence.length > 72 ? `${sentence.slice(0, 69)}…` : sentence;
}
export function buildQuiz(cards: KnowledgeCardData[]): QuizQuestion[] {
  return cards.slice(0, 5).map((card, index) => {
    const correct = conciseOption(card.content);
    const distractors = cards.filter((_, cardIndex) => cardIndex !== index).map(item => conciseOption(item.content))
      .filter((option, optionIndex, all) => option && option !== correct && all.indexOf(option) === optionIndex).slice(0, 3);
    const baseOptions = [correct, ...distractors];
    const shift = baseOptions.length ? index % baseOptions.length : 0;
    const options = [...baseOptions.slice(shift), ...baseOptions.slice(0, shift)];
    return { id: `${index}-${card.title}`, prompt: /[？?]$/.test(card.title) ? card.title : `关于“${card.title}”，哪项描述正确？`, options, correctIndex: options.indexOf(correct), explanation: learningCardExtra(card.extra) || card.content };
  });
}
