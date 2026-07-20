import type { OneQuestionType } from './types';

const EVENTS_KEY = 'readest-one-question-events-v1';
const MAX_EVENTS = 200;

export type OneQuestionEventName =
  | 'one_question_requested'
  | 'one_question_generated'
  | 'one_question_abstained'
  | 'one_question_answered'
  | 'one_question_skipped'
  | 'one_question_asked_another'
  | 'one_question_continued_reading'
  | 'one_question_quality_feedback'
  | 'one_question_failed';

export type OneQuestionQualityFeedback =
  | 'insightful'
  | 'too_easy'
  | 'too_trivial'
  | 'not_supported';

export type OneQuestionSelfAssessment = 'got_it' | 'partly' | 'missed';

export interface OneQuestionEvent {
  id: string;
  at: number;
  event: OneQuestionEventName;
  provider: string;
  model: string;
  interactionId?: string;
  bookId?: string;
  questionType?: OneQuestionType;
  durationMs?: number;
  selfAssessment?: OneQuestionSelfAssessment;
  qualityFeedback?: OneQuestionQualityFeedback;
  errorCode?: string;
}

const safeLocalStorage = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export const getOneQuestionEvents = (): OneQuestionEvent[] => {
  const storage = safeLocalStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(EVENTS_KEY) || '[]');
    return Array.isArray(parsed) ? (parsed as OneQuestionEvent[]) : [];
  } catch {
    return [];
  }
};

export const recordOneQuestionEvent = (
  event: Omit<OneQuestionEvent, 'id' | 'at'>,
  time = Date.now(),
): void => {
  const storage = safeLocalStorage();
  if (!storage) return;
  const next: OneQuestionEvent = {
    id: `${time}-${Math.random().toString(36).slice(2, 10)}`,
    at: time,
    ...event,
    durationMs:
      event.durationMs === undefined ? undefined : Math.max(0, Math.round(event.durationMs)),
  };
  try {
    storage.setItem(
      EVENTS_KEY,
      JSON.stringify([...getOneQuestionEvents(), next].slice(-MAX_EVENTS)),
    );
  } catch {
    // Private mode and quota failures must not block reading.
  }
};

export const clearOneQuestionEvents = (): void => {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(EVENTS_KEY);
  } catch {
    // Ignore storage failures.
  }
};

export const recordOneQuestionQualityFeedback = (
  event: Omit<OneQuestionEvent, 'id' | 'at' | 'event'> & {
    interactionId: string;
    qualityFeedback: OneQuestionQualityFeedback;
  },
  time = Date.now(),
): void => {
  const storage = safeLocalStorage();
  if (!storage) return;
  const prior = getOneQuestionEvents().filter(
    (item) =>
      item.event !== 'one_question_quality_feedback' || item.interactionId !== event.interactionId,
  );
  const next: OneQuestionEvent = {
    id: `${time}-${Math.random().toString(36).slice(2, 10)}`,
    at: time,
    event: 'one_question_quality_feedback',
    ...event,
  };
  try {
    storage.setItem(EVENTS_KEY, JSON.stringify([...prior, next].slice(-MAX_EVENTS)));
  } catch {
    // Private mode and quota failures must not block reading.
  }
};
