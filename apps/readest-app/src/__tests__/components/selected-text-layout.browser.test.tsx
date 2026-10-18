import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SelectedTextAssistantPopup from '@/app/reader/components/annotator/SelectedTextAssistantPopup';
import type { TextSelection } from '@/utils/sel';

const aiTranslate = vi.hoisted(() => vi.fn().mockResolvedValue('AI result'));
const aiSettings = vi.hoisted(() => ({ enabled: false }));
const translate = vi.hoisted(() => vi.fn().mockResolvedValue(['你好']));
vi.mock('@/services/translators/providers/google', () => ({ googleProvider: { translate } }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { aiSettings, globalViewSettings: { translateTargetLang: 'zh' } },
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
  isNotebookAssistantConfigured: () => aiSettings.enabled,
}));
vi.mock('@/services/ai/connections', () => ({
  getAIConnections: () => [{ id: 'local', name: 'Ollama', model: 'gemma' }],
  resolveAIConnection: () => ({ id: 'local' }),
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

vi.mock('@/services/ai/utils/httpFetch', () => ({
  getAIFetch: () =>
    vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: 'gemma4:e4b' }] }) }),
}));
import '@/styles/globals.css';
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));
const text =
  'Here are your tasks:\nRefactor this class into a record called Employee, preserving its fields and behavior.\nAdd a compact constructor that validates age and salary.\nThe solution is provided in the appendix.';
afterEach(() => {
  cleanup();
  aiSettings.enabled = false;
  vi.clearAllMocks();
});
it('renders the full original in a compact popup, including on a narrow screen', async () => {
  const { page } = await import('vitest/browser');
  for (const [width, theme, eink] of [
    [480, 'light', false],
    [300, 'light', false],
    [300, 'dark', false],
    [300, 'light', true],
  ] as const) {
    document.documentElement.dataset['theme'] = theme;
    document.documentElement.dataset['eink'] = String(eink);
    render(
      <SelectedTextAssistantPopup
        action='translation'
        bookKey='book'
        selection={{ text } as TextSelection}
        position={{ dir: 'down', point: { x: 10, y: 20 } }}
        trianglePosition={{ dir: 'down', point: { x: 100, y: 20 } }}
        popupWidth={width}
        popupHeight={600}
        bookTitle=''
        bookAuthor=''
        onDismiss={() => {}}
      />,
    );
    const popup = document.getElementById('popup-container')!;
    const source = screen.getByText(/Here are your tasks:/);
    expect(source.clientHeight).toBe(source.scrollHeight);
    expect(source.clientHeight).toBeGreaterThan(48);
    expect(popup.clientHeight).toBeLessThan(500);
    expect(popup.scrollWidth).toBe(popup.clientWidth);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('google');
    await page.screenshot({ path: `/tmp/readest-translation-${width}.png` });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '__add__' } });
    expect(screen.getByText('Add AI Service')).toBeTruthy();
    expect(popup.scrollWidth).toBe(popup.clientWidth);
    expect(screen.getByLabelText('Model')).toBeTruthy();
    await page.screenshot({ path: `/tmp/readest-ai-service-${width}-${theme}-${eink}.png` });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/Here are your tasks:/)).toBeTruthy();
    cleanup();
  }
});

it('opens with the configured AI translation provider and runs it in the browser', async () => {
  aiSettings.enabled = true;
  render(
    <SelectedTextAssistantPopup
      action='translation'
      bookKey='book'
      selection={{ text } as TextSelection}
      position={{ dir: 'down', point: { x: 10, y: 20 } }}
      trianglePosition={{ dir: 'down', point: { x: 10, y: 20 } }}
      popupWidth={480}
      popupHeight={600}
      bookTitle=''
      bookAuthor=''
      onDismiss={() => {}}
    />,
  );
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('local');
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  expect(await screen.findByText('AI result')).toBeTruthy();
  expect(aiTranslate).toHaveBeenCalled();
  expect(translate).not.toHaveBeenCalled();
  const { page } = await import('vitest/browser');
  await page.screenshot({ path: '/tmp/readest-ai-translation-provider.png' });
});
