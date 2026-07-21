import { beforeEach, describe, expect, test } from 'vitest';
import {
  DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
  resolveNotebookAssistantSettings,
} from '@/services/notebook-assistant/types';
import {
  buildNotebookAssistantDiagnostics,
  clearNotebookAssistantUsage,
  evaluateUsageLimit,
  getNotebookAssistantUsage,
  getTodayNotebookAssistantTokens,
  recordNotebookAssistantUsage,
} from '@/services/notebook-assistant/usage';

describe('notebook assistant usage', () => {
  test('migrates the former daily token default to unlimited', () => {
    expect(resolveNotebookAssistantSettings({ dailyTokenLimit: 100_000 }).dailyTokenLimit).toBe(0);
  });

  beforeEach(() => {
    clearNotebookAssistantUsage();
  });

  test('records request metadata without source text, response text, or API key', () => {
    recordNotebookAssistantUsage(
      {
        action: 'summary',
        contextType: 'chapter',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokenEstimate: { input: 1200, output: 300 },
        success: true,
        bookId: 'book-1',
      },
      Date.UTC(2026, 6, 16, 12),
    );
    const raw = localStorage.getItem('readest-notebook-assistant-usage-v1') || '';
    expect(raw).toContain('summary');
    expect(raw).not.toContain('secret-key');
    expect(raw).not.toContain('selected source text');
    expect(raw).not.toContain('assistant response');
    expect(getTodayNotebookAssistantTokens(Date.UTC(2026, 6, 16, 13))).toBe(1500);
  });

  test('conservative cost mode blocks requests above the daily limit', () => {
    const settings = {
      ...DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
      costMode: 'conservative' as const,
      dailyTokenLimit: 1000,
      usageTrackingEnabled: true,
    };
    recordNotebookAssistantUsage(
      {
        action: 'translation',
        contextType: 'selection',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokenEstimate: { input: 700, output: 100 },
        success: true,
      },
      Date.UTC(2026, 6, 16, 12),
    );
    expect(
      evaluateUsageLimit(settings, { input: 300, output: 100 }, Date.UTC(2026, 6, 16, 13)),
    ).toMatchObject({
      allowed: false,
      needsConfirmation: false,
      usedToday: 800,
      projectedTotal: 1200,
      limit: 1000,
    });
  });

  test('balanced cost mode asks for confirmation above the daily limit', () => {
    const settings = {
      ...DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
      costMode: 'balanced' as const,
      dailyTokenLimit: 1000,
      usageTrackingEnabled: true,
    };
    expect(evaluateUsageLimit(settings, { input: 900, output: 200 })).toMatchObject({
      allowed: true,
      needsConfirmation: true,
      projectedTotal: 1100,
      limit: 1000,
    });
  });

  test('diagnostics are redacted and contain only metadata', () => {
    recordNotebookAssistantUsage({
      action: 'quiz',
      contextType: 'chapter',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokenEstimate: { input: 100, output: 200 },
      success: false,
      errorCode: 'rate_limited',
    });
    const diagnostics = buildNotebookAssistantDiagnostics({
      settings: {
        ...DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
        baseUrl: 'https://api.example.com/v1/private?token=do-not-copy',
      },
      apiKeyConfigured: true,
      secureKeyStorage: true,
      platform: 'test',
      lastError: 'The provider rate limit or balance limit was reached.',
    });
    const json = JSON.stringify(diagnostics);
    expect(diagnostics['baseUrlOrigin']).toBe('https://api.example.com');
    expect(json).not.toContain('do-not-copy');
    expect(json).not.toContain('Authorization');
    expect(json).not.toContain('secret-key');
    expect(json).not.toContain('sourceText');
    expect(json).toContain('rate_limited');
    expect(getNotebookAssistantUsage()).toHaveLength(1);
  });
});
