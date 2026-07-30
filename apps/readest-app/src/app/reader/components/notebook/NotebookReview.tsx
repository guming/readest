import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PiCheck, PiFloppyDisk, PiSpinner, PiStudent, PiX } from 'react-icons/pi';

import NotebookAssistantPanel from '@/components/settings/NotebookAssistantPanel';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import {
  buildCurrentChapterContext,
  type NotebookAssistantContext,
} from '@/services/notebook-assistant/context';
import {
  NotebookAssistantError,
  estimateOneQuestionTokens,
  estimateQuizTokens,
  runChapterQuizAssistant,
  runOneQuestionAssistant,
} from '@/services/notebook-assistant/client';
import {
  type OneQuestionQualityFeedback,
  type OneQuestionSelfAssessment,
  recordOneQuestionEvent,
  recordOneQuestionQualityFeedback,
} from '@/services/notebook-assistant/oneQuestionEvents';
import {
  evaluateUsageLimit,
  recordNotebookAssistantUsage,
} from '@/services/notebook-assistant/usage';
import {
  resolveNotebookAssistantSettings,
  type OneQuestion,
  type QuizCardContent,
  type QuizQuestion,
} from '@/services/notebook-assistant/types';
import {
  getNotebookAssistantIdentity,
  isNotebookAssistantConfigured,
} from '@/services/notebook-assistant/provider';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { NotebookCard } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';

interface Props {
  bookKey: string;
}

type ReviewMode = 'one_question' | 'chapter_quiz';

const normalizeAnswer = (value: string): string => value.trim().toLowerCase();

const gradeAnswer = (question: QuizQuestion, answer: string): boolean => {
  if (!answer.trim()) return false;
  return normalizeAnswer(answer) === normalizeAnswer(question.answer);
};

