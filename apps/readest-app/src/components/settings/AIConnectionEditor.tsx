import { useEffect, useId, useState } from 'react';
import { PiSpinner } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { DEFAULT_AI_SETTINGS, OPENAI_COMPATIBLE_TEMPLATES } from '@/services/ai/constants';
import type { AIConnection, OpenAICompatibleTemplate } from '@/services/ai/types';
import { getAIFetch } from '@/services/ai/utils/httpFetch';

interface Props {
  connection?: AIConnection;
  onSave: (connection: AIConnection) => Promise<void>;
  onCancel: () => void;
}

export default function AIConnectionEditor({ connection, onSave, onCancel }: Props) {
  const _ = useTranslation();
  const modelListId = useId();
  const [service, setService] = useState(
    connection?.provider === 'openrouter'
      ? connection.template || 'custom'
      : connection?.provider || 'ollama',
  );
  const [name, setName] = useState(connection?.name || '');
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl || DEFAULT_AI_SETTINGS.ollamaBaseUrl);
  const [model, setModel] = useState(connection?.model || '');
  const [apiKey, setApiKey] = useState(connection?.apiKey || '');
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modelsError, setModelsError] = useState('');
  const provider = service === 'ollama' || service === 'ai-gateway' ? service : 'openrouter';

  useEffect(() => {
    if (provider !== 'ollama' || !baseUrl.trim()) return;
    const controller = new AbortController();
    let active = true;
    setFetching(false);
    setModels([]);
    setModelsError('');
    const timer = setTimeout(async () => {
      setFetching(true);
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await getAIFetch()(`${baseUrl.trim().replace(/\/+$/, '')}/api/tags`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const data: { models?: { name: string }[] } = await response.json();
        if (controller.signal.aborted) return;
        const names = data.models?.map((item) => item.name) || [];
        setModels(names);
        setModel((current) => current || names[0] || '');
        if (!names.length) setModelsError(_('No models detected'));
      } catch {
        if (active)
          setModelsError(_('Unable to load models. You can enter a model name manually.'));
      } finally {
        clearTimeout(timeout);
        if (active) setFetching(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [baseUrl, provider]);

  const changeService = (value: 'ollama' | 'ai-gateway' | OpenAICompatibleTemplate) => {
    setService(value);
    setModels([]);
    setModelsError('');
    setError('');
    setApiKey('');
    if (value === 'ollama') {
      setBaseUrl(DEFAULT_AI_SETTINGS.ollamaBaseUrl);
      setModel('');
    } else if (value === 'ai-gateway') {
      setBaseUrl('');
      setModel(DEFAULT_AI_SETTINGS.aiGatewayModel || '');
    } else {
      const defaults = OPENAI_COMPATIBLE_TEMPLATES[value as OpenAICompatibleTemplate];
      setBaseUrl(defaults.baseUrl);
      setModel(defaults.model);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...connection,
        id: connection?.id || `connection-${crypto.randomUUID()}`,
        name:
          name.trim() ||
          (service === 'ollama'
            ? 'Ollama'
            : service === 'ai-gateway'
              ? 'AI Gateway'
              : service === 'custom'
                ? _('OpenAI Compatible')
                : service === 'openai'
                  ? 'OpenAI'
                  : service === 'qwen'
                    ? 'Qwen'
                    : service === 'deepseek'
                      ? 'DeepSeek'
                      : 'OpenRouter'),
        provider,
        template: provider === 'openrouter' ? (service as OpenAICompatibleTemplate) : undefined,
        baseUrl: provider === 'ai-gateway' ? undefined : baseUrl.trim().replace(/\/+$/, ''),
        apiKey: provider === 'ollama' ? undefined : apiKey.trim(),
        model: model.trim(),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : _('Unable to save AI service. Please try again.'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void save(event)}
      className='border-base-300 eink-bordered rounded-md border p-3 text-sm'
    >
      <h3 className='mb-3 font-semibold'>
        {connection ? _('Edit AI Service') : _('Add AI Service')}
      </h3>
      <fieldset disabled={saving} className='flex min-w-0 flex-col gap-3'>
        <label className='flex flex-col gap-1'>
          {_('Service')}
          <select
            className='select select-bordered select-sm eink-bordered w-full'
            value={service}
            onChange={(event) =>
              changeService(
                event.target.value as 'ollama' | 'ai-gateway' | OpenAICompatibleTemplate,
              )
            }
          >
            <option value='ollama'>Ollama</option>
            <option value='openai'>OpenAI</option>
            <option value='deepseek'>DeepSeek</option>
            <option value='qwen'>Qwen</option>
            <option value='openrouter'>OpenRouter</option>
            <option value='custom'>{_('OpenAI Compatible')}</option>
            <option value='ai-gateway'>AI Gateway</option>
          </select>
        </label>
        {provider !== 'ai-gateway' && (
          <label className='flex flex-col gap-1'>
            {_('Server URL')}
            <input
              className='input input-bordered input-sm eink-bordered w-full'
              type='url'
              required
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
        )}
        {provider !== 'ollama' && (
          <label className='flex flex-col gap-1'>
            {_('API Key')}
            <input
              className='input input-bordered input-sm eink-bordered w-full'
              type='password'
              autoComplete='off'
              required
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
        )}
        <label className='flex flex-col gap-1'>
          <span className='flex items-center gap-2'>
            {_('Model')}
            {fetching && <PiSpinner className='animate-spin' aria-label={_('Loading models')} />}
          </span>
          <input
            className='input input-bordered input-sm eink-bordered w-full'
            required
            list={modelListId}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
          <datalist id={modelListId}>
            {models.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </label>
        {modelsError && <p className='text-base-content/60 text-xs'>{modelsError}</p>}
        <label className='flex flex-col gap-1'>
          {_('Connection Name')}{' '}
          <span className='text-base-content/60 text-xs'>{_('Optional')}</span>
          <input
            className='input input-bordered input-sm eink-bordered w-full'
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && (
          <p role='alert' className='text-error break-words text-xs'>
            {error}
          </p>
        )}
        <div className='flex flex-wrap justify-end gap-2'>
          <button type='button' className='btn btn-ghost btn-sm eink-bordered' onClick={onCancel}>
            {_('Cancel')}
          </button>
          <button
            type='submit'
            className='btn btn-primary btn-sm'
            disabled={
              !model.trim() ||
              (provider !== 'ollama' && !apiKey.trim()) ||
              (provider !== 'ai-gateway' && !baseUrl.trim())
            }
          >
            {saving && <PiSpinner className='animate-spin' />}
            {_('Save and Use')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
