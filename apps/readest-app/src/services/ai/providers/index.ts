import { OllamaProvider } from './OllamaProvider';
import { AIGatewayProvider } from './AIGatewayProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import type { AICapability, AIProvider, AISettings } from '../types';
import { toAIProviderSettings } from '../connections';

export { OllamaProvider, AIGatewayProvider, OpenRouterProvider };

export function getAIProvider(
  settings: AISettings,
  capability: AICapability = 'default',
): AIProvider {
  const resolved = toAIProviderSettings(settings, capability);
  switch (resolved.provider) {
    case 'ollama':
      return new OllamaProvider(resolved);
    case 'ai-gateway':
      if (!resolved.aiGatewayApiKey) {
        throw new Error('API key required for AI Gateway');
      }
      return new AIGatewayProvider(resolved);
    case 'openrouter':
      if (!resolved.openrouterApiKey) {
        throw new Error('API key required for OpenRouter');
      }
      return new OpenRouterProvider(resolved);
    default:
      throw new Error(`Unknown provider: ${resolved.provider}`);
  }
}
