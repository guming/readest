'use client';

import { useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import {
  NotebookAssistantError,
  runUnderstandingMapAssistant,
} from '@/services/notebook-assistant/client';
import { buildCurrentChapterContext } from '@/services/notebook-assistant/context';
import {
  getNotebookAssistantIdentity,
  isNotebookAssistantConfigured,
} from '@/services/notebook-assistant/provider';
import { resolveNotebookAssistantSettings } from '@/services/notebook-assistant/types';
import {
  evaluateUsageLimit,
  recordNotebookAssistantUsage,
} from '@/services/notebook-assistant/usage';
import type { UnderstandingMap } from '@/services/notebook-assistant/understandingMap';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { NotebookCard } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import UnderstandingMapView from './UnderstandingMapView';

export default function UnderstandingMapActions({ bookKey }: { bookKey: string }) {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const assistant = resolveNotebookAssistantSettings(settings.notebookAssistant);
  const identity = getNotebookAssistantIdentity(assistant, settings.aiSettings);
  const configured = isNotebookAssistantConfigured(assistant, settings.aiSettings, '');
  const { getBookData, getConfig, setConfig, saveConfig } = useBookDataStore();
  const { getView, getProgress } = useReaderStore();
  const [map, setMap] = useState<UnderstandingMap | null>(null);
  const [context, setContext] = useState<Awaited<
    ReturnType<typeof buildCurrentChapterContext>
  > | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const generate = async () => {
    if (!configured || loading) return;
    if (
      !window.confirm(
        _(
          'This uses the entire current chapter and may reveal text you have not read yet. Continue?',
        ),
      )
    )
      return;
    setLoading(true);
    setError('');
    setMap(null);
    setSaved(false);
    try {
      const bookDoc = getBookData(bookKey)?.bookDoc;
      if (!bookDoc) throw new Error(_('No readable text found for the current chapter.'));
      const nextContext = await buildCurrentChapterContext(
        bookDoc,
        getView(bookKey),
        getProgress(bookKey),
      );
      if (!nextContext.sourceBlocks?.length)
        throw new Error(_('This chapter has no passages that can be linked to the text.'));
      const sourceLength = nextContext.sourceBlocks.reduce(
        (sum, block) => sum + block.text.length,
        0,
      );
      const tokenEstimate = { input: Math.ceil(sourceLength / 3) + 600, output: 2400 };
      if (
        tokenEstimate.input > assistant.warnAboveTokens &&
        !window.confirm(_('This context is long and may cost more than usual. Continue?'))
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
        !window.confirm(
          _(
            'This request may exceed your daily token limit. Estimated total: {{total}} / {{limit}} tokens. Continue?',
            { total: limit.projectedTotal, limit: limit.limit },
          ),
        )
      )
        return;
      const result = await runUnderstandingMapAssistant(
        {
          title: nextContext.title,
          targetLanguage: assistant.targetLanguage || navigator.language || 'English',
          sourceBlocks: nextContext.sourceBlocks,
        },
        assistant,
        '',
        settings.aiSettings,
      );
      setContext(nextContext);
      setMap(result);
      if (assistant.usageTrackingEnabled)
        recordNotebookAssistantUsage({
          action: 'understanding_map',
          contextType: 'chapter',
          provider: identity.provider,
          model: identity.model,
          tokenEstimate,
          success: true,
          bookId: bookKey.split('-')[0],
        });
    } catch (cause) {
      setError((cause as Error).message);
      if (assistant.usageTrackingEnabled)
        recordNotebookAssistantUsage({
          action: 'understanding_map',
          contextType: 'chapter',
          provider: identity.provider,
          model: identity.model,
          tokenEstimate: { input: 0, output: 0 },
          success: false,
          errorCode: cause instanceof NotebookAssistantError ? cause.code : 'unknown',
          bookId: bookKey.split('-')[0],
        });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!map || !context || saved || saving) return;
    const config = getConfig(bookKey);
    if (!config) {
      setError(_('Book data is not ready. Try saving again.'));
      return;
    }
    setSaving(true);
    setError('');
    const now = Date.now();
    const card: NotebookCard = {
      id: uniqueId(),
      bookId: bookKey.split('-')[0]!,
      chapterId: context.chapterId,
      chapterTitle: context.chapterTitle,
      pageNumber: context.pageNumber,
      pageCfi: context.pageCfi,
      type: 'understanding_map',
      title: `${_('Understanding Map')} · ${context.title}`,
      content: map,
      contextType: 'chapter',
      targetLanguage: assistant.targetLanguage || navigator.language,
      provider: identity.provider,
      model: identity.model,
      tokenEstimate: { input: Math.ceil((context.sourceText.length || 0) / 3) + 600, output: 2400 },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const next = {
      ...config,
      notebookCards: [...(config.notebookCards ?? []), card],
      updatedAt: now,
    };
    try {
      await saveConfig(envConfig, bookKey, next, settings);
      setConfig(bookKey, next);
      setSaved(true);
    } catch (cause) {
      setError((cause as Error).message || _('Could not save the map. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  if (!configured) return null;
  return (
    <section className='border-base-300 border-b p-3'>
      <div className='mb-2 flex items-center justify-between gap-2'>
        <h2 className='text-sm font-semibold'>{_('Understanding Map')}</h2>
        <button
          type='button'
          className='btn btn-primary btn-xs'
          disabled={loading}
          onClick={() => void generate()}
        >
          {loading ? _('Generating…') : map ? _('Regenerate') : _('Generate Map')}
        </button>
      </div>
      <p className='mb-2 text-xs text-base-content/60'>
        {_('Map the ideas and changes in the current chapter, with links to the source text.')}
      </p>
      {error && <p className='mb-2 text-xs text-red-500'>{error}</p>}
      {map && <UnderstandingMapView map={map} bookKey={bookKey} />}
      {map && (
        <button
          type='button'
          className='btn btn-ghost btn-xs mt-2'
          disabled={saved || saving}
          onClick={() => void save()}
        >
          {saved ? _('Saved') : saving ? _('Saving…') : _('Save')}
        </button>
      )}
    </section>
  );
}
