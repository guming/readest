import React, { useMemo, useState } from 'react';
import { PiCheck, PiCopy, PiFloppyDisk, PiLightbulb, PiSpinner } from 'react-icons/pi';

import NotebookAssistantPanel from '@/components/settings/NotebookAssistantPanel';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import {
  NotebookAssistantError,
  estimateContextTokens,
  runNotebookContextAssistant,
} from '@/services/notebook-assistant/client';
import {
  buildCurrentChapterContext,
  buildCurrentPageContext,
  type NotebookAssistantContext,
} from '@/services/notebook-assistant/context';
import {
  evaluateUsageLimit,
  recordNotebookAssistantUsage,
} from '@/services/notebook-assistant/usage';
import {
  resolveNotebookAssistantSettings,
  type NotebookAssistantCardAction,
} from '@/services/notebook-assistant/types';
import {
  getNotebookAssistantIdentity,
  isNotebookAssistantConfigured,
} from '@/services/notebook-assistant/provider';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { NotebookCard } from '@/types/book';
import { writeTextToClipboard } from '@/utils/clipboard';
import { uniqueId } from '@/utils/misc';
import { NotebookAssistantIcon } from './AssistantFeatureIcons';

interface Props {
  bookKey: string;
  showSetup?: boolean;
}

const actionLabels: Record<NotebookAssistantCardAction, string> = {
  summary: 'Summary',
  insight: 'Key Insights',
  takeaway: 'Takeaways',
};

