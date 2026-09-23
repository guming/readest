'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentLoader, type BookDoc, type BookMetadata } from '@/libs/document';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book, BookConfig } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import {
  classifyBookForLearningGuide,
  estimateLearningGuideTokens,
  NotebookAssistantError,
  runBookLearningGuideAssistant,
} from '@/services/notebook-assistant/client';
import {
  buildLearningGuideContext,
  resolveLearningGuideTargetLanguage,
  type LearningGuideContext,
} from '@/services/notebook-assistant/learningGuideContext';
import { evaluateLearningGuideEligibility } from '@/services/notebook-assistant/learningGuideEligibility';
import {
  deleteLearningGuideCard,
  getLearningGuideCard,
  isLearningGuide,
  isLearningGuideStale,
  upsertLearningGuideCard,
} from '@/services/notebook-assistant/learningGuideStorage';
import {
  evaluateUsageLimit,
  recordNotebookAssistantUsage,
} from '@/services/notebook-assistant/usage';
import {
  getNotebookAssistantIdentity,
  isNotebookAssistantConfigured,
} from '@/services/notebook-assistant/provider';
import {
  resolveNotebookAssistantSettings,
  type BookLearningEligibility,
  type BookLearningGuide,
  type NonFictionCategory,
} from '@/services/notebook-assistant/types';
import { recordLearningGuideEvent } from '@/services/notebook-assistant/learningGuideEvents';

export type LearningGuideViewState =
  | { type: 'idle' }
  | { type: 'needs_ai_setup' }
  | { type: 'classifying' }
  | { type: 'unsupported_fiction' }
  | { type: 'classification_uncertain' }
  | { type: 'generating'; stage: 'collecting_sources' | 'building_framework' | 'validating_result' }
  | { type: 'ready'; guide: BookLearningGuide; stale: boolean }
  | { type: 'error'; message: string; previousGuide?: BookLearningGuide };

interface Options {
  bookKey: string;
  book?: Book | null;
  metadata?: BookMetadata | null;
  bookDoc?: BookDoc | null;
}

const metadataText = (metadata: BookMetadata): string =>
  [metadata.title, metadata.author, metadata.description, metadata.subject]
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value ?? '')))
    .join('\n');

