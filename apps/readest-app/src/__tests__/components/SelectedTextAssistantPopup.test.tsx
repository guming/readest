import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SelectedTextAssistantPopup from '@/app/reader/components/annotator/SelectedTextAssistantPopup';
import { useSettingsStore } from '@/store/settingsStore';
import type { TextSelection } from '@/utils/sel';

const aiTranslate = vi.hoisted(() => vi.fn().mockResolvedValue('AI result'));
const translate = vi.hoisted(() => vi.fn().mockResolvedValue(['你好']));
vi.mock('@/services/translators/providers/google', () => ({ googleProvider: { translate } }));
vi.mock('@/components/Popup', () => ({
  default: ({ children, height }: { children: React.ReactNode; height?: number }) => (
    <div data-testid='popup' data-height={height}>
      {children}
    </div>
  ),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/ai/utils/httpFetch', () => ({
  getAIFetch: () =>
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: 'gemma4:e4b' }] }) }),
}));
vi.mock('@/store/settingsStore', async () => {
  const { create } = await import('zustand');
  const { DEFAULT_AI_SETTINGS } = await import('@/services/ai/constants');
  return {
    useSettingsStore: create((set) => ({
      settings: {
        aiSettings: {
          ...DEFAULT_AI_SETTINGS,
          enabled: false,
          connections: [
            {
              id: 'local',
              name: 'Ollama',
              provider: 'ollama',
              baseUrl: 'http://127.0.0.1:11434',
              model: 'gemma',
            },
          ],
        },
        globalViewSettings: { translateTargetLang: 'zh' },
      },
      setSettings: (settings: unknown) => set({ settings }),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    })),
  };
});
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getConfig: () => ({}), setConfig: vi.fn(), saveConfig: vi.fn() }),
}));
vi.mock('@/components/settings/NotebookAssistantPanel', () => ({
  default: () => <div>AI configuration</div>,
}));
vi.mock('@/services/notebook-assistant/context', () => ({ buildSelectionContext: () => '' }));
vi.mock('@/services/notebook-assistant/types', () => ({
  resolveNotebookAssistantSettings: () => ({ warnAboveTokens: 1000 }),
}));
vi.mock('@/services/notebook-assistant/client', () => ({
  appendFollowUpExplanation: vi.fn(),
  estimateSelectedTextTokens: () => ({ input: 10, output: 20 }),
  NotebookAssistantError: class extends Error {},
  runSelectedTextAssistant: aiTranslate,
}));

vi.mock('@/services/notebook-assistant/usage', () => ({
  evaluateUsageLimit: () => ({ allowed: true }),
  recordNotebookAssistantUsage: vi.fn(),
}));
vi.mock('@/utils/clipboard', () => ({ writeTextToClipboard: vi.fn() }));

const text =
  'Here are your tasks:\nRefactor the class and preserve all its fields.\nAdd a constructor.';
const show = (initialConnectionId?: string) =>
  render(
    <SelectedTextAssistantPopup
      action='translation'
      initialConnectionId={initialConnectionId}
      bookKey='book'
      selection={{ text } as TextSelection}
      position={{ dir: 'down', point: { x: 0, y: 0 } }}
      trianglePosition={{ dir: 'down', point: { x: 0, y: 0 } }}
      popupWidth={480}
      popupHeight={600}
      bookTitle=''
      bookAuthor=''
      onDismiss={() => {}}
    />,
  );
beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState(useSettingsStore.getInitialState());
});
afterEach(cleanup);
describe('selected text translation', () => {
  it('defaults to Google and translates without AI configuration', async () => {
    show();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('google');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText('你好')).toBeTruthy());
    expect(translate).toHaveBeenCalledWith([text], 'auto', 'zh');
  });
  it('uses the AI translation service configured in Settings by default', async () => {
    const settings = useSettingsStore.getState().settings;
    useSettingsStore.setState({
      settings: {
        ...settings,
        aiSettings: { ...settings.aiSettings, enabled: true, translationConnectionId: 'local' },
      },
    });
    show();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('local');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText('AI result')).toBeTruthy());
    expect(aiTranslate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ollama', model: 'gemma', sourceText: text }),
      expect.anything(),
      '',
      undefined,
      expect.objectContaining({ translationConnectionId: 'local', enabled: true }),
    );
    expect(translate).not.toHaveBeenCalled();
  });
  it('shows the complete source without a two-line clamp or forced height', () => {
    show();
    const source = screen.getByText(/Here are your tasks:/);
    expect(source.className).not.toContain('line-clamp');
    expect(source.className).toContain('whitespace-pre-wrap');
    expect(screen.getByTestId('popup').getAttribute('data-height')).toBeNull();
  });
  it('adds and selects an AI service without leaving the popup', async () => {
    show();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__add__' } });
    await waitFor(() =>
      expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gemma4:e4b'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save and Use' }));
    await waitFor(() => expect(screen.queryByText('Add AI Service')).toBeNull());
    const ai = useSettingsStore.getState().settings.aiSettings;
    expect(ai.enabled).toBe(true);
    expect(ai.connections).toHaveLength(2);
    expect(ai.translationConnectionId).toBe(ai.connections![1]!.id);
    expect(ai.connections![0]!.id).toBe('local');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
      ai.translationConnectionId,
    );
  });
  it('edits the selected service in place', async () => {
    show('local');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'new-model' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and Use' }));
    await waitFor(() =>
      expect(useSettingsStore.getState().settings.aiSettings.connections![0]!.model).toBe(
        'new-model',
      ),
    );
    expect(useSettingsStore.getState().settings.aiSettings.connections).toHaveLength(1);
  });
  it('opens the editor directly from the translation provider menu', () => {
    show('__add__');
    expect(screen.getByText('Add AI Service')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('google');
  });
  it('runs the model selected directly from the translation menu', async () => {
    show('local');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText('AI result')).toBeTruthy());
    expect(aiTranslate).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'ollama', model: 'gemma', sourceText: text }),
      expect.anything(),
      '',
      undefined,
      expect.objectContaining({ translationConnectionId: 'local', enabled: true }),
    );
  });
});
