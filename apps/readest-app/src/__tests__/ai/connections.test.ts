import { describe, expect, test } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import {
  getConfiguredAIProviders,
  resolveAIConnection,
  toAIProviderSettings,
} from '@/services/ai/connections';

describe('configured AI providers', () => {
  test('lists every configured provider and marks the active one as default', () => {
    const providers = getConfiguredAIProviders({
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ollama',
      ollamaModel: 'gemma4:e4b',
      aiGatewayApiKey: 'gateway-key',
      aiGatewayModel: 'openai/gpt-5-nano',
      openrouterApiKey: 'compatible-key',
      openrouterBaseUrl: 'https://api.deepseek.com/v1',
      openrouterModel: 'deepseek-chat',
    });

    expect(providers).toEqual([
      { provider: 'ollama', model: 'gemma4:e4b', isDefault: true },
      { provider: 'ai-gateway', model: 'openai/gpt-5-nano', isDefault: false },
      { provider: 'openrouter', model: 'deepseek-chat', isDefault: false },
    ]);
  });

  test('omits cloud providers without credentials', () => {
    expect(
      getConfiguredAIProviders({
        ...DEFAULT_AI_SETTINGS,
        enabled: true,
        provider: 'ollama',
      }),
    ).toEqual([{ provider: 'ollama', model: 'llama3.2', isDefault: true }]);
  });

  test('resolves different saved connections for translation and notebook', () => {
    const settings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      connections: [
        {
          id: 'local',
          name: 'Local Gemma',
          provider: 'ollama' as const,
          baseUrl: 'http://127.0.0.1:11434',
          model: 'gemma4:e4b',
        },
        {
          id: 'deepseek',
          name: 'DeepSeek',
          provider: 'openrouter' as const,
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'secret',
          model: 'deepseek-chat',
        },
      ],
      defaultConnectionId: 'local',
      translationConnectionId: 'local',
      notebookConnectionId: 'deepseek',
    };

    expect(resolveAIConnection(settings, 'translation')?.id).toBe('local');
    expect(resolveAIConnection(settings, 'notebook')?.id).toBe('deepseek');
    expect(toAIProviderSettings(settings, 'notebook')).toMatchObject({
      provider: 'openrouter',
      openrouterBaseUrl: 'https://api.deepseek.com/v1',
      openrouterApiKey: 'secret',
      openrouterModel: 'deepseek-chat',
    });
  });
});
