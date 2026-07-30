import { describe, expect, test } from 'vitest';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS } from '@/services/notebook-assistant/types';
import {
  getAITranslationTargetLanguage,
  getNotebookAssistantIdentity,
  isNotebookAssistantConfigured,
} from '@/services/notebook-assistant/provider';

describe('notebook assistant provider resolution', () => {
  test('resolves the global translation target to an explicit language name', () => {
    expect(getAITranslationTargetLanguage('zh-CN', 'en')).toBe('Simplified Chinese (zh-CN)');
    expect(getAITranslationTargetLanguage('EN', 'zh-CN')).toBe('English (en)');
    expect(getAITranslationTargetLanguage('', 'zh-CN')).toBe('Simplified Chinese (zh-CN)');
  });

  test('uses the active global provider even when legacy notebook settings exist', () => {
    const identity = getNotebookAssistantIdentity(DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS, {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ollama',
      ollamaModel: 'gemma4:e4b',
    });

    expect(identity).toEqual({
      provider: 'ollama',
      model: 'gemma4:e4b',
      source: 'global',
    });
  });

  test('uses the active global Ollama model without requiring a notebook API key', () => {
    const assistant = {
      ...DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
      connectionSource: 'global' as const,
    };
    const aiSettings = {
      ...DEFAULT_AI_SETTINGS,
      enabled: true,
      provider: 'ollama' as const,
      ollamaModel: 'gemma4:e4b',
    };

    expect(getNotebookAssistantIdentity(assistant, aiSettings)).toEqual({
      provider: 'ollama',
      model: 'gemma4:e4b',
      source: 'global',
    });
    expect(isNotebookAssistantConfigured(assistant, aiSettings, '')).toBe(true);
  });

  test('does not silently fall back when the selected global provider is disabled', () => {
    const assistant = {
      ...DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
      connectionSource: 'global' as const,
    };

    expect(isNotebookAssistantConfigured(assistant, DEFAULT_AI_SETTINGS, 'legacy-secret')).toBe(
      false,
    );
  });

  test('does not treat a legacy API key as global provider configuration', () => {
    expect(
      isNotebookAssistantConfigured(
        DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
        DEFAULT_AI_SETTINGS,
        'secret',
      ),
    ).toBe(false);
  });
});
