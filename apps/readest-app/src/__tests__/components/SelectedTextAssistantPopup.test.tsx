import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SelectedTextAssistantPopup from '@/app/reader/components/annotator/SelectedTextAssistantPopup';
import type { TextSelection } from '@/utils/sel';

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
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: { translateTargetLang: 'zh' } },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  }),
}));
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
vi.mock('@/services/notebook-assistant/provider', () => ({
  getAITranslationTargetLanguage: () => 'Chinese',
  getNotebookAssistantIdentity: () => ({ provider: 'ollama', model: 'gemma' }),
  isNotebookAssistantConfigured: () => false,
}));
vi.mock('@/services/ai/connections', () => ({
  getAIConnections: () => [{ id: 'local', name: 'Ollama', model: 'gemma' }],
  resolveAIConnection: () => ({ id: 'local' }),
}));
vi.mock('@/services/notebook-assistant/client', () => ({
  appendFollowUpExplanation: vi.fn(),
  estimateSelectedTextTokens: () => ({ input: 10, output: 20 }),
  NotebookAssistantError: class extends Error {},
  runSelectedTextAssistant: vi.fn(),
}));

vi.mock('@/services/notebook-assistant/usage', () => ({
  evaluateUsageLimit: () => ({ allowed: true }),
  recordNotebookAssistantUsage: vi.fn(),
}));
vi.mock('@/utils/clipboard', () => ({ writeTextToClipboard: vi.fn() }));

const text =
  'Here are your tasks:\nRefactor the class and preserve all its fields.\nAdd a constructor.';
const show = () =>
  render(
    <SelectedTextAssistantPopup
      action='translation'
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
afterEach(cleanup);
describe('selected text translation', () => {
  it('defaults to Google and translates without AI configuration', async () => {
    show();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('google');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText('你好')).toBeTruthy());
    expect(translate).toHaveBeenCalledWith([text], 'auto', 'zh');
  });
  it('shows the complete source without a two-line clamp or forced height', () => {
    show();
    const source = screen.getByText(/Here are your tasks:/);
    expect(source.className).not.toContain('line-clamp');
    expect(source.className).toContain('whitespace-pre-wrap');
    expect(screen.getByTestId('popup').getAttribute('data-height')).toBeNull();
  });
});