export function useBookLearningGuide({ bookKey, book, metadata, bookDoc }: Options) {
  const { envConfig, appService } = useEnv();
  const settings = useSettingsStore((value) => value.settings);
  const storeConfig = useBookDataStore((value) => value.getConfig(bookKey));
  const setConfig = useBookDataStore((value) => value.setConfig);
  const saveStoreConfig = useBookDataStore((value) => value.saveConfig);
  const storeBookData = useBookDataStore((value) => value.getBookData(bookKey));
  const resolvedBook = book ?? storeBookData?.book ?? null;
  const resolvedMetadata =
    metadata ??
    bookDoc?.metadata ??
    storeBookData?.bookDoc?.metadata ??
    resolvedBook?.metadata ??
    null;
  const resolvedBookDoc = bookDoc ?? storeBookData?.bookDoc ?? null;
  const [localConfig, setLocalConfig] = useState<BookConfig | null>(null);
  const [state, setState] = useState<LearningGuideViewState>({ type: 'idle' });
  const [lastContext, setLastContext] = useState<LearningGuideContext | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const assistant = resolveNotebookAssistantSettings(settings.notebookAssistant);
  const identity = getNotebookAssistantIdentity(assistant, settings.aiSettings);
  const configured = isNotebookAssistantConfigured(assistant, settings.aiSettings, '');
  const config = storeConfig ?? localConfig;
  const card = useMemo(() => getLearningGuideCard(config), [config]);
  const guide = card && isLearningGuide(card.content) ? card.content : null;

  useEffect(() => {
    if (storeConfig || !resolvedBook || !appService) return;
    let active = true;
    void appService.loadBookConfig(resolvedBook, settings).then((value) => {
      if (active) setLocalConfig(value);
    });
    return () => {
      active = false;
    };
  }, [appService, resolvedBook, settings, storeConfig]);

  useEffect(() => {
    if (!guide) {
      if (state.type === 'ready') setState({ type: 'idle' });
      return;
    }
    setState({
      type: 'ready',
      guide,
      stale: isLearningGuideStale(
        guide,
        lastContext?.sourceFingerprint,
        lastContext?.status === 'grounded' || !!resolvedBookDoc,
      ),
    });
    // State changes are driven by persisted guide identity, not transient state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide, lastContext, resolvedBookDoc]);

  const persist = useCallback(
    async (next: BookConfig) => {
      if (!resolvedBook) return;
      if (storeConfig) {
        setConfig(bookKey, next);
        await saveStoreConfig(envConfig, bookKey, next, settings);
      } else if (appService) {
        setLocalConfig(next);
        await appService.saveBookConfig(resolvedBook, next, settings);
      }
    },
    [
      appService,
      bookKey,
      envConfig,
      resolvedBook,
      saveStoreConfig,
      setConfig,
      settings,
      storeConfig,
    ],
  );

  const collectContext = useCallback(async (): Promise<LearningGuideContext> => {
    if (!resolvedMetadata) throw new Error('Book metadata is unavailable.');
    let doc = resolvedBookDoc;
    if (!doc && resolvedBook && appService) {
      const size = await appService.getBookFileSize(resolvedBook);
      if (size !== null) {
        const content = await appService.loadBookContent(resolvedBook);
        const nativeFilePath = await appService.resolveNativeBookFilePath(resolvedBook);
        doc = (
          await new DocumentLoader(content.file, {
            nativeFilePath: nativeFilePath ?? undefined,
          }).open()
        ).book;
      }
    }
    const value = await buildLearningGuideContext({
      bookKey,
      metadata: resolvedMetadata,
      bookDoc: doc,
      costMode: assistant.costMode,
    });
    setLastContext(value);
    return value;
  }, [appService, assistant.costMode, bookKey, resolvedBook, resolvedBookDoc, resolvedMetadata]);

  const runGeneration = useCallback(
    async (knowledgeOnly = false, forcedCategory?: NonFictionCategory) => {
      if (!configured) {
        setState({ type: 'needs_ai_setup' });
        return;
      }
      if (!resolvedMetadata || !config) {
        setState({
          type: 'error',
          message: 'Book information is not ready.',
          previousGuide: guide ?? undefined,
        });
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++requestIdRef.current;
      let estimate = { input: 0, output: 0 };
      try {
        recordLearningGuideEvent(
          guide ? 'learning_guide_regenerated' : 'learning_guide_requested',
          bookKey.split('-')[0],
        );
        setState({ type: 'generating', stage: 'collecting_sources' });
        const context = await collectContext();
        let eligibility: BookLearningEligibility = forcedCategory
          ? { status: 'supported', category: forcedCategory, confidence: 1, evidence: [] }
          : evaluateLearningGuideEligibility({
              title: resolvedBook?.title,
              author: resolvedBook?.author,
              description: resolvedMetadata.description,
              subject: resolvedMetadata.subject,
              calibreColumns: resolvedMetadata.calibreColumns,
              format: resolvedBook?.format,
            });
        if (eligibility.status === 'uncertain' && !knowledgeOnly) {
          setState({ type: 'classifying' });
          eligibility = await classifyBookForLearningGuide(
            metadataText(resolvedMetadata),
            context.tocTitles,
            settings.aiSettings,
            controller.signal,
          );
        }
        if (eligibility.status === 'unsupported_fiction') {
          recordLearningGuideEvent('learning_guide_unsupported_fiction', bookKey.split('-')[0]);
          setState({ type: 'unsupported_fiction' });
          return;
        }
        if (eligibility.status === 'uncertain' && !knowledgeOnly) {
          recordLearningGuideEvent(
            'learning_guide_classification_uncertain',
            bookKey.split('-')[0],
          );
          setState({ type: 'classification_uncertain' });
          return;
        }
        const category =
          eligibility.status === 'supported' ? eligibility.category : 'other_nonfiction';
        estimate = estimateLearningGuideTokens(context.sourceText);
        if (estimate.input > assistant.warnAboveTokens) {
          const accepted = window.confirm(
            'This book context is long and may cost more than usual. Continue?',
          );
          if (!accepted) return;
        }
        const limit = evaluateUsageLimit(assistant, estimate);
        if (!limit.allowed) throw new Error('Daily token limit reached.');
        if (limit.needsConfirmation) {
          const accepted = window.confirm(
            `This request may exceed your daily token limit (${limit.projectedTotal} / ${limit.limit}). Continue?`,
          );
          if (!accepted) return;
        }
        setState({ type: 'generating', stage: 'building_framework' });
        const nextGuide = await runBookLearningGuideAssistant(
          {
            bookKey,
            title: resolvedBook?.title || 'Untitled',
            author: resolvedBook?.author,
            category,
            sourceText: context.sourceText,
            targetLanguage: resolveLearningGuideTargetLanguage(
              assistant.targetLanguage,
              resolvedMetadata.language,
              navigator.language || 'en',
            ),
            knowledgeOnly,
          },
          context,
          settings.aiSettings,
          identity.provider,
          identity.model,
          controller.signal,
        );
        setState({ type: 'generating', stage: 'validating_result' });
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        const nextConfig = upsertLearningGuideCard(
          config,
          nextGuide,
          identity.provider,
          identity.model,
          estimate,
          uniqueId(),
        );
        await persist(nextConfig);
        recordLearningGuideEvent('learning_guide_generated', bookKey.split('-')[0]);
        if (assistant.usageTrackingEnabled) {
          recordNotebookAssistantUsage({
            action: 'learning_guide',
            contextType: 'book',
            provider: identity.provider,
            model: identity.model,
            tokenEstimate: estimate,
            success: true,
            bookId: bookKey.split('-')[0],
          });
        }
        setState({ type: 'ready', guide: nextGuide, stale: false });
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        if (assistant.usageTrackingEnabled && estimate.input > 0) {
          recordNotebookAssistantUsage({
            action: 'learning_guide',
            contextType: 'book',
            provider: identity.provider,
            model: identity.model,
            tokenEstimate: estimate,
            success: false,
            errorCode: error instanceof NotebookAssistantError ? error.code : 'unknown',
            bookId: bookKey.split('-')[0],
          });
        }
        recordLearningGuideEvent('learning_guide_failed', bookKey.split('-')[0]);
        setState({
          type: 'error',
          message: (error as Error).message,
          previousGuide: guide ?? undefined,
        });
      }
    },
    [
      assistant,
      bookKey,
      collectContext,
      config,
      configured,
      guide,
      identity,
      persist,
      resolvedBook,
      resolvedMetadata,
      settings.aiSettings,
    ],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    requestIdRef.current += 1;
    recordLearningGuideEvent('learning_guide_cancelled', bookKey.split('-')[0]);
    setState(guide ? { type: 'ready', guide, stale: false } : { type: 'idle' });
  }, [bookKey, guide]);

  const deleteGuide = useCallback(async () => {
    if (!config) return;
    await persist(deleteLearningGuideCard(config));
    recordLearningGuideEvent('learning_guide_deleted', bookKey.split('-')[0]);
    setState({ type: 'idle' });
  }, [bookKey, config, persist]);

  const refresh = useCallback(() => {
    if (guide) setState({ type: 'ready', guide, stale: false });
    else setState(configured ? { type: 'idle' } : { type: 'needs_ai_setup' });
  }, [configured, guide]);

  return {
    state,
    guide,
    configured,
    generate: () => runGeneration(false),
    confirmKnowledgeOnly: () => runGeneration(true, 'other_nonfiction'),
    regenerate: () => runGeneration(false),
    cancel,
    deleteGuide,
    refresh,
  };
}
