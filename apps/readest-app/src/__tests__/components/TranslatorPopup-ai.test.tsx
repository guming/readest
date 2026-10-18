import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TranslatorPopup from '@/app/reader/components/annotator/TranslatorPopup';
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ token: '' }) }));
const settingsMock = vi.hoisted(() => ({
  settings: {
    aiSettings: {
      connections: [{ id: 'local', provider: 'ollama', name: 'Ollama', model: 'gemma' }],
    },
  },
}));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => settingsMock }));
const translatorMock = vi.hoisted(() => ({
  translate: vi.fn().mockResolvedValue(['translated']),
  translators: [{ name: 'google', label: 'Google Translate', translate: vi.fn() }],
}));
vi.mock('@/hooks/useTranslator', () => ({ useTranslator: () => translatorMock }));
vi.mock('@/services/translators', () => ({
  getTranslatorDisplayLabel: () => 'Google Translate',
  getTranslators: () => [{ name: 'google' }],
  isTranslatorAvailable: () => true,
}));
vi.mock('@/services/constants', () => ({ TRANSLATOR_LANGS: { en: 'English', zh: 'Chinese' } }));
vi.mock('@/components/Popup', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
afterEach(cleanup);
it('routes a saved model or a new service directly from the provider menu', async () => {
  const selectAI = vi.fn();
  render(
    <TranslatorPopup
      text='Hello'
      position={{ dir: 'down', point: { x: 0, y: 0 } }}
      trianglePosition={{ dir: 'down', point: { x: 0, y: 0 } }}
      popupWidth={480}
      popupHeight={600}
      currentProvider='google'
      currentTargetLang='zh'
      onSelectCustomAI={selectAI}
    />,
  );
  const option = await screen.findByRole('option', { name: 'Ollama · gemma' });
  const menu = option.closest('select')!;
  fireEvent.change(menu, { target: { value: 'ai:local' } });
  expect(selectAI).toHaveBeenCalledWith('local');
  fireEvent.change(menu, { target: { value: 'custom-ai' } });
  expect(selectAI).toHaveBeenCalledWith('__add__');
});
