import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PiArrowClockwise, PiCheck, PiCopy, PiFloppyDisk, PiPlay, PiSpinner } from 'react-icons/pi';
import Popup from '@/components/Popup';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { NotebookCard } from '@/types/book';
import type { Position, TextSelection } from '@/utils/sel';
import { uniqueId } from '@/utils/misc';
import { writeTextToClipboard } from '@/utils/clipboard';
import NotebookAssistantPanel from '@/components/settings/NotebookAssistantPanel';
import {
  appendFollowUpExplanation,
  NotebookAssistantError,
  estimateSelectedTextTokens,
  runSelectedTextAssistant,
} from '@/services/notebook-assistant/client';
import { getAssistantApiKey } from '@/services/notebook-assistant/secretStore';
import {
  evaluateUsageLimit,
  recordNotebookAssistantUsage,
} from '@/services/notebook-assistant/usage';
import {
  resolveNotebookAssistantSettings,
  type ExplanationFollowUp,
  type ExpertExplanationResult,
  type SelectedTextAction,
} from '@/services/notebook-assistant/types';
import { buildSelectionContext } from '@/services/notebook-assistant/context';

interface Props {
  action: SelectedTextAction;
  bookKey: string;
  selection: TextSelection;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  bookTitle: string;
  bookAuthor: string;
  chapterId?: string;
  chapterTitle?: string;
  sourceLanguage?: string;
  onDismiss: () => void;
}