const NotebookAssistantActions: React.FC<Props> = ({ bookKey, showSetup = true }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const { getBookData, getConfig, setConfig, saveConfig } = useBookDataStore();
  const { getView, getProgress } = useReaderStore();
  const assistant = resolveNotebookAssistantSettings(settings.notebookAssistant);
  const assistantIdentity = getNotebookAssistantIdentity(assistant, settings.aiSettings);
  const targetLanguage = assistant.targetLanguage || navigator.language || 'English';
  const [contextType, setContextType] = useState<'page' | 'chapter'>('page');
  const [action, setAction] = useState<NotebookAssistantCardAction>('summary');
  const [context, setContext] = useState<NotebookAssistantContext | null>(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const configured = isNotebookAssistantConfigured(assistant, settings.aiSettings, '');
  const estimate = useMemo(
    () => estimateContextTokens(context?.sourceText || '', action),
    [context?.sourceText, action],
  );

  const loadContext = async (): Promise<NotebookAssistantContext | null> => {
    const bookDoc = getBookData(bookKey)?.bookDoc;
    if (!bookDoc) return null;
    const view = getView(bookKey);
    const progress = getProgress(bookKey);
    return contextType === 'page'
      ? buildCurrentPageContext(bookDoc, view, progress)
      : buildCurrentChapterContext(bookDoc, view, progress);
  };

  const run = async () => {
    if (!configured) return;
    setLoading(true);
    setError('');
    setResult('');
    setSaved(false);
    let usageContext: NotebookAssistantContext | null = null;
    let usageEstimate = estimate;
    try {
      const nextContext = await loadContext();
      if (!nextContext?.sourceText) {
        throw new Error(_('No readable text found for the current context.'));
      }
      const nextEstimate = estimateContextTokens(nextContext.sourceText, action);
      usageContext = nextContext;
      usageEstimate = nextEstimate;
      if (nextEstimate.input > assistant.warnAboveTokens) {
        const accepted = window.confirm(
          _('This context is long and may cost more than usual. Continue?'),
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
      const content = await runNotebookContextAssistant(
        {
          action,
          contextType: nextContext.contextType,
          sourceText: nextContext.sourceText,
          title: nextContext.title,
          targetLanguage,
          provider: assistantIdentity.provider,
          model: assistantIdentity.model,
          summaryStyle: assistant.defaultSummaryStyle,
        },
        assistant,
        '',
        undefined,
        settings.aiSettings,
      );
      setResult(content);
      if (assistant.usageTrackingEnabled) {
        recordNotebookAssistantUsage({
          action,
          contextType: nextContext.contextType,
          provider: assistantIdentity.provider,
          model: assistantIdentity.model,
          tokenEstimate: nextEstimate,
          success: true,
          bookId: bookKey.split('-')[0],
        });
      }
    } catch (runError) {
      setError((runError as Error).message);
      if (assistant.usageTrackingEnabled && usageContext) {
        recordNotebookAssistantUsage({
          action,
          contextType: usageContext.contextType,
          provider: assistantIdentity.provider,
          model: assistantIdentity.model,
          tokenEstimate: usageEstimate,
          success: false,
          errorCode: runError instanceof NotebookAssistantError ? runError.code : 'unknown',
          bookId: bookKey.split('-')[0],
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!result || !context || saved) return;
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
      type: action,
      title: `${_(actionLabels[action])} · ${context.title}`,
      sourceText: context.sourceText.slice(0, 2_000),
      content: result,
      contextType: context.contextType,
      targetLanguage,
      provider: assistantIdentity.provider,
      model: assistantIdentity.model,
      tokenEstimate: estimateContextTokens(context.sourceText, action),
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

  if (!configured) {
    return showSetup ? (
      <div className='border-base-300 border-b p-3'>
        <NotebookAssistantPanel compact />
      </div>
    ) : null;
  }

  return (
    <section className='border-base-300 border-b p-3'>
      <div className='mb-2 flex items-center gap-2'>
        <NotebookAssistantIcon className='shrink-0' aria-hidden='true' />
        <h2 className='text-sm font-semibold'>{_('Notebook Assistant')}</h2>
      </div>
      <div className='mb-2 grid grid-cols-2 gap-2'>
        <select
          className='select select-bordered select-xs bg-base-100'
          value={contextType}
          onChange={(event) => {
            setContextType(event.target.value as 'page' | 'chapter');
            setContext(null);
            setResult('');
          }}
        >
          <option value='page'>{_('Current Page')}</option>
          <option value='chapter'>{_('Current Chapter')}</option>
        </select>
        <select
          className='select select-bordered select-xs bg-base-100'
          value={action}
          onChange={(event) => {
            setAction(event.target.value as NotebookAssistantCardAction);
            setResult('');
          }}
        >
          <option value='summary'>{_('Summary')}</option>
          <option value='insight'>{_('Key Insights')}</option>
          <option value='takeaway'>{_('Takeaways')}</option>
        </select>
      </div>
      <p className='text-base-content/60 mb-2 text-xs'>
        {context ? (
          <>
            {context.contextType === 'chapter' ? _('Current Chapter') : _('Current Page')} ·{' '}
            {context.sourceText.length} {_('characters')} · ~{estimate.input} {_('input tokens')}{' '}
            {_('max')} ~{estimate.output} {_('output tokens')}
          </>
        ) : (
          <>
            {assistantIdentity.provider} · {assistantIdentity.model}
          </>
        )}
      </p>
      {error && <p className='mb-2 text-xs text-red-500'>{error}</p>}
      {result && (
        <div className='bg-base-100 border-base-300 mb-2 max-h-64 overflow-y-auto rounded-md border p-3 text-sm leading-relaxed whitespace-pre-wrap'>
          {result}
        </div>
      )}
      <div className='flex justify-end gap-1'>
        {result && (
          <button
            type='button'
            className='btn btn-ghost btn-xs btn-square'
            onClick={() => void writeTextToClipboard(result)}
            title={_('Copy')}
            aria-label={_('Copy')}
          >
            <PiCopy />
          </button>
        )}
        {result && (
          <button type='button' className='btn btn-ghost btn-xs' onClick={save} disabled={saved}>
            {saved ? <PiCheck /> : <PiFloppyDisk />} {saved ? _('Saved') : _('Save')}
          </button>
        )}
        <button type='button' className='btn btn-primary btn-xs' onClick={run} disabled={loading}>
          {loading ? <PiSpinner className='animate-spin' /> : <PiLightbulb />}
          {result ? _('Regenerate') : _('Run')}
        </button>
      </div>
    </section>
  );
};

export default NotebookAssistantActions;
