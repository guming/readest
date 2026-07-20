import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  clearOneQuestionEvents,
  getOneQuestionEvents,
  recordOneQuestionEvent,
  recordOneQuestionQualityFeedback,
} from '@/services/notebook-assistant/oneQuestionEvents';

describe('one-question events', () => {
  beforeEach(() => {
    clearOneQuestionEvents();
    vi.restoreAllMocks();
  });

  test('stores interaction metadata without content', () => {
    recordOneQuestionEvent({
      event: 'one_question_answered',
      provider: 'openai',
      model: 'gpt-4o-mini',
      bookId: 'book-1',
      questionType: 'open',
      durationMs: 1200,
    });
    const raw = localStorage.getItem('readest-one-question-events-v1') || '';
    expect(raw).toContain('one_question_answered');
    expect(raw).not.toContain('sourceText');
    expect(raw).not.toContain('userAnswer');
    expect(raw).not.toContain('referenceAnswer');
    expect(getOneQuestionEvents()).toHaveLength(1);
  });

  test('keeps only the newest 200 events', () => {
    for (let index = 0; index < 205; index += 1) {
      recordOneQuestionEvent(
        {
          event: 'one_question_requested',
          provider: 'openai',
          model: 'gpt-4o-mini',
        },
        index,
      );
    }
    const events = getOneQuestionEvents();
    expect(events).toHaveLength(200);
    expect(events[0]?.at).toBe(5);
    expect(events.at(-1)?.at).toBe(204);
  });

  test('updates quality feedback once per interaction', () => {
    const base = {
      interactionId: 'interaction-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
    };
    recordOneQuestionQualityFeedback({ ...base, qualityFeedback: 'too_easy' }, 1);
    recordOneQuestionQualityFeedback({ ...base, qualityFeedback: 'insightful' }, 2);
    expect(getOneQuestionEvents()).toMatchObject([
      {
        event: 'one_question_quality_feedback',
        interactionId: 'interaction-1',
        qualityFeedback: 'insightful',
      },
    ]);
  });

  test('does not block when storage writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() =>
      recordOneQuestionEvent({
        event: 'one_question_failed',
        provider: 'openai',
        model: 'gpt-4o-mini',
        errorCode: 'network',
      }),
    ).not.toThrow();
  });
});
