import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SelectedTextAssistantPopup from '@/app/reader/components/annotator/SelectedTextAssistantPopup';
import type { TextSelection } from '@/utils/sel';

const translate = vi.hoisted(() => vi.fn().mockResolvedValue(['你好']));
vi.mock('@/services/translators/providers/google', () => ({ googleProvider: { translate } }));
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

import '@/styles/globals.css';
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));
const text =
  'Here are your tasks:\nRefactor this class into a record called Employee, preserving its fields and behavior.\nAdd a compact constructor that validates age and salary.\nThe solution is provided in the appendix.';
afterEach(cleanup);
it('renders the full original in a compact popup, including on a narrow screen', async () => {
  const { page } = await import('vitest/browser');
  for (const width of [480, 300]) {
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
    cleanup();
  }
});
