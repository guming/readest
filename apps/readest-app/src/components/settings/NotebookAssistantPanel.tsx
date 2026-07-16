import React, { useEffect, useMemo, useState } from 'react';
import { MdVisibility, MdVisibilityOff } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import {
  NOTEBOOK_ASSISTANT_TEMPLATES,
  resolveNotebookAssistantSettings,
  type NotebookAssistantProvider,
  type NotebookAssistantSettings,
} from '@/services/notebook-assistant/types';
import {
  getAssistantApiKey,
  isAssistantKeySecure,
  setAssistantApiKey,
} from '@/services/notebook-assistant/secretStore';
import { testNotebookAssistantConnection } from '@/services/notebook-assistant/client';
import {
  buildNotebookAssistantDiagnostics,
  clearNotebookAssistantUsage,
  getTodayNotebookAssistantTokens,
} from '@/services/notebook-assistant/usage';
import { writeTextToClipboard } from '@/utils/clipboard';
import { BoxedList, SectionTitle, SettingsRow, Tips } from './primitives';

interface Props {
  compact?: boolean;
  onConfigured?: () => void;
}

const clampInteger = (value: number, fallback: number, min: number, max: number): number => {
  const next = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, next));
};

const NotebookAssistantPanel: React.FC<Props> = ({ compact = false, onConfigured }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const initial = resolveNotebookAssistantSettings(settings.notebookAssistant);
  const [draft, setDraft] = useState<NotebookAssistantSettings>(initial);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [usageVersion, setUsageVersion] = useState(0);

  useEffect(() => {
    void getAssistantApiKey().then(setApiKey);
  }, []);

  const patch = <K extends keyof NotebookAssistantSettings>(
    key: K,
    value: NotebookAssistantSettings[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const changeProvider = (provider: NotebookAssistantProvider) => {
    setDraft((current) => ({ ...current, provider, ...NOTEBOOK_ASSISTANT_TEMPLATES[provider] }));
    setStatus('idle');
  };

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
    await setAssistantApiKey(apiKey.trim());
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, notebookAssistant: normalized };
    setSettings(next);
    await saveSettings(envConfig, next);
    setDraft(normalized);
    onConfigured?.();
  };

  const test = async () => {
    setStatus('testing');
    setMessage('');
    try {
      await testNotebookAssistantConnection(draft, apiKey.trim());
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
      apiKeyConfigured: !!apiKey.trim(),
      secureKeyStorage: isAssistantKeySecure(),
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
        <SettingsRow label={_('Provider Template')}>
          <select
            className='select select-sm select-bordered max-w-44 bg-base-100'
            value={draft.provider}
            onChange={(event) => changeProvider(event.target.value as NotebookAssistantProvider)}
          >
            {(['openai', 'deepseek', 'qwen', 'openrouter', 'custom'] as const).map((value) => (
              <option key={value} value={value}>
                {value === 'qwen' ? 'Qwen' : value[0]!.toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow label={_('API Base URL')}>
          <input
            className={inputClass}
            value={draft.baseUrl}
            onChange={(e) => patch('baseUrl', e.target.value)}
            placeholder='https://api.openai.com/v1'
          />
        </SettingsRow>
        <SettingsRow label={_('API Key')}>
          <div className='flex w-full max-w-xs items-center gap-1'>
            <input
              className={inputClass}
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete='off'
            />
            <button
              type='button'
              className='btn btn-ghost btn-sm btn-square'
              onClick={() => setShowKey((value) => !value)}
              aria-label={showKey ? _('Hide API key') : _('Show API key')}
            >
              {showKey ? <MdVisibilityOff /> : <MdVisibility />}
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label={_('Model')}>
          <input
            className={inputClass}
            value={draft.model}
            onChange={(e) => patch('model', e.target.value)}
            placeholder='gpt-4o-mini'
          />
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
      <Tips>
        {isAssistantKeySecure()
          ? _('Your API key is stored only on this device in the system keychain.')
          : _(
              'Your API key is stored only in this browser. Browser storage is less secure than a system keychain.',
            )}{' '}
        {_('Selected text is sent directly to your configured AI provider.')}
        {!apiKey.trim() && settings.notebookAssistant && (
          <> {_('This device needs its own API key.')}</>
        )}
      </Tips>
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
          disabled={status === 'testing' || !apiKey || !draft.baseUrl}
          onClick={test}
        >
          {status === 'testing' ? _('Testing...') : _('Test Connection')}
        </button>
        <button
          type='button'
          className='btn btn-primary btn-sm'
          disabled={!apiKey || !draft.baseUrl || !draft.model}
          onClick={save}
        >
          {_('Save')}
        </button>
      </div>
    </div>
  );
};

export default NotebookAssistantPanel;
