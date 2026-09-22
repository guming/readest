export type LearningGuideEvent =
  | 'learning_guide_requested'
  | 'learning_guide_unsupported_fiction'
  | 'learning_guide_classification_uncertain'
  | 'learning_guide_generated'
  | 'learning_guide_failed'
  | 'learning_guide_cancelled'
  | 'learning_guide_opened'
  | 'learning_guide_continue_reading'
  | 'learning_guide_regenerated'
  | 'learning_guide_deleted';

const STORAGE_KEY = 'readest-learning-guide-events-v1';
const MAX_EVENTS = 200;

export function recordLearningGuideEvent(event: LearningGuideEvent, bookId?: string): void {
  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as unknown[];
    const next = [...(Array.isArray(current) ? current : []), { event, bookId, at: Date.now() }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-MAX_EVENTS)));
  } catch {
    // Analytics must never block reading.
  }
}
