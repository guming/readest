import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UnderstandingMapActions from '@/app/reader/components/notebook/UnderstandingMapActions';

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  context: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/services/notebook-assistant/client', () => ({
  NotebookAssistantError: class NotebookAssistantError extends Error {},
  runUnderstandingMapAssistant: mocks.generate,
}));
vi.mock('@/services/notebook-assistant/context', () => ({
  buildCurrentChapterContext: mocks.context,
}));
vi.mock('@/services/notebook-assistant/provider', () => ({
  getNotebookAssistantIdentity: () => ({ provider: 'ollama', model: 'test' }),
  isNotebookAssistantConfigured: () => true,
}));
vi.mock('@/services/notebook-assistant/types', () => ({
  resolveNotebookAssistantSettings: () => ({
    targetLanguage: 'English',
    warnAboveTokens: 10000,
    usageTrackingEnabled: false,
  }),
}));
vi.mock('@/services/notebook-assistant/usage', () => ({
  evaluateUsageLimit: () => ({ allowed: true, needsConfirmation: false }),
  recordNotebookAssistantUsage: vi.fn(),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ bookDoc: {} }),
    getConfig: mocks.getConfig,
    setConfig: mocks.setConfig,
    saveConfig: mocks.saveConfig,
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: () => null, getProgress: () => null }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: { settings: object }) => unknown) =>
    selector({ settings: { aiSettings: {} } }),
}));
vi.mock('@/app/reader/components/notebook/UnderstandingMapView', () => ({
  default: () => <div>Rendered map</div>,
}));

describe('UnderstandingMapActions save', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.getConfig.mockReturnValue({ updatedAt: 0, notebookCards: [] });
    mocks.context.mockResolvedValue({
      title: 'Chapter 1',
      sourceText: 'First. Second.',
      sourceBlocks: [{ id: 'b1', text: 'First.', cfi: 'cfi-1' }],
    });
    mocks.generate.mockResolvedValue({
      schemaVersion: 1,
      question: 'Why?',
      nodes: [
        {
          id: 'n1',
          label: 'First',
          explanation: 'First.',
          evidenceQuote: 'First.',
          sourceCfi: 'cfi-1',
        },
        {
          id: 'n2',
          label: 'Second',
          explanation: 'Second.',
          evidenceQuote: 'Second.',
          sourceCfi: 'cfi-2',
        },
      ],
      edges: [{ from: 'n1', to: 'n2', relation: 'precedes' }],
    });
    mocks.saveConfig.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it('persists a generated map as a notebook card', async () => {
    render(<UnderstandingMapActions bookKey='book-1' />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Map' }));
    expect(await screen.findByText('Rendered map')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledOnce());
    expect(mocks.setConfig.mock.calls[0]?.[1].notebookCards[0].type).toBe('understanding_map');
    expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy();
  });

  it('reports a storage failure and allows retry', async () => {
    mocks.saveConfig.mockRejectedValueOnce(new Error('Storage unavailable'));
    render(<UnderstandingMapActions bookKey='book-1' />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Map' }));
    expect(await screen.findByText('Rendered map')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Storage unavailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(mocks.setConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' })).toBeTruthy());
    expect(mocks.setConfig).toHaveBeenCalledOnce();
    expect(mocks.saveConfig).toHaveBeenCalledTimes(2);
  });

  it('explains when the book config is unavailable', async () => {
    mocks.getConfig.mockReturnValue(null);
    render(<UnderstandingMapActions bookKey='book-1' />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate Map' }));
    expect(await screen.findByText('Rendered map')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Book data is not ready. Try saving again.')).toBeTruthy();
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });
});