const NotebookReview: React.FC<Props> = ({ bookKey }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const { getBookData, getConfig, setConfig, saveConfig } = useBookDataStore();
  const { getView, getProgress } = useReaderStore();
  const assistant = resolveNotebookAssistantSettings(settings.notebookAssistant);
  const assistantIdentity = getNotebookAssistantIdentity(assistant, settings.aiSettings);
  const quizQuestionCount = assistant.defaultQuizQuestionCount;
  const targetLanguage = assistant.targetLanguage || navigator.language || 'English';
  const [mode, setMode] = useState<ReviewMode>('one_question');
  const [context, setContext] = useState<NotebookAssistantContext | null>(null);
  const [oneQuestion, setOneQuestion] = useState<OneQuestion | null>(null);
  const [oneAnswer, setOneAnswer] = useState('');
  const [oneSubmitted, setOneSubmitted] = useState(false);
  const [oneAbstained, setOneAbstained] = useState(false);
  const [selfAssessment, setSelfAssessment] = useState<OneQuestionSelfAssessment | null>(null);
  const [qualityFeedback, setQualityFeedback] = useState<OneQuestionQualityFeedback | null>(null);
  const [quiz, setQuiz] = useState<QuizCardContent | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [savedMissedQuestionIds, setSavedMissedQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const oneQuestionController = useRef<AbortController | null>(null);
  const oneQuestionStartedAt = useRef(0);
  const oneAnswerStartedAt = useRef(0);
  const oneQuestionInteractionId = useRef('');

  useEffect(() => {
    return () => oneQuestionController.current?.abort();
  }, []);

  const configured = isNotebookAssistantConfigured(assistant, settings.aiSettings, '');
  const estimate = useMemo(
    () => estimateQuizTokens(context?.sourceText || '', quizQuestionCount),
    [context?.sourceText, quizQuestionCount],
  );
  const gradedQuestions = useMemo(() => {
    if (!quiz) return [];
    return quiz.questions.map((question) => {
      const userAnswer = answers[question.id] || '';
      return {
        ...question,
        userAnswer,
        isCorrect: submitted ? gradeAnswer(question, userAnswer) : undefined,
      };
    });
  }, [answers, quiz, submitted]);
  const score = gradedQuestions.filter((question) => question.isCorrect).length;
  const allAnswered = !!quiz?.questions.every((question) => answers[question.id]?.trim());

  const loadContext = async (): Promise<NotebookAssistantContext | null> => {
    const bookDoc = getBookData(bookKey)?.bookDoc;
    if (!bookDoc) return null;
    return buildCurrentChapterContext(bookDoc, getView(bookKey), getProgress(bookKey));
  };

  const trackOneQuestion = (
    event: Parameters<typeof recordOneQuestionEvent>[0]['event'],
    details: Partial<Parameters<typeof recordOneQuestionEvent>[0]> = {},
  ) => {
    if (!assistant.usageTrackingEnabled) return;
    recordOneQuestionEvent({
      event,
      provider: assistantIdentity.provider,
      model: assistantIdentity.model,
      bookId: bookKey.split('-')[0],
      ...details,
    });
  };

  const resetOneQuestion = () => {
    setOneQuestion(null);
    setOneAnswer('');
    setOneSubmitted(false);
    setOneAbstained(false);
    setSelfAssessment(null);
    setQualityFeedback(null);
  };

  const generateOneQuestion = async (askedAnother = false) => {
    if (!configured) return;
    oneQuestionController.current?.abort();
    const controller = new AbortController();
    oneQuestionController.current = controller;
    setMode('one_question');
    resetOneQuestion();
    setLoading(true);
    setError('');
    oneQuestionStartedAt.current = Date.now();
    if (askedAnother) trackOneQuestion('one_question_asked_another');
    trackOneQuestion('one_question_requested');
    let usageContext: NotebookAssistantContext | null = null;
    let usageEstimate = estimateOneQuestionTokens('');
    try {
      const nextContext = await loadContext();
      if (!nextContext?.sourceText) {
        throw new Error(_('No readable text found for the current chapter.'));
      }
      const nextEstimate = estimateOneQuestionTokens(
        nextContext.sourceText,
        nextContext.sourceBlocks,
      );
      usageContext = nextContext;
      usageEstimate = nextEstimate;
      if (nextEstimate.input > assistant.warnAboveTokens) {
        const accepted = window.confirm(
          _('This chapter is long and may cost more than usual. Continue?'),
        );
        if (!accepted) return;
      }
      const limit = evaluateUsageLimit(assistant, nextEstimate);
      if (!limit.allowed) {
        throw new Error(
          _(
            'Daily token limit reached. Adjust the limit or cost mode in Notebook Assistant settings.',
          ),
        );
      }
      if (limit.needsConfirmation) {
        const accepted = window.confirm(
          _(
            'This request may exceed your daily token limit. Estimated total: {{total}} / {{limit}} tokens. Continue?',
            { total: limit.projectedTotal, limit: limit.limit },
          ),
        );
        if (!accepted) return;
      }
      setContext(nextContext);
      const result = await runOneQuestionAssistant(
        {
          sourceText: nextContext.sourceText,
          sourceBlocks: nextContext.sourceBlocks,
          title: nextContext.title,
          targetLanguage,
          provider: assistantIdentity.provider,
          model: assistantIdentity.model,
        },
        assistant,
        '',
        controller.signal,
        settings.aiSettings,
      );
      const durationMs = Date.now() - oneQuestionStartedAt.current;
      if (result.question) {
        setOneQuestion(result.question);
        oneQuestionInteractionId.current = `${Date.now()}-${result.question.id}`;
        oneAnswerStartedAt.current = Date.now();
        trackOneQuestion('one_question_generated', {
          questionType: result.question.type,
          durationMs,
        });
      } else {
        setOneAbstained(true);
        trackOneQuestion('one_question_abstained', { durationMs });
      }
      if (assistant.usageTrackingEnabled) {
        recordNotebookAssistantUsage({
          action: 'one_question',
          contextType: 'chapter',
          provider: assistantIdentity.provider,
          model: assistantIdentity.model,
          tokenEstimate: nextEstimate,
          success: true,
          bookId: bookKey.split('-')[0],
        });
      }
    } catch (oneQuestionError) {
      if ((oneQuestionError as Error).name === 'AbortError') return;
      setError((oneQuestionError as Error).message);
      const errorCode =
        oneQuestionError instanceof NotebookAssistantError ? oneQuestionError.code : 'unknown';
      trackOneQuestion('one_question_failed', {
        durationMs: Date.now() - oneQuestionStartedAt.current,
        errorCode,
      });
      if (assistant.usageTrackingEnabled && usageContext) {
        recordNotebookAssistantUsage({
          action: 'one_question',
          contextType: 'chapter',
          provider: assistantIdentity.provider,
          model: assistantIdentity.model,
          tokenEstimate: usageEstimate,
          success: false,
          errorCode,
          bookId: bookKey.split('-')[0],
        });
      }
    } finally {
      if (oneQuestionController.current === controller) {
        oneQuestionController.current = null;
        setLoading(false);
      }
    }
  };

  const submitOneQuestion = (answer = oneAnswer) => {
    if (!oneQuestion || oneSubmitted) return;
    setOneAnswer(answer);
    setOneSubmitted(true);
    if (oneQuestion.type === 'multiple_choice') {
      trackOneQuestion('one_question_answered', {
        questionType: oneQuestion.type,
        durationMs: Date.now() - oneAnswerStartedAt.current,
      });
    }
  };

  const chooseSelfAssessment = (assessment: OneQuestionSelfAssessment) => {
    const isFirstAssessment = selfAssessment === null;
    setSelfAssessment(assessment);
    if (!isFirstAssessment || !oneQuestion) return;
    trackOneQuestion('one_question_answered', {
      questionType: oneQuestion.type,
      durationMs: Date.now() - oneAnswerStartedAt.current,
      selfAssessment: assessment,
    });
  };

  const skipOneQuestion = () => {
    trackOneQuestion('one_question_skipped', { questionType: oneQuestion?.type });
    resetOneQuestion();
  };

  const continueReading = () => {
    trackOneQuestion('one_question_continued_reading', { questionType: oneQuestion?.type });
    resetOneQuestion();
  };

  const chooseQualityFeedback = (feedback: OneQuestionQualityFeedback) => {
    setQualityFeedback(feedback);
    if (!assistant.usageTrackingEnabled || !oneQuestionInteractionId.current) return;
    recordOneQuestionQualityFeedback({
      interactionId: oneQuestionInteractionId.current,
      provider: assistantIdentity.provider,
      model: assistantIdentity.model,
      bookId: bookKey.split('-')[0],
      questionType: oneQuestion?.type,
      qualityFeedback: feedback,
    });
  };

  const viewOneQuestionSource = () => {
    const cfi = oneQuestion?.sourceAnchor?.cfi;
    if (!cfi) return;
    trackOneQuestion('one_question_source_opened', { questionType: oneQuestion.type });
    eventDispatcher.dispatch('navigate', { bookKey, cfi });
    getView(bookKey)?.goTo(cfi);
  };

  const generateQuiz = async () => {
    if (!configured) return;
    setLoading(true);
    setError('');
    setQuiz(null);
    setAnswers({});
    setSubmitted(false);
    setShowAnswers(false);
    setSaved(false);
    setSavedMissedQuestionIds(new Set());
    let usageContext: NotebookAssistantContext | null = null;
    let usageEstimate = estimate;
    try {
      const nextContext = await loadContext();
      if (!nextContext?.sourceText) {
        throw new Error(_('No readable text found for the current chapter.'));
      }
      const nextEstimate = estimateQuizTokens(nextContext.sourceText, quizQuestionCount);
      usageContext = nextContext;
      usageEstimate = nextEstimate;
      if (nextEstimate.input > assistant.warnAboveTokens) {
        const accepted = window.confirm(
          _('This chapter is long and may cost more than usual. Continue?'),
        );
        if (!accepted) return;
      }
      const limit = evaluateUsageLimit(assistant, nextEstimate);
      if (!limit.allowed) {
        throw new Error(
          _(
            'Daily token limit reached. Adjust the limit or cost mode in Notebook Assistant settings.',
          ),
        );
      }
      if (limit.needsConfirmation) {
        const accepted = window.confirm(
          _(
            'This request may exceed your daily token limit. Estimated total: {{total}} / {{limit}} tokens. Continue?',
            { total: limit.projectedTotal, limit: limit.limit },
          ),
        );
        if (!accepted) return;
      }
      setContext(nextContext);
      const nextQuiz = await runChapterQuizAssistant(
        {
          sourceText: nextContext.sourceText,
          title: nextContext.title,
          targetLanguage,
          provider: assistantIdentity.provider,
          model: assistantIdentity.model,
          questionCount: quizQuestionCount,
        },
        assistant,
        '',
        undefined,
        settings.aiSettings,
      );
      setQuiz(nextQuiz);
      if (assistant.usageTrackingEnabled) {
        recordNotebookAssistantUsage({
          action: 'quiz',
          contextType: 'chapter',
          provider: assistantIdentity.provider,
          model: assistantIdentity.model,
          tokenEstimate: nextEstimate,
          success: true,
          bookId: bookKey.split('-')[0],
        });
      }
    } catch (quizError) {
      setError((quizError as Error).message);
      if (assistant.usageTrackingEnabled && usageContext) {
        recordNotebookAssistantUsage({
          action: 'quiz',
          contextType: 'chapter',
          provider: assistantIdentity.provider,
          model: assistantIdentity.model,
          tokenEstimate: usageEstimate,
          success: false,
          errorCode: quizError instanceof NotebookAssistantError ? quizError.code : 'unknown',
          bookId: bookKey.split('-')[0],
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const saveQuiz = async () => {
    if (!quiz || !context || !submitted || saved) return;
    const config = getConfig(bookKey);
    if (!config) return;
    const now = Date.now();
    const questions = gradedQuestions.map((question) => ({
      ...question,
      isCorrect: gradeAnswer(question, question.userAnswer || ''),
    }));
    const card: NotebookCard = {
      id: uniqueId(),
      bookId: bookKey.split('-')[0]!,
      chapterId: context.chapterId,
      chapterTitle: context.chapterTitle,
      pageNumber: context.pageNumber,
      pageCfi: context.pageCfi,
      type: 'quiz',
      title: `${_('Chapter Quiz')} · ${context.title}`,
      sourceText: context.title,
      content: {
        questions,
        score: questions.filter((question) => question.isCorrect).length,
      },
      contextType: 'chapter',
      targetLanguage,
      provider: assistantIdentity.provider,
      model: assistantIdentity.model,
      tokenEstimate: estimateQuizTokens(context.sourceText, quizQuestionCount),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const next = {
      ...config,
      notebookCards: [...(config.notebookCards ?? []), card],
      updatedAt: now,
    };
    setConfig(bookKey, next);
    await saveConfig(envConfig, bookKey, next, settings);
    setSaved(true);
  };

  const saveMissedQuestion = async (question: QuizQuestion) => {
    if (!context || !submitted || question.isCorrect !== false) return;
    if (savedMissedQuestionIds.has(question.id)) return;
    const config = getConfig(bookKey);
    if (!config) return;
    const now = Date.now();
    const card: NotebookCard = {
      id: uniqueId(),
      bookId: bookKey.split('-')[0]!,
      chapterId: context.chapterId,
      chapterTitle: context.chapterTitle,
      pageNumber: context.pageNumber,
      pageCfi: context.pageCfi,
      type: 'mistake',
      title: `${_('Missed Question')} · ${context.title}`,
      sourceText: question.question,
      content: {
        questions: [question],
        score: 0,
      },
      contextType: 'chapter',
      targetLanguage,
      provider: assistantIdentity.provider,
      model: assistantIdentity.model,
      tokenEstimate: estimateQuizTokens(context.sourceText, quizQuestionCount),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const next = {
      ...config,
      notebookCards: [...(config.notebookCards ?? []), card],
      updatedAt: now,
    };
    setConfig(bookKey, next);
    await saveConfig(envConfig, bookKey, next, settings);
    setSavedMissedQuestionIds((current) => new Set(current).add(question.id));
  };

  if (!configured) {
    return (
      <div className='border-base-300 border-b p-3'>
        <NotebookAssistantPanel compact />
      </div>
    );
  }

  return (
    <section className='flex min-h-0 flex-1 flex-col'>
      <div className='border-base-300 border-b p-3'>
        <div className='mb-2 flex items-center gap-2'>
          <PiStudent className='shrink-0' />
          <h2 className='text-sm font-semibold'>
            {mode === 'one_question' ? _('Ask Me One') : _('Chapter Quiz')}
          </h2>
        </div>
        <p className='text-base-content/60 mb-2 text-xs'>
          {mode === 'chapter_quiz' && context
            ? `${context.title} · ~${estimate.input} ${_('input tokens')} ${_('max')} ~${estimate.output} ${_('output tokens')}`
            : `${assistantIdentity.provider} · ${assistantIdentity.model}`}
        </p>
        {error && <p className='mb-2 text-xs text-red-500'>{error}</p>}
        <div className='flex flex-wrap justify-end gap-1'>
          {mode === 'one_question' ? (
            <>
              <button
                type='button'
                className='btn btn-ghost btn-xs eink-bordered'
                onClick={() => {
                  oneQuestionController.current?.abort();
                  resetOneQuestion();
                  setError('');
                  setMode('chapter_quiz');
                }}
                disabled={loading}
              >
                {_('Chapter Quiz')}
              </button>
              {loading ? (
                <button
                  type='button'
                  className='btn btn-ghost btn-xs eink-bordered'
                  onClick={() => {
                    oneQuestionController.current?.abort();
                    setLoading(false);
                  }}
                >
                  <PiX /> {_('Cancel')}
                </button>
              ) : (
                !oneQuestion &&
                !oneAbstained && (
                  <button
                    type='button'
                    className='btn btn-primary btn-xs'
                    onClick={() => void generateOneQuestion()}
                  >
                    <PiStudent /> {_('Ask Me One')}
                  </button>
                )
              )}
            </>
          ) : (
            <button
              type='button'
              className='btn btn-ghost btn-xs eink-bordered'
              onClick={() => {
                setMode('one_question');
                setError('');
              }}
              disabled={loading}
            >
              {_('Ask Me One')}
            </button>
          )}
          {mode === 'chapter_quiz' && quiz && submitted && (
            <button
              type='button'
              className='btn btn-ghost btn-xs eink-bordered'
              onClick={() => setShowAnswers((current) => !current)}
            >
              {showAnswers ? _('Hide Answers') : _('Show Answers')}
            </button>
          )}
          {mode === 'chapter_quiz' && quiz && submitted && (
            <button
              type='button'
              className='btn btn-ghost btn-xs eink-bordered'
              onClick={saveQuiz}
              disabled={saved}
            >
              {saved ? <PiCheck /> : <PiFloppyDisk />} {saved ? _('Saved') : _('Save')}
            </button>
          )}
          {mode === 'chapter_quiz' && (
            <button
              type='button'
              className='btn btn-primary btn-xs'
              onClick={generateQuiz}
              disabled={loading}
            >
              {loading ? <PiSpinner className='animate-spin' /> : <PiStudent />}
              {quiz ? _('Regenerate') : _('Generate Quiz')}
            </button>
          )}
        </div>
      </div>

      {mode === 'one_question' && loading && (
        <div className='flex min-h-24 items-center justify-center gap-2 p-4 text-sm'>
          <PiSpinner className='animate-spin' /> {_('Creating a question from this chapter…')}
        </div>
      )}

      {mode === 'one_question' && oneAbstained && !loading && (
        <div className='p-3'>
          <div className='eink-bordered border-base-300 bg-base-100 rounded-md border p-3'>
            <p className='text-sm'>
              {_('No useful question could be generated from this chapter.')}
            </p>
            <div className='mt-3 flex justify-end gap-2'>
              <button
                type='button'
                className='btn btn-ghost btn-sm eink-bordered'
                onClick={continueReading}
              >
                {_('Continue Reading')}
              </button>
              <button
                type='button'
                className='btn btn-primary btn-sm'
                onClick={() => void generateOneQuestion()}
              >
                {_('Try Again')}
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'one_question' && oneQuestion && !loading && (
        <div className='min-h-0 flex-1 overflow-y-auto p-3'>
          <article className='eink-bordered border-base-300 bg-base-100 rounded-md border p-3'>
            <p className='text-base-content/60 mb-2 text-xs'>
              {_('Current Chapter')} · {_('About 1 minute')}
            </p>
            <h3 className='mb-3 text-sm font-semibold'>{oneQuestion.question}</h3>

            {oneQuestion.type === 'multiple_choice' ? (
              <fieldset className='space-y-2' disabled={oneSubmitted}>
                <legend className='sr-only'>{oneQuestion.question}</legend>
                {oneQuestion.choices?.map((choice) => (
                  <label
                    key={choice.id}
                    className='eink-bordered border-base-300 flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm'
                  >
                    <input
                      type='radio'
                      className='radio radio-xs mt-0.5'
                      name={`one-question-${oneQuestion.id}`}
                      value={choice.id}
                      checked={oneAnswer === choice.id}
                      onChange={() => setOneAnswer(choice.id)}
                    />
                    <span>{choice.text}</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <textarea
                className='textarea textarea-bordered eink-bordered min-h-24 w-full bg-base-100 text-sm'
                value={oneAnswer}
                disabled={oneSubmitted}
                onChange={(event) => setOneAnswer(event.target.value)}
                placeholder={_('Your answer')}
                aria-label={_('Your answer')}
              />
            )}

            {!oneSubmitted ? (
              <div className='mt-3 flex flex-wrap justify-end gap-2'>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm eink-bordered'
                  onClick={skipOneQuestion}
                >
                  {_('Skip')}
                </button>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm eink-bordered'
                  onClick={() => submitOneQuestion('')}
                >
                  {_("I Don't Know")}
                </button>
                <button
                  type='button'
                  className='btn btn-primary btn-sm'
                  disabled={!oneAnswer.trim()}
                  onClick={() => submitOneQuestion()}
                >
                  {_('Submit')}
                </button>
              </div>
            ) : (
              <div className='border-base-300 mt-4 border-t pt-3 text-sm'>
                {oneQuestion.type === 'multiple_choice' && (
                  <p className='mb-2 font-semibold'>
                    {oneAnswer === oneQuestion.correctChoiceId ? _('Correct') : _('Not quite')}
                  </p>
                )}
                <p className='font-medium'>{_('Reference Idea')}</p>
                <p className='text-base-content/80 mt-1'>{oneQuestion.referenceAnswer}</p>
                <blockquote className='eink-bordered border-base-300 bg-base-200/40 mt-3 rounded-md border p-2'>
                  <div className='mb-1 flex items-center justify-between gap-2'>
                    <p className='text-base-content/60 text-xs'>{_('From the Chapter')}</p>
                    {oneQuestion.sourceAnchor && (
                      <button
                        type='button'
                        className='btn btn-ghost btn-xs eink-bordered'
                        onClick={viewOneQuestionSource}
                      >
                        {_('View in Book')}
                      </button>
                    )}
                  </div>
                  <p>{oneQuestion.evidenceQuote}</p>
                </blockquote>

                {oneQuestion.type === 'open' && (
                  <div className='mt-3'>
                    <p className='text-base-content/70 mb-2 text-xs'>
                      {_('How much did your answer cover?')}
                    </p>
                    <div className='flex flex-wrap gap-2'>
                      {(
                        [
                          ['got_it', _('I Got It')],
                          ['partly', _('Partly')],
                          ['missed', _('I Missed It')],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type='button'
                          className={`btn btn-xs ${selfAssessment === value ? 'btn-primary' : 'btn-outline eink-bordered'}`}
                          onClick={() => chooseSelfAssessment(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className='mt-4'>
                  <p className='text-base-content/70 mb-2 text-xs'>{_('Was this helpful?')}</p>
                  <div className='flex flex-wrap gap-2'>
                    {(
                      [
                        ['insightful', _('Insightful')],
                        ['too_easy', _('Too Easy')],
                        ['too_trivial', _('Too Trivial')],
                        ['not_supported', _('Not Supported')],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type='button'
                        className={`btn btn-xs ${qualityFeedback === value ? 'btn-primary' : 'btn-outline eink-bordered'}`}
                        onClick={() => chooseQualityFeedback(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className='mt-4 flex flex-wrap justify-end gap-2'>
                  <button
                    type='button'
                    className='btn btn-ghost btn-sm eink-bordered'
                    onClick={continueReading}
                  >
                    {_('Continue Reading')}
                  </button>
                  <button
                    type='button'
                    className='btn btn-primary btn-sm'
                    onClick={() => void generateOneQuestion(true)}
                  >
                    {_('Ask Another')}
                  </button>
                </div>
              </div>
            )}
          </article>
        </div>
      )}

      {mode === 'chapter_quiz' && quiz && (
        <div className='min-h-0 flex-1 overflow-y-auto px-3 py-2'>
          {submitted && (
            <p className='text-base-content/70 mb-2 text-sm'>
              {_('Score')}: {score}/{gradedQuestions.length}
            </p>
          )}
          <ol className='space-y-2'>
            {gradedQuestions.map((question, index) => (
              <li key={question.id} className='border-base-300 bg-base-100 rounded-md border p-3'>
                <p className='mb-2 text-sm font-medium'>
                  {index + 1}. {question.question}
                </p>
                {question.type === 'multiple_choice' && question.choices?.length ? (
                  <div className='space-y-1'>
                    {question.choices.map((choice) => (
                      <label key={choice} className='flex items-center gap-2 text-sm'>
                        <input
                          type='radio'
                          className='radio radio-xs'
                          name={question.id}
                          value={choice}
                          checked={answers[question.id] === choice}
                          disabled={submitted}
                          onChange={() =>
                            setAnswers((current) => ({ ...current, [question.id]: choice }))
                          }
                        />
                        <span>{choice}</span>
                      </label>
                    ))}
                  </div>
                ) : question.type === 'true_false' ? (
                  <div className='flex gap-2'>
                    {['True', 'False'].map((choice) => (
                      <button
                        key={choice}
                        type='button'
                        className={`btn btn-xs ${answers[question.id] === choice ? 'btn-primary' : 'btn-outline'}`}
                        disabled={submitted}
                        onClick={() =>
                          setAnswers((current) => ({ ...current, [question.id]: choice }))
                        }
                      >
                        {_(choice)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    className='input input-bordered input-sm w-full bg-base-100'
                    value={answers[question.id] || ''}
                    disabled={submitted}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))
                    }
                    placeholder={_('Your answer')}
                  />
                )}
                {showAnswers && (
                  <div className='border-base-300 mt-2 border-t pt-2 text-sm'>
                    <div className='flex items-center justify-between gap-2'>
                      <p className={question.isCorrect ? 'text-green-600' : 'text-red-500'}>
                        {question.isCorrect ? _('Correct') : _('Incorrect')}
                      </p>
                      {question.isCorrect === false && (
                        <button
                          type='button'
                          className='btn btn-ghost btn-xs'
                          disabled={savedMissedQuestionIds.has(question.id)}
                          onClick={() => void saveMissedQuestion(question)}
                        >
                          {savedMissedQuestionIds.has(question.id) ? <PiCheck /> : <PiFloppyDisk />}
                          {savedMissedQuestionIds.has(question.id) ? _('Saved') : _('Save')}
                        </button>
                      )}
                    </div>
                    <p className='text-base-content/70'>
                      {_('Your answer')}: {question.userAnswer || _('No answer')}
                    </p>
                    <p className='text-base-content/80'>
                      {_('Answer')}: {question.answer}
                    </p>
                    <p className='text-base-content/60 mt-1'>{question.explanation}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {!submitted && (
            <div className='mt-3 flex justify-end'>
              <button
                type='button'
                className='btn btn-primary btn-sm'
                disabled={!allAnswered}
                onClick={() => {
                  setSubmitted(true);
                  setShowAnswers(false);
                }}
              >
                {_('Submit Quiz')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default NotebookReview;
