import type { AICapability, AIConnection, AIProviderName, AISettings } from './types';

export interface ConfiguredAIProvider {
  provider: AIProviderName;
  model: string;
  isDefault: boolean;
}

export function getAIConnections(settings: AISettings): AIConnection[] {
  if (Array.isArray(settings.connections)) return settings.connections;
  const connections: AIConnection[] = [];
  if (settings.ollamaBaseUrl.trim() && settings.ollamaModel.trim()) {
    connections.push({
      id: 'legacy-ollama',
      name: 'Ollama',
      provider: 'ollama',
      baseUrl: settings.ollamaBaseUrl,
      model: settings.ollamaModel,
      embeddingModel: settings.ollamaEmbeddingModel,
    });
  }
  if (settings.aiGatewayApiKey && settings.aiGatewayModel) {
    connections.push({
      id: 'legacy-ai-gateway',
      name: 'AI Gateway',
      provider: 'ai-gateway',
      apiKey: settings.aiGatewayApiKey,
      model: settings.aiGatewayModel,
      embeddingModel: settings.aiGatewayEmbeddingModel,
    });
  }
  if (
    settings.openrouterApiKey &&
    settings.openrouterBaseUrl?.trim() &&
    settings.openrouterModel?.trim()
  ) {
    connections.push({
      id: 'legacy-openrouter',
      name: 'OpenAI Compatible',
      provider: 'openrouter',
      template: settings.openrouterTemplate,
      baseUrl: settings.openrouterBaseUrl,
      apiKey: settings.openrouterApiKey,
      model: settings.openrouterModel,
      embeddingModel: settings.openrouterEmbeddingModel,
    });
  }
  return connections;
}

export function resolveAIConnection(
  settings: AISettings,
  capability: AICapability = 'default',
): AIConnection | undefined {
  const connections = getAIConnections(settings);
  const requestedId =
    capability === 'translation'
      ? settings.translationConnectionId
      : capability === 'notebook'
        ? settings.notebookConnectionId
        : settings.defaultConnectionId;
  if (requestedId) {
    const selected = connections.find((connection) => connection.id === requestedId);
    if (selected) return selected;
  }
  const legacyId = `legacy-${settings.provider}`;
  return (
    connections.find((connection) => connection.id === settings.defaultConnectionId) ||
    connections.find((connection) => connection.id === legacyId) ||
    connections.find((connection) => connection.provider === settings.provider) ||
    connections[0]
  );
}

export function toAIProviderSettings(
  settings: AISettings,
  capability: AICapability = 'default',
): AISettings {
  if (!Array.isArray(settings.connections)) return settings;
  const connection = resolveAIConnection(settings, capability);
  if (!connection) return settings;
  if (connection.provider === 'ollama') {
    return {
      ...settings,
      provider: 'ollama',
      ollamaBaseUrl: connection.baseUrl || settings.ollamaBaseUrl,
      ollamaModel: connection.model,
      ollamaEmbeddingModel: connection.embeddingModel || settings.ollamaEmbeddingModel,
    };
  }
  if (connection.provider === 'ai-gateway') {
    return {
      ...settings,
      provider: 'ai-gateway',
      aiGatewayApiKey: connection.apiKey,
      aiGatewayModel: connection.model,
      aiGatewayEmbeddingModel: connection.embeddingModel,
    };
  }
  return {
    ...settings,
    provider: 'openrouter',
    openrouterTemplate: connection.template,
    openrouterBaseUrl: connection.baseUrl,
    openrouterApiKey: connection.apiKey,
    openrouterModel: connection.model,
    openrouterEmbeddingModel: connection.embeddingModel,
  };
}

export function getConfiguredAIProviders(settings: AISettings): ConfiguredAIProvider[] {
  if (!settings.enabled) return [];

  if (settings.connections?.length) {
    return settings.connections.map((connection) => ({
      provider: connection.provider,
      model: connection.model,
      isDefault: connection.id === settings.defaultConnectionId,
    }));
  }

  const providers: ConfiguredAIProvider[] = [];
  if (settings.ollamaBaseUrl.trim() && settings.ollamaModel.trim()) {
    providers.push({
      provider: 'ollama',
      model: settings.ollamaModel.trim(),
      isDefault: settings.provider === 'ollama',
    });
  }
  if (settings.aiGatewayApiKey && settings.aiGatewayModel) {
    providers.push({
      provider: 'ai-gateway',
      model: settings.aiGatewayModel,
      isDefault: settings.provider === 'ai-gateway',
    });
  }
  if (
    settings.openrouterApiKey &&
    settings.openrouterBaseUrl?.trim() &&
    settings.openrouterModel?.trim()
  ) {
    providers.push({
      provider: 'openrouter',
      model: settings.openrouterModel.trim(),
      isDefault: settings.provider === 'openrouter',
    });
  }
  return providers;
}
