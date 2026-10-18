import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AIConnectionEditor from '@/components/settings/AIConnectionEditor';
const fetchModels = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: 'gemma4:e4b' }] }) }),
);
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchModels }));
afterEach(cleanup);
it('loads Ollama models and saves a usable connection in place', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<AIConnectionEditor onSave={save} onCancel={() => {}} />);
  await waitFor(() =>
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('gemma4:e4b'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save and Use' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'gemma4:e4b',
        name: 'Ollama',
      }),
    ),
  );
});
it('edits an existing connection without losing its identity or capabilities', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <AIConnectionEditor
      connection={{
        id: 'existing',
        name: 'Work',
        provider: 'openrouter',
        template: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'secret',
        model: 'old',
        supportsVision: true,
      }}
      onSave={save}
      onCancel={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and Use' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing',
        model: 'new',
        supportsVision: true,
        apiKey: 'secret',
      }),
    ),
  );
});
it('keeps the form open and shows a persistence error', async () => {
  render(
    <AIConnectionEditor
      onSave={vi.fn().mockRejectedValue(new Error('Save failed'))}
      onCancel={() => {}}
    />,
  );
  await waitFor(() =>
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save and Use' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Save failed'));
});
