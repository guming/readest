import type { BookConfig, NotebookCard } from '@/types/book';
import type { BookLearningGuide } from './types';
import { LEARNING_GUIDE_PROMPT_VERSION } from './learningGuideContext';

export const isLearningGuide = (value: unknown): value is BookLearningGuide => {
  if (!value || typeof value !== 'object') return false;
  const guide = value as BookLearningGuide;
  return (
    guide.schemaVersion === 1 &&
    typeof guide.learningGoal === 'string' &&
    guide.learningGoal.trim().length > 0 &&
    Array.isArray(guide.understandingPath) &&
    guide.understandingPath.length >= 3 &&
    guide.understandingPath.every((item) => item.label?.trim()) &&
    Array.isArray(guide.attentionPoints) &&
    guide.attentionPoints.length >= 4 &&
    guide.attentionPoints.every((item) => item.title?.trim() && item.explanation?.trim()) &&
    Array.isArray(guide.masteryQuestions) &&
    guide.masteryQuestions.length >= 3 &&
    guide.masteryQuestions.every((item) => item.trim())
  );
};

export function getLearningGuideCard(config: BookConfig | null): NotebookCard | null {
  return (
    config?.notebookCards
      ?.filter((card) => card.type === 'learning_guide' && !card.deletedAt)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  );
}

export function upsertLearningGuideCard(
  config: BookConfig,
  guide: BookLearningGuide,
  provider: string,
  model: string,
  tokenEstimate: { input: number; output: number },
  id: string,
): BookConfig {
  const now = Date.now();
  const existing = getLearningGuideCard(config);
  const nextCard: NotebookCard = {
    id: existing?.id ?? id,
    bookId: guide.bookKey.split('-')[0]!,
    type: 'learning_guide',
    title: 'Learning Guide',
    content: guide,
    contextType: 'book',
    provider,
    model,
    tokenEstimate,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  let replaced = false;
  const cards = (config.notebookCards ?? []).map((card) => {
    if (existing && card.id === existing.id) {
      replaced = true;
      return nextCard;
    }
    return card.type === 'learning_guide' && !card.deletedAt
      ? { ...card, deletedAt: now, updatedAt: now }
      : card;
  });
  return {
    ...config,
    notebookCards: replaced ? cards : [...cards, nextCard],
    updatedAt: now,
  };
}

export function deleteLearningGuideCard(config: BookConfig): BookConfig {
  const now = Date.now();
  return {
    ...config,
    notebookCards: (config.notebookCards ?? []).map((card) =>
      card.type === 'learning_guide' && !card.deletedAt
        ? { ...card, deletedAt: now, updatedAt: now }
        : card,
    ),
    updatedAt: now,
  };
}

export function isLearningGuideStale(
  guide: BookLearningGuide,
  sourceFingerprint?: string,
  hasGroundedSources = false,
): boolean {
  return (
    guide.provenance.promptVersion !== LEARNING_GUIDE_PROMPT_VERSION ||
    (!!sourceFingerprint && guide.provenance.sourceFingerprint !== sourceFingerprint) ||
    (guide.status === 'preliminary' && hasGroundedSources)
  );
}

export function learningGuideToMarkdown(guide: BookLearningGuide): string {
  const sections = [
    `# ${guide.status === 'preliminary' ? 'Learning guide (preliminary)' : 'Learning guide'}`,
    `## Learning goal\n${guide.learningGoal}`,
    `## Understanding path\n${guide.understandingPath.map((item) => item.label).join(' → ')}`,
    `## What to pay attention to\n${guide.attentionPoints
      .map((item, index) => `${index + 1}. **${item.title}**\n   ${item.explanation}`)
      .join('\n')}`,
  ];
  if (guide.prerequisites?.length) {
    sections.push(
      `## Useful prerequisites\n${guide.prerequisites
        .map((item) => `- **${item.concept}**: ${item.whyNeeded}`)
        .join('\n')}`,
    );
  }
  if (guide.evidenceAndCaveats?.length) {
    sections.push(
      `## Evidence and caveats\n${guide.evidenceAndCaveats
        .map((item) => `- **${item.claim}**: ${item.caveat}`)
        .join('\n')}`,
    );
  }
  sections.push(
    `## Check your understanding\n${guide.masteryQuestions.map((item) => `- ${item}`).join('\n')}`,
  );
  return sections.join('\n\n');
}
