import React, { useEffect, useMemo, useState } from 'react';
import { PiCheck, PiCopy, PiFloppyDisk, PiPlay, PiSpinner } from 'react-icons/pi';
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
  type SelectedTextAction,
} from '@/services/notebook-assistant/types';

interface Props {
  action: SelectedTextAction;
  bookKey: string;
  selection: TextSelection;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
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
  onDismiss,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const { getConfig, setConfig, saveConfig } = useBookDataStore();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const assistant = resolveNotebookAssistantSettings(settings.notebookAssistant);
  const targetLanguage = assistant.targetLanguage || navigator.language || 'English';
  const estimate = useMemo(
    () => estimateSelectedTextTokens(selection.text, action),
    [selection.text, action],
  );

  useEffect(() => {
    void getAssistantApiKey().then(setApiKey);
  }, []);

  const configured = !!apiKey && !!assistant.baseUrl && !!assistant.model;
  const run = async () => {
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
    setError('');
    setSaved(false);
    try {
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
      selectionCfi: selection.cfi,
      type: action,
      title: action === 'translation' ? _('AI Translation') : _('Explanation'),
      sourceText: selection.text,
      content: result,
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
      minHeight={popupHeight}
      maxHeight={Math.min(680, window.innerHeight - 20)}
      position={position}
      className='bg-base-100 text-base-content flex h-full flex-col overflow-y-auto p-4 font-sans'
      triangleClassName='text-base-100'
      onDismiss={onDismiss}
    >
      <div className='mb-3 flex items-start justify-between gap-3'>
        <div>
          <h2 className='text-base font-semibold'>
            {action === 'translation' ? _('AI Translate') : _('Explain')}
          </h2>
          <p className='text-base-content/60 text-xs'>
            {_('Selection')} · {selection.text.length} {_('characters')} · ~{estimate.input}{' '}
            {_('input tokens')} · {_('max')} ~{estimate.output} {_('output tokens')}
          </p>
          <p className='text-base-content/60 text-xs'>
            {assistant.provider} · {assistant.model}
          </p>
        </div>
      </div>

      {apiKey === null ? (
        <div className='flex min-h-32 items-center justify-center'>
          <PiSpinner className='animate-spin' />
        </div>
      ) : !configured ? (
        <NotebookAssistantPanel
          compact
          onConfigured={() => void getAssistantApiKey().then(setApiKey)}
        />
      ) : (
        <>
          <div className='bg-base-200/50 mb-3 max-h-28 overflow-y-auto rounded-md p-3 text-sm'>
            {selection.text}
          </div>
          {error && <p className='mb-3 text-sm text-red-500'>{error}</p>}
          {result && (
            <div className='border-base-300 mb-3 whitespace-pre-wrap border-t pt-3 text-sm leading-relaxed'>
              {result}
            </div>
          )}
          <div className='mt-auto flex justify-end gap-1'>
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
                className='btn btn-ghost btn-sm'
                onClick={save}
                disabled={saved}
              >
                {saved ? <PiCheck /> : <PiFloppyDisk />}{' '}
                {saved ? _('Saved') : _('Save to Notebook')}
              </button>
            )}
            <button
              type='button'
              className='btn btn-primary btn-sm'
              onClick={run}
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
