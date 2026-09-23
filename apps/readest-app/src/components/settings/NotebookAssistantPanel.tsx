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
import { TRANSLATOR_LANGS } from '@/services/constants';
import {
  BoxedList,
  SettingsInput,
  SettingsRow,
  SettingsSelect,
  SettingsSwitchRow,
  Tips,
} from './primitives';

interface Props {
  compact?: boolean;
}

const clampInteger = (value: number, fallback: number, min: number, max: number): number => {
  const next = Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, next));
};

const normalizeTargetLanguage = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) return '';
  if (Object.keys(TRANSLATOR_LANGS).includes(normalized)) return normalized;

  const match = Object.entries(TRANSLATOR_LANGS).find(
    ([, label]) => label.toLocaleLowerCase() === normalized.toLocaleLowerCase(),
  );
  return match?.[0] ?? normalized;
};

const getTargetLanguageOptions = (translate: (key: string) => string, currentValue: string) => {
  const options = Object.entries(TRANSLATOR_LANGS)
    .sort(([, first], [, second]) => first.localeCompare(second))
    .map(([value, label]) => ({ value, label }));

  if (currentValue && !options.some((option) => option.value === currentValue)) {
    options.unshift({ value: currentValue, label: currentValue });
  }

  return [{ value: '', label: translate('System Language') }, ...options];
};

const NotebookAssistantPanel: React.FC<Props> = ({ compact = false }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings, setActiveSettingsItemId } = useSettingsStore();
  const initial = resolveNotebookAssistantSettings(settings.notebookAssistant);
  const [draft, setDraft] = useState<NotebookAssistantSettings>(() => ({
    ...initial,
    targetLanguage: normalizeTargetLanguage(initial.targetLanguage),
  }));
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

  const todayTokens = useMemo(() => getTodayNotebookAssistantTokens(), [usageVersion]);
  const targetLanguageOptions = getTargetLanguageOptions(_, draft.targetLanguage);
  return (
    <div className={compact ? 'space-y-3' : 'my-4 space-y-5'}>
      <BoxedList title={_('AI Provider')} data-setting-id='settings.notebookassistant.provider'>
        <SettingsRow label={_('Active Provider')}>
          {connections.length > 0 ? (
            <SettingsSelect
              value={resolveAIConnection(settings.aiSettings, 'notebook')?.id || ''}
              onChange={(event) => void selectNotebookConnection(event.target.value)}
              ariaLabel={_('Active Provider')}
              options={connections.map((connection) => ({
                value: connection.id,
                label: `${connection.name} · ${connection.model}`,
              }))}
            />
          ) : (
            <button
              type='button'
              className='btn btn-ghost btn-sm'
              onClick={() => setActiveSettingsItemId('settings.ai.provider')}
            >
              {_('Configure AI Provider')}
            </button>
          )}
        </SettingsRow>
        <SettingsRow
          label={_('Target Language')}
          description={_('Use the interface language unless you choose another language.')}
          data-setting-id='settings.notebookassistant.targetLanguage'
        >
          <SettingsSelect
            value={draft.targetLanguage}
            onChange={(event) => patch('targetLanguage', event.target.value)}
            ariaLabel={_('Target Language')}
            options={targetLanguageOptions}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Output')} data-setting-id='settings.notebookassistant.output'>
        <SettingsRow label={_('Summary Style')}>
          <SettingsSelect
            value={draft.defaultSummaryStyle}
            onChange={(e) =>
              patch(
                'defaultSummaryStyle',
                e.target.value as NotebookAssistantSettings['defaultSummaryStyle'],
              )
            }
            ariaLabel={_('Summary Style')}
            options={[
              { value: 'structured', label: _('Structured') },
              { value: 'brief', label: _('Brief') },
              { value: 'detailed', label: _('Detailed') },
            ]}
          />
        </SettingsRow>
        <SettingsRow label={_('Quiz Questions')}>
          <SettingsInput
            type='number'
            min={1}
            max={20}
            value={draft.defaultQuizQuestionCount}
            onChange={(e) => patch('defaultQuizQuestionCount', Number(e.target.value))}
            aria-label={_('Quiz Questions')}
          />
        </SettingsRow>
        <SettingsRow label={_('Cost Mode')}>
          <SettingsSelect
            value={draft.costMode}
            onChange={(e) =>
              patch('costMode', e.target.value as NotebookAssistantSettings['costMode'])
            }
            ariaLabel={_('Cost Mode')}
            options={[
              { value: 'conservative', label: _('Conservative') },
              { value: 'balanced', label: _('Balanced') },
              { value: 'full_context', label: _('Full Context') },
            ]}
          />
        </SettingsRow>
      </BoxedList>

      <BoxedList title={_('Usage')} data-setting-id='settings.notebookassistant.usage'>
        <SettingsRow label={_('Daily Token Limit')}>
          <SettingsInput
            type='number'
            min={0}
            max={5000000}
            step={1000}
            value={draft.dailyTokenLimit}
            onChange={(e) => patch('dailyTokenLimit', Number(e.target.value))}
            aria-label={_('Daily Token Limit')}
          />
        </SettingsRow>
        <SettingsSwitchRow
          label={_('Track Local Usage')}
          checked={draft.usageTrackingEnabled}
          onChange={() => patch('usageTrackingEnabled', !draft.usageTrackingEnabled)}
        />
        <SettingsRow label={_('Warn Above Tokens')}>
          <SettingsInput
            type='number'
            min={1000}
            max={200000}
            step={1000}
            value={draft.warnAboveTokens}
            onChange={(e) => patch('warnAboveTokens', Number(e.target.value))}
            aria-label={_('Warn Above Tokens')}
          />
        </SettingsRow>
      </BoxedList>

      <Tips>
        <li>
          {_('Today estimated usage')}: ~{todayTokens} {_('tokens')}.
        </li>
        <li>
          {_(
            'Usage history is stored only on this device and never includes source text or AI responses.',
          )}
        </li>
        <li>{_('Notebook Assistant uses the active provider from the global AI settings.')}</li>
      </Tips>
      {message && (
        <p
          role='status'
          className={status === 'error' ? 'text-sm text-red-500' : 'text-sm text-green-600'}
        >
          {message}
        </p>
      )}
      <div className='flex flex-wrap justify-end gap-2'>
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
