import React, { useMemo, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import {
  resolveNotebookAssistantSettings,
  type NotebookAssistantSettings,
} from '@/services/notebook-assistant/types';
import { isNotebookAssistantConfigured } from '@/services/notebook-assistant/provider';
import { testNotebookAssistantConnection } from '@/services/notebook-assistant/client';
import {
  buildNotebookAssistantDiagnostics,
  clearNotebookAssistantUsage,
  getTodayNotebookAssistantTokens,
} from '@/services/notebook-assistant/usage';
import { writeTextToClipboard } from '@/utils/clipboard';
import { getAIConnections, resolveAIConnection } from '@/services/ai/connections';
import { BoxedList, SectionTitle, SettingsRow, Tips } from './primitives';

interface Props {
  compact?: boolean;
}

const clampInteger = (value: number, fallback: number, min: number, max: number): number => {
  const next = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, next));
};

const NotebookAssistantPanel: React.FC<Props> = ({ compact = false }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings, setActiveSettingsItemId } = useSettingsStore();
  const initial = resolveNotebookAssistantSettings(settings.notebookAssistant);
  const [draft, setDraft] = useState<NotebookAssistantSettings>(initial);
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [usageVersion, setUsageVersion] = useState(0);
  const connections = getAIConnections(settings.aiSettings);
  const configured = isNotebookAssistantConfigured(draft, settings.aiSettings, '');

  const selectNotebookConnection = async (connectionId: string) => {
    const latest = useSettingsStore.getState().settings;
    const next = {
      ...latest,
      aiSettings: { ...latest.aiSettings, notebookConnectionId: connectionId },
    };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const patch = <K extends keyof NotebookAssistantSettings>(
    key: K,
    value: NotebookAssistantSettings[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const normalized = {
      ...draft,
      baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
      model: draft.model.trim(),
      warnAboveTokens: clampInteger(draft.warnAboveTokens, initial.warnAboveTokens, 1_000, 200_000),
      dailyTokenLimit: clampInteger(draft.dailyTokenLimit, initial.dailyTokenLimit, 0, 5_000_000),
      defaultQuizQuestionCount: clampInteger(
        draft.defaultQuizQuestionCount,
        initial.defaultQuizQuestionCount,
        1,
        20,
      ),
    };
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, notebookAssistant: normalized };
    setSettings(next);
    await saveSettings(envConfig, next);
    setDraft(normalized);
  };

  const test = async () => {
    setStatus('testing');
    setMessage('');
    try {
      await testNotebookAssistantConnection(draft, '', settings.aiSettings);
      setStatus('success');
      setMessage(_('Connection successful'));
    } catch (error) {
      setStatus('error');
      setMessage((error as Error).message);
    }
  };

  const copyDiagnostics = async () => {
    const diagnostics = buildNotebookAssistantDiagnostics({
      settings: normalizedDraft(),
      apiKeyConfigured: configured,
      secureKeyStorage: false,
      platform: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent || 'unknown',
      lastError: status === 'error' ? message : undefined,
    });
    await writeTextToClipboard(JSON.stringify(diagnostics, null, 2));
    setMessage(_('Diagnostics copied'));
    setStatus('success');
  };

  const normalizedDraft = (): NotebookAssistantSettings => ({
    ...draft,
    baseUrl: draft.baseUrl.trim().replace(/\/+$/, ''),
    model: draft.model.trim(),
    warnAboveTokens: clampInteger(draft.warnAboveTokens, initial.warnAboveTokens, 1_000, 200_000),
    dailyTokenLimit: clampInteger(draft.dailyTokenLimit, initial.dailyTokenLimit, 0, 5_000_000),
    defaultQuizQuestionCount: clampInteger(
      draft.defaultQuizQuestionCount,
      initial.defaultQuizQuestionCount,
      1,
      20,
    ),
  });

  const inputClass = 'input input-sm input-bordered w-full max-w-xs bg-base-100';
  const todayTokens = useMemo(() => getTodayNotebookAssistantTokens(), [usageVersion]);
  return (
    <div className={compact ? 'space-y-3' : 'my-4 space-y-5'}>
      {!compact && <SectionTitle>{_('AI Provider')}</SectionTitle>}
      <BoxedList>
        <SettingsRow label={_('Active Provider')}>
          {connections.length > 0 ? (
            <select
              className='select select-bordered select-sm eink-bordered bg-base-100'
              value={resolveAIConnection(settings.aiSettings, 'notebook')?.id || ''}
              onChange={(event) => void selectNotebookConnection(event.target.value)}
            >
              {connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name} · {connection.model}
                </option>
              ))}
            </select>
          ) : (
            <button
              type='button'
              className='btn btn-outline btn-sm eink-bordered'
              onClick={() => setActiveSettingsItemId('settings.ai.provider')}
            >
              {_('Configure AI Provider')}
            </button>
          )}
        </SettingsRow>
        <SettingsRow label={_('Target Language')}>
          <input
            className={inputClass}
            value={draft.targetLanguage}
            onChange={(e) => patch('targetLanguage', e.target.value)}
            placeholder={_('System Language')}
          />
        </SettingsRow>
        <SettingsRow label={_('Summary Style')}>
          <select
            className='select select-sm select-bordered max-w-xs bg-base-100'
            value={draft.defaultSummaryStyle}
            onChange={(e) =>
              patch(
                'defaultSummaryStyle',
                e.target.value as NotebookAssistantSettings['defaultSummaryStyle'],
              )
            }
          >
            <option value='structured'>{_('Structured')}</option>
            <option value='brief'>{_('Brief')}</option>
            <option value='detailed'>{_('Detailed')}</option>
          </select>
        </SettingsRow>
        <SettingsRow label={_('Quiz Questions')}>
          <input
            className={inputClass}
            type='number'
            min={1}
            max={20}
            value={draft.defaultQuizQuestionCount}
            onChange={(e) => patch('defaultQuizQuestionCount', Number(e.target.value))}
          />
        </SettingsRow>
        <SettingsRow label={_('Cost Mode')}>
          <select
            className='select select-sm select-bordered max-w-xs bg-base-100'
            value={draft.costMode}
            onChange={(e) =>
              patch('costMode', e.target.value as NotebookAssistantSettings['costMode'])
            }
          >
            <option value='conservative'>{_('Conservative')}</option>
            <option value='balanced'>{_('Balanced')}</option>
            <option value='full_context'>{_('Full Context')}</option>
          </select>
        </SettingsRow>
        <SettingsRow label={_('Daily Token Limit')}>
          <input
            className={inputClass}
            type='number'
            min={0}
            max={5000000}
            step={1000}
            value={draft.dailyTokenLimit}
            onChange={(e) => patch('dailyTokenLimit', Number(e.target.value))}
          />
        </SettingsRow>
        <SettingsRow label={_('Track Local Usage')}>
          <input
            type='checkbox'
            className='toggle'
            checked={draft.usageTrackingEnabled}
            onChange={(e) => patch('usageTrackingEnabled', e.target.checked)}
          />
        </SettingsRow>
        <SettingsRow label={_('Warn Above Tokens')}>
          <input
            className={inputClass}
            type='number'
            min={1000}
            max={200000}
            step={1000}
            value={draft.warnAboveTokens}
            onChange={(e) => patch('warnAboveTokens', Number(e.target.value))}
          />
        </SettingsRow>
      </BoxedList>
      <Tips>
        {_('Today estimated usage')}: ~{todayTokens} {_('tokens')}.{' '}
        {_(
          'Usage history is stored only on this device and never includes source text or AI responses.',
        )}
      </Tips>
      <Tips>{_('Notebook Assistant uses the active provider from the global AI settings.')}</Tips>
      {message && (
        <p className={status === 'error' ? 'text-sm text-red-500' : 'text-sm text-green-600'}>
          {message}
        </p>
      )}
      <div className='flex justify-end gap-2'>
        <button
          type='button'
          className='btn btn-ghost btn-sm'
          onClick={() => {
            clearNotebookAssistantUsage();
            setUsageVersion((value) => value + 1);
          }}
        >
          {_('Clear Usage')}
        </button>
        <button type='button' className='btn btn-ghost btn-sm' onClick={copyDiagnostics}>
          {_('Copy Diagnostics')}
        </button>
        <button
          type='button'
          className='btn btn-ghost btn-sm'
          disabled={status === 'testing' || !configured}
          onClick={test}
        >
          {status === 'testing' ? _('Testing...') : _('Test Connection')}
        </button>
        <button type='button' className='btn btn-primary btn-sm' onClick={save}>
          {_('Save')}
        </button>
      </div>
    </div>
  );
};

export default NotebookAssistantPanel;
