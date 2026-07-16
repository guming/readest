import React, { useEffect, useMemo, useState } from 'react';
import { PiCheck, PiFloppyDisk, PiSpinner, PiStudent } from 'react-icons/pi';

import NotebookAssistantPanel from '@/components/settings/NotebookAssistantPanel';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import {
  buildCurrentChapterContext,
  type NotebookAssistantContext,
} from '@/services/notebook-assistant/context';
import {
  NotebookAssistantError,
  estimateQuizTokens,
  runChapterQuizAssistant,
} from '@/services/notebook-assistant/client';
import { getAssistantApiKey } from '@/services/notebook-assistant/secretStore';
import {
  evaluateUsageLimit,
  recordNotebookAssistantUsage,
} from '@/services/notebook-assistant/usage';
import {
  resolveNotebookAssistantSettings,
  type QuizCardContent,
  type QuizQuestion,
} from '@/services/notebook-assistant/types';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { NotebookCard } from '@/types/book';
import { uniqueId } from '@/utils/misc';

interface Props {
  bookKey: string;
}

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
  const quizQuestionCount = assistant.defaultQuizQuestionCount;
  const targetLanguage = assistant.targetLanguage || navigator.language || 'English';
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [context, setContext] = useState<NotebookAssistantContext | null>(null);
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

  useEffect(() => {
    void getAssistantApiKey().then(setApiKey);
  }, []);

  const configured = !!apiKey && !!assistant.baseUrl && !!assistant.model;
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

  const generateQuiz = async () => {
    if (!apiKey) return;
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
          provider: assistant.provider,
          model: assistant.model,
          questionCount: quizQuestionCount,
        },
        assistant,
        apiKey,
      );
      setQuiz(nextQuiz);
      if (assistant.usageTrackingEnabled) {
        recordNotebookAssistantUsage({
          action: 'quiz',
          contextType: 'chapter',
          provider: assistant.provider,
          model: assistant.model,
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
          provider: assistant.provider,
          model: assistant.model,
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
      provider: assistant.provider,
      model: assistant.model,
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
      provider: assistant.provider,
      model: assistant.model,
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

  if (apiKey === null) {
    return (
      <div className='flex min-h-16 items-center justify-center'>
        <PiSpinner className='animate-spin' />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className='border-base-300 border-b p-3'>
        <NotebookAssistantPanel
          compact
          onConfigured={() => void getAssistantApiKey().then(setApiKey)}
        />
      </div>
    );
  }

  return (
    <section className='flex min-h-0 flex-1 flex-col'>
      <div className='border-base-300 border-b p-3'>
        <div className='mb-2 flex items-center gap-2'>
          <PiStudent className='shrink-0' />
          <h2 className='text-sm font-semibold'>{_('Chapter Quiz')}</h2>
        </div>
        <p className='text-base-content/60 mb-2 text-xs'>
          {context
            ? `${context.title} · ~${estimate.input} ${_('input tokens')} ${_('max')} ~${estimate.output} ${_('output tokens')}`
            : `${assistant.provider} · ${assistant.model}`}
        </p>
        {error && <p className='mb-2 text-xs text-red-500'>{error}</p>}
        <div className='flex justify-end gap-1'>
          {quiz && submitted && (
            <button
              type='button'
              className='btn btn-ghost btn-xs'
              onClick={() => setShowAnswers((current) => !current)}
            >
              {showAnswers ? _('Hide Answers') : _('Show Answers')}
            </button>
          )}
          {quiz && submitted && (
            <button
              type='button'
              className='btn btn-ghost btn-xs'
              onClick={saveQuiz}
              disabled={saved}
            >
              {saved ? <PiCheck /> : <PiFloppyDisk />} {saved ? _('Saved') : _('Save')}
            </button>
          )}
          <button
            type='button'
            className='btn btn-primary btn-xs'
            onClick={generateQuiz}
            disabled={loading}
          >
            {loading ? <PiSpinner className='animate-spin' /> : <PiStudent />}
            {quiz ? _('Regenerate') : _('Generate Quiz')}
          </button>
        </div>
      </div>

      {quiz && (
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
