'use client';

import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { runHistoryChapterGuideAssistant } from '@/services/notebook-assistant/client';
import {
  buildCurrentChapterContext,
  getCurrentChapterIdentity,
} from '@/services/notebook-assistant/context';
import type {
  HistoryChapterGuide,
  HistoryEvidence,
} from '@/services/notebook-assistant/historyChapterGuide';
import { findEvidenceRange } from '@/services/notebook-assistant/historyChapterGuide';
import type { HistoryProgress } from '@/services/notebook-assistant/historyChapterPipeline';
import {
  getNotebookAssistantIdentity,
  isNotebookAssistantConfigured,
} from '@/services/notebook-assistant/provider';
import { resolveNotebookAssistantSettings } from '@/services/notebook-assistant/types';
import {
  evaluateUsageLimit,
  recordNotebookAssistantUsage,
} from '@/services/notebook-assistant/usage';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { NotebookCard } from '@/types/book';
import { eventDispatcher } from '@/utils/event';
import { uniqueId } from '@/utils/misc';
import { getIndexFromCfi } from '@/utils/cfi';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/primitives/tooltip';

function EvidenceLink({
  item,
  label,
  onClick,
}: {
  item: HistoryEvidence;
  label: string;
  onClick: () => void;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className='text-start text-xs underline text-base-content/70'
            disabled={!item.sourceCfi}
            onClick={onClick}
            aria-label={`${item.evidenceQuote} · ${label}`}
          >
            “{item.evidenceQuote}” · {label}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side='top'
          className='max-h-48 max-w-[min(32rem,calc(100vw-2rem))] overflow-y-auto whitespace-pre-wrap break-words border border-base-300 bg-base-100 text-base-content'
        >
          {item.evidenceQuote}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function HistoryChapterGuideView({
  guide,
  bookKey,
}: {
  guide: HistoryChapterGuide;
  bookKey: string;
}) {
  const _ = useTranslation();
  const { getView } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const navigateEvidence = async (item: HistoryEvidence) => {
    const view = getView(bookKey);
    const bookDoc = getBookData(bookKey)?.bookDoc;
    if (!view || !bookDoc) return;
    const sectionIndex = item.sourceCfi ? getIndexFromCfi(item.sourceCfi) : null;
    if (sectionIndex == null || !bookDoc.sections[sectionIndex]) return;
    try {
      const doc = await bookDoc.sections[sectionIndex]!.createDocument();
      const range = findEvidenceRange(doc, item.evidenceQuote);
      if (!range) {
        console.warn('[Notebook Assistant] Could not locate chapter-guide quotation.', {
          sectionIndex,
          quoteLength: item.evidenceQuote.length,
        });
        return;
      }
      const cfi = view.getCFI(sectionIndex, range);
      eventDispatcher.dispatch('navigate', { bookKey, cfi });
      await view.goTo(cfi);
    } catch (error) {
      console.error('[Notebook Assistant] Could not navigate to chapter-guide evidence.', {
        sectionIndex,
        error: (error as Error).message,
      });
    }
  };
  const renderEvidence = (item: HistoryEvidence, index: number) => (
    <li key={index} className='mb-2'>
      <p>{item.point}</p>
      <EvidenceLink
        item={item}
        label={_('View in book')}
        onClick={() => void navigateEvidence(item)}
      />
    </li>
  );
  return (
    <div className='space-y-3 text-sm leading-relaxed'>
      <p>{guide.overview}</p>
      <section>
        <h3 className='font-semibold'>{_('Key Points')}</h3>
        <ol className='list-inside list-decimal'>{guide.keyPoints.map(renderEvidence)}</ol>
      </section>
      {guide.reasoning.length > 0 && (
        <section>
          <h3 className='font-semibold'>{_('Reasoning')}</h3>
          <ol className='list-inside list-decimal'>
            {guide.reasoning.map((item, index) => (
              <li key={index} className='mb-2'>
                <p>
                  {item.premise} → {item.conclusion}
                </p>
                <p>{item.point}</p>
                <EvidenceLink
                  item={item}
                  label={_('View in book')}
                  onClick={() => void navigateEvidence(item)}
                />
              </li>
            ))}
          </ol>
        </section>
      )}
      {guide.limits.length > 0 && (
        <section>
          <h3 className='font-semibold'>{_('Limits and Questions')}</h3>
          <ul>{guide.limits.map(renderEvidence)}</ul>
        </section>
      )}
      {guide.takeaways.length > 0 && (
        <section>
          <h3 className='font-semibold'>{_('What You Can Take Away')}</h3>
          <ul className='list-inside list-disc'>
            {guide.takeaways.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function HistoryChapterGuideActions({ bookKey }: { bookKey: string }) {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const assistant = resolveNotebookAssistantSettings(settings.notebookAssistant);
  const identity = getNotebookAssistantIdentity(assistant, settings.aiSettings);
  const { getBookData, getConfig, setConfig, saveConfig } = useBookDataStore();
  const { getView, getProgress } = useReaderStore();
  const [guide, setGuide] = useState<HistoryChapterGuide | null>(null);
  const [context, setContext] = useState<Awaited<
    ReturnType<typeof buildCurrentChapterContext>
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<HistoryProgress | null>(null);
  const [lastEstimate, setLastEstimate] = useState({ input: 0, output: 0 });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const configured = isNotebookAssistantConfigured(assistant, settings.aiSettings, '');
  const findSavedGuide = (chapterId?: string, chapterTitle?: string) => {
    const cards = getConfig(bookKey)?.notebookCards ?? [];
    return cards
      .filter(
        (card) =>
          !card.deletedAt &&
          card.type === 'history_chapter_guide' &&
          (chapterId
            ? card.chapterId === chapterId
            : !!chapterTitle && card.chapterTitle === chapterTitle),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .find(
        (card) =>
          !!card.content &&
          typeof card.content === 'object' &&
          'schemaVersion' in card.content &&
          card.content.schemaVersion === 1 &&
          'keyPoints' in card.content &&
          Array.isArray(card.content.keyPoints),
      );
  };
  useEffect(() => {
    const bookDoc = getBookData(bookKey)?.bookDoc;
    if (!bookDoc) return;
    let active = true;
    void getCurrentChapterIdentity(bookDoc, getView(bookKey), getProgress(bookKey))
      .then((identity) => {
        if (!active) return;
        const card = findSavedGuide(identity.chapterId, identity.chapterTitle);
        if (!card) return;
        setGuide(card.content as HistoryChapterGuide);
        setContext({ sourceText: '', ...identity });
        setSaved(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [bookKey, getBookData, getConfig, getView, getProgress]);
  const generate = async () => {
    if (!configured || !appService || loading) return;
    try {
      const accepted = await appService.ask(
        _(
          'This uses the entire current chapter and may reveal text you have not read yet. Continue?',
        ),
      );
      if (!accepted) return;
    } catch (cause) {
      setError(_((cause as Error).message));
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    setError('');
    setGuide(null);
    setSaved(false);
    setProgress(null);
    let tokenEstimate = { input: 0, output: 0 };
    let nextContext: Awaited<ReturnType<typeof buildCurrentChapterContext>> | null = null;
    try {
      const bookDoc = getBookData(bookKey)?.bookDoc;
      if (!bookDoc) throw new Error(_('No readable text found for the current chapter.'));
      nextContext = await buildCurrentChapterContext(
        bookDoc,
        getView(bookKey),
        getProgress(bookKey),
      );
      const savedCard = findSavedGuide(nextContext.chapterId, nextContext.chapterTitle);
      if (savedCard && typeof savedCard.content === 'object' && 'keyPoints' in savedCard.content) {
        setGuide(savedCard.content as HistoryChapterGuide);
        setContext(nextContext);
        setSaved(true);
        return;
      }
      const blocks = nextContext.sourceBlocks ?? [];
      if (!blocks.length)
        throw new Error(_('This chapter has no passages that can be linked to the text.'));
      const totalChars = blocks.reduce((sum, block) => sum + block.text.length, 0);
      const groupCount = Math.ceil(totalChars / 3_000);
      let aggregateCount = 0;
      let remainingNotes = groupCount;
      while (remainingNotes > 5) {
        remainingNotes = Math.ceil(remainingNotes / 5);
        aggregateCount += remainingNotes;
      }
      aggregateCount += 1;
      tokenEstimate = {
        input: Math.ceil(totalChars * 0.8) + groupCount * 400 + aggregateCount * 1_200,
        output: groupCount * 1_800 + aggregateCount * 3_000,
      };
      if (
        tokenEstimate.input > assistant.warnAboveTokens &&
        !(await appService.ask(_('This context is long and may cost more than usual. Continue?')))
      )
        return;
      const limit = evaluateUsageLimit(assistant, tokenEstimate);
      if (!limit.allowed)
        throw new Error(
          _(
            'Daily token limit reached. Adjust the limit or cost mode in Notebook Assistant settings.',
          ),
        );
      if (
        limit.needsConfirmation &&
        !(await appService.ask(
          _(
            'This request may exceed your daily token limit. Estimated total: {{total}} / {{limit}} tokens. Continue?',
            { total: limit.projectedTotal, limit: limit.limit },
          ),
        ))
      )
        return;
      const result = await runHistoryChapterGuideAssistant(
        {
          title: nextContext.title,
          targetLanguage: assistant.targetLanguage || navigator.language || 'English',
          sourceBlocks: blocks,
          bookKey,
          modelIdentity: `${identity.provider}/${identity.model}`,
          signal: controller.signal,
          onProgress: setProgress,
        },
        assistant,
        '',
        settings.aiSettings,
      );
      setGuide(result);
      setContext(nextContext);
      setLastEstimate(tokenEstimate);
      if (assistant.usageTrackingEnabled)
        recordNotebookAssistantUsage({
          action: 'history_chapter_guide',
          contextType: 'chapter',
          provider: identity.provider,
          model: identity.model,
          tokenEstimate,
          success: true,
          bookId: bookKey.split('-')[0],
        });
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') {
        setError(_('Analysis cancelled. Completed parts are saved for retry.'));
      } else {
        const message = (cause as Error).message;
        console.error('[Notebook Assistant] History chapter guide failed.', {
          model: identity.model,
          provider: identity.provider,
          progress: progress
            ? { stage: progress.stage, completed: progress.completed, total: progress.total }
            : null,
          errorName: (cause as Error).name,
          error: message,
        });
        const partError = message.match(/^Could not analyze part (\d+) of (\d+): (.+)$/s);
        const combineError = message.match(/^Could not combine chapter findings: (.+)$/s);
        setError(
          partError
            ? `${_('Could not analyze part {{current}} of {{total}}. Retry to continue.', {
                current: Number(partError[1]),
                total: Number(partError[2]),
              })} ${_(partError[3]!)}`
            : combineError
              ? `${_('Could not combine chapter findings. Please retry.')} ${_(combineError[1]!)}`
              : _(message),
        );
      }
      if (assistant.usageTrackingEnabled && nextContext) {
        recordNotebookAssistantUsage({
          action: 'history_chapter_guide',
          contextType: 'chapter',
          provider: identity.provider,
          model: identity.model,
          tokenEstimate,
          success: false,
          errorCode: (cause as Error).name === 'AbortError' ? 'cancelled' : 'invalid_response',
          bookId: bookKey.split('-')[0],
        });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };
  const save = async () => {
    if (!guide || !context || saved) return;
    const config = getConfig(bookKey);
    if (!config) return;
    const now = Date.now();
    const next = {
      ...config,
      notebookCards: (() => {
        const existing = (config.notebookCards ?? []).find(
          (card) =>
            !card.deletedAt &&
            card.type === 'history_chapter_guide' &&
            (context.chapterId
              ? card.chapterId === context.chapterId
              : !!context.chapterTitle && card.chapterTitle === context.chapterTitle),
        );
        const card: NotebookCard = {
          ...(existing ?? {}),
          id: existing?.id ?? uniqueId(),
          bookId: bookKey.split('-')[0]!,
          chapterId: context.chapterId,
          chapterTitle: context.chapterTitle,
          pageCfi: context.pageCfi,
          type: 'history_chapter_guide' as const,
          title: `${_('History Chapter Guide')} · ${context.title}`,
          content: guide,
          contextType: 'chapter' as const,
          provider: identity.provider,
          model: identity.model,
          tokenEstimate: lastEstimate,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
        };
        return existing
          ? (config.notebookCards ?? []).map((item) => (item.id === existing.id ? card : item))
          : [...(config.notebookCards ?? []), card];
      })(),
      updatedAt: now,
    };
    try {
      await saveConfig(envConfig, bookKey, next, settings);
      setConfig(bookKey, next);
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return (
    <section className='border-base-300 border-b p-3 text-sm'>
      <h2 className='mb-1 font-semibold'>{_('History Chapter Guide')}</h2>
      <p className='mb-2 text-base-content/70'>
        {_('Analyze this history chapter with quotes linked to the book.')}
      </p>
      {loading ? (
        <div className='flex items-center gap-2'>
          <span aria-live='polite'>
            {progress?.stage === 'reading'
              ? _('Analyzing part {{current}} of {{total}}', {
                  current: Math.min(progress.total, progress.completed + 1),
                  total: progress.total,
                })
              : _('Combining chapter findings...')}
          </span>
          <button
            className='btn btn-ghost btn-sm eink-bordered'
            type='button'
            onClick={() => abortRef.current?.abort()}
          >
            {_('Cancel')}
          </button>
        </div>
      ) : (
        <button
          className='btn btn-primary btn-sm'
          type='button'
          disabled={!configured || !appService || saved}
          onClick={() => void generate()}
        >
          {saved ? _('Saved') : _('Analyze Current Chapter')}
        </button>
      )}
      {!configured && <p className='mt-2'>{_('Configure Notebook Assistant first.')}</p>}
      {error && (
        <p role='alert' className='mt-2 text-error'>
          {error}
        </p>
      )}
      {guide && (
        <div className='mt-3'>
          <HistoryChapterGuideView guide={guide} bookKey={bookKey} />
          <button
            className='btn btn-ghost btn-sm mt-2'
            type='button'
            disabled={saved}
            onClick={() => void save()}
          >
            {saved ? _('Saved') : _('Save to Notebook')}
          </button>
        </div>
      )}
    </section>
  );
}