const SelectedTextAssistantPopup: React.FC<Props> = ({
  action,
  bookKey,
  selection,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  bookTitle,
  bookAuthor,
  chapterId,
  chapterTitle,
  sourceLanguage,
  onDismiss,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const { getConfig, setConfig, saveConfig } = useBookDataStore();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [explanationResult, setExplanationResult] = useState<ExpertExplanationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [activeFollowUpId, setActiveFollowUpId] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollAfterUpdateRef = useRef(false);
  const assistant = resolveNotebookAssistantSettings(settings.notebookAssistant);
  const targetLanguage = assistant.targetLanguage || navigator.language || 'English';
  const expertProfile = getConfig(bookKey)?.expertProfile;
  const surroundingContext = useMemo(
    () => buildSelectionContext(selection.range),
    [selection.range],
  );
  const estimateContext = useMemo(
    () =>
      action === 'explanation'
        ? JSON.stringify({ expertProfile, surroundingContext, bookTitle, bookAuthor, chapterTitle })
        : '',
    [action, bookAuthor, bookTitle, chapterTitle, expertProfile, surroundingContext],
  );
  const estimate = useMemo(
    () => estimateSelectedTextTokens(selection.text, action, estimateContext),
    [selection.text, action, estimateContext],
  );

  useEffect(() => {
    void getAssistantApiKey().then(setApiKey);
  }, []);

  useEffect(() => {
    if (!scrollAfterUpdateRef.current) return;
    scrollAfterUpdateRef.current = false;
    requestAnimationFrame(() => {
      contentRef.current?.scrollTo({ top: contentRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [result]);

  const configured = !!apiKey && !!assistant.baseUrl && !!assistant.model;
  const run = async (options?: { followUp?: ExplanationFollowUp; rebuildProfile?: boolean }) => {
    if (!apiKey) return;
    if (estimate.input > assistant.warnAboveTokens) {
      const accepted = window.confirm(
        _('This selection is long and may cost more than usual. Continue?'),
      );
      if (!accepted) return;
    }
    const limit = evaluateUsageLimit(assistant, estimate);
    if (!limit.allowed) {
      setError(
        _(
          'Daily token limit reached. Adjust the limit or cost mode in Notebook Assistant settings.',
        ),
      );
      return;
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
    setLoading(true);
    setActiveFollowUpId(options?.followUp?.id ?? null);
    setError('');
    setSaved(false);
    try {
      if (action === 'translation') {
        const content = await runSelectedTextAssistant(
          {
            action,
            sourceText: selection.text,
            targetLanguage,
            provider: assistant.provider,
            model: assistant.model,
          },
          assistant,
          apiKey,
        );
        setResult(content);
      } else {
        const content = await runSelectedTextAssistant(
          {
            action,
            sourceText: selection.text,
            sourceLanguage,
            targetLanguage,
            provider: assistant.provider,
            model: assistant.model,
            bookTitle,
            bookAuthor,
            chapterId,
            chapterTitle,
            surroundingContext,
            expertProfile: options?.rebuildProfile ? undefined : expertProfile,
            rebuildExpertProfile: options?.rebuildProfile,
            followUp: options?.followUp,
            previousExplanation: options?.followUp ? result : undefined,
          },
          assistant,
          apiKey,
        );
        setExplanationResult(content);
        if (options?.followUp) {
          scrollAfterUpdateRef.current = true;
          const followUp = options.followUp;
          setResult((previous) =>
            appendFollowUpExplanation(previous, followUp, content.explanation),
          );
        } else {
          setResult(content.explanation);
        }
        if (content.expertProfile) {
          const config = getConfig(bookKey);
          if (config) {
            const nextProfile = {
              ...content.expertProfile,
              revision: options?.rebuildProfile
                ? Math.max((expertProfile?.revision ?? 0) + 1, content.expertProfile.revision)
                : content.expertProfile.revision,
            };
            const next = { ...config, expertProfile: nextProfile, updatedAt: Date.now() };
            setConfig(bookKey, next);
            await saveConfig(envConfig, bookKey, next, settings);
          }
        }
      }
      if (assistant.usageTrackingEnabled) {
        recordNotebookAssistantUsage({
          action,
          contextType: 'selection',
          provider: assistant.provider,
          model: assistant.model,
          tokenEstimate: estimate,
          success: true,
          bookId: bookKey.split('-')[0],
        });
      }
    } catch (requestError) {
      setError((requestError as Error).message);
      if (assistant.usageTrackingEnabled) {
        recordNotebookAssistantUsage({
          action,
          contextType: 'selection',
          provider: assistant.provider,
          model: assistant.model,
          tokenEstimate: estimate,
          success: false,
          errorCode: requestError instanceof NotebookAssistantError ? requestError.code : 'unknown',
          bookId: bookKey.split('-')[0],
        });
      }
    } finally {
      setLoading(false);
      setActiveFollowUpId(null);
    }
  };

  const save = async () => {
    if (!result || saved) return;
    const config = getConfig(bookKey);
    if (!config) return;
    const now = Date.now();
    const card: NotebookCard = {
      id: uniqueId(),
      bookId: bookKey.split('-')[0]!,
      chapterId: selection.href || String(selection.index),
      chapterTitle,
      selectionCfi: selection.cfi,
      type: action,
      title: action === 'translation' ? _('AI Translation') : _('Explanation'),
      sourceText: selection.text,
      content:
        action === 'explanation' && explanationResult
          ? `${explanationResult.label}\n\n${result}`
          : result,
      contextType: 'selection',
      targetLanguage,
      provider: assistant.provider,
      model: assistant.model,
      tokenEstimate: estimate,
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

  return (
    <Popup
      trianglePosition={trianglePosition}
      width={popupWidth}
      height={Math.max(popupHeight, Math.min(680, window.innerHeight - 20))}
      maxHeight={Math.min(680, window.innerHeight - 20)}
      position={position}
      className='bg-base-100 text-base-content flex flex-col overflow-hidden font-sans'
      triangleClassName='text-base-100'
      onDismiss={onDismiss}
    >
      <div className='shrink-0 px-4 pt-4 pb-3 flex items-start justify-between gap-3'>
        <div>
          <h2 className='text-base font-semibold'>
            {action === 'translation' ? _('AI Translate') : _('Explain')}
          </h2>
          {action === 'explanation' && explanationResult && (
            <p className='text-base-content/70 mt-1 text-xs font-medium'>
              {explanationResult.label}
            </p>
          )}
          <p className='text-base-content/60 text-xs'>
            {_('Selection')} · {selection.text.length} {_('characters')} · ~{estimate.input}{' '}
            {_('input tokens')} · {_('max')} ~{estimate.output} {_('output tokens')}
          </p>
          <p className='text-base-content/60 text-xs'>
            {assistant.provider} · {assistant.model}
          </p>
        </div>
        {action === 'explanation' && configured && expertProfile && (
          <button
            type='button'
            className='btn btn-ghost btn-sm btn-square eink-bordered shrink-0'
            onClick={() => void run({ rebuildProfile: true })}
            disabled={loading}
            title={_('Re-identify the field of this book')}
            aria-label={_('Re-identify book field')}
          >
            <PiArrowClockwise />
          </button>
        )}
      </div>

      {apiKey === null ? (
        <div className='flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 pb-4'>
          <PiSpinner className='animate-spin' />
        </div>
      ) : !configured ? (
        <div className='min-h-0 flex-1 overflow-y-auto px-4 pb-4'>
          <NotebookAssistantPanel
            compact
            onConfigured={() => void getAssistantApiKey().then(setApiKey)}
          />
        </div>
      ) : (
        <>
          <div ref={contentRef} className='min-h-0 flex-1 overflow-y-auto px-4'>
            <div className='bg-base-200/50 mb-3 line-clamp-2 rounded-md p-3 text-sm'>
              {selection.text}
            </div>
            {error && <p className='mb-3 text-sm text-red-500'>{error}</p>}
            {result && (
              <div className='border-base-300 mb-3 whitespace-pre-wrap border-t pt-3 text-sm leading-relaxed'>
                {result}
              </div>
            )}
            {action === 'explanation' && explanationResult?.followUps.length ? (
              <div className='mb-3 flex flex-col gap-1.5'>
                {explanationResult.followUps.map((followUp) => (
                  <button
                    key={followUp.id}
                    type='button'
                    className='border-base-300 hover:bg-base-200 eink-bordered w-full rounded-md border px-3 py-2 text-start text-sm leading-snug font-normal transition-colors'
                    disabled={loading}
                    onClick={() => void run({ followUp })}
                  >
                    {activeFollowUpId === followUp.id && (
                      <PiSpinner className='mr-2 inline-block shrink-0 animate-spin' />
                    )}
                    {followUp.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className='border-base-300 shrink-0 border-t px-4 py-3 flex flex-wrap items-center justify-end gap-1'>
            {result && (
              <button
                type='button'
                className='btn btn-ghost btn-sm btn-square'
                onClick={() => void writeTextToClipboard(result)}
                title={_('Copy')}
                aria-label={_('Copy')}
              >
                <PiCopy />
              </button>
            )}
            {result && (
              <button
                type='button'
                className='btn btn-ghost btn-sm whitespace-nowrap'
                onClick={save}
                disabled={saved}
              >
                {saved ? <PiCheck /> : <PiFloppyDisk />}{' '}
                {saved ? _('Saved') : _('Save to Notebook')}
              </button>
            )}
            <button
              type='button'
              className='btn btn-primary btn-sm whitespace-nowrap'
              onClick={() => void run()}
              disabled={loading}
            >
              {loading ? <PiSpinner className='animate-spin' /> : <PiPlay />}{' '}
              {result ? _('Regenerate') : _('Run')}
            </button>
          </div>
        </>
      )}
    </Popup>
  );
};

export default SelectedTextAssistantPopup;
