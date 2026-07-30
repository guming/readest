import type { AISettings } from '@/services/ai/types';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { resolveAIConnection, toAIProviderSettings } from '@/services/ai/connections';
import type { AICapability } from '@/services/ai/types';
import type { NotebookAssistantSettings } from './types';

export interface NotebookAssistantIdentity {
  provider: string;
  model: string;
  source: NotebookAssistantSettings['connectionSource'];
}

export function getAITranslationTargetLanguage(
  configuredLanguage: string,
  fallbackLanguage: string,
): string {
  const requested = configuredLanguage.trim() || fallbackLanguage.trim() || 'en';
  const normalized =
    requested.toUpperCase() === requested && !requested.includes('-')
      ? requested.toLowerCase()
      : requested;
  const lower = normalized.toLowerCase();
  if (['zh', 'zh-cn', 'zh-hans'].includes(lower)) {
    return `Simplified Chinese (${normalized === 'zh' ? 'zh-CN' : normalized})`;
  }
  if (['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant'].includes(lower)) {
    return `Traditional Chinese (${normalized})`;
  }
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(normalized);
    return name ? `${name} (${normalized})` : normalized;
  } catch {
    return normalized;
  }
}

export function getNotebookAssistantIdentity(
  _assistant: NotebookAssistantSettings,
  aiSettings: AISettings | undefined,
  capability: AICapability = 'notebook',
): NotebookAssistantIdentity {
  const sourceSettings = aiSettings ?? DEFAULT_AI_SETTINGS;
  const activeSettings = toAIProviderSettings(sourceSettings, capability);
  const model =
    activeSettings.provider === 'ollama'
      ? activeSettings.ollamaModel
      : activeSettings.provider === 'ai-gateway'
        ? activeSettings.aiGatewayModel || ''
        : activeSettings.openrouterModel || '';

  return {
    provider: activeSettings.provider,
    model,
    source: 'global',
  };
}

export function isNotebookAssistantConfigured(
  assistant: NotebookAssistantSettings,
  aiSettings: AISettings | undefined,
  _legacyApiKey: string,
  capability: AICapability = 'notebook',
): boolean {
  void assistant;
  if (!aiSettings) return false;
  if (!aiSettings.enabled || !resolveAIConnection(aiSettings, capability)) return false;

  const resolved = toAIProviderSettings(aiSettings, capability);
  const identity = getNotebookAssistantIdentity(assistant, aiSettings, capability);
  if (!identity.model.trim()) return false;
  if (resolved.provider === 'ollama') return !!resolved.ollamaBaseUrl.trim();
  if (resolved.provider === 'ai-gateway') return !!resolved.aiGatewayApiKey;
  return !!resolved.openrouterBaseUrl?.trim() && !!resolved.openrouterApiKey;
}
