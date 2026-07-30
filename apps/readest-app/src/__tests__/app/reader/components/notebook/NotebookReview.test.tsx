import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import NotebookReview from '@/app/reader/components/notebook/NotebookReview';

const mocks = vi.hoisted(() => ({
  runOneQuestionAssistant: vi.fn(),
  buildCurrentChapterContext: vi.fn(),
  goTo: vi.fn(),
}));

vi.mock('@/components/settings/NotebookAssistantPanel', () => ({ default: () => null }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));
vi.mock('@/services/notebook-assistant/context', () => ({
  buildCurrentChapterContext: mocks.buildCurrentChapterContext,
}));
vi.mock('@/services/notebook-assistant/client', () => ({
  NotebookAssistantError: class NotebookAssistantError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  estimateOneQuestionTokens: () => ({ input: 100, output: 700 }),
  estimateQuizTokens: () => ({ input: 100, output: 900 }),
  runChapterQuizAssistant: vi.fn(),
  runOneQuestionAssistant: mocks.runOneQuestionAssistant,
}));
vi.mock('@/services/notebook-assistant/secretStore', () => ({
  getAssistantApiKey: vi.fn(async () => 'secret'),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({ bookDoc: {} }),
    getConfig: () => null,
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: () => ({ goTo: mocks.goTo }), getProgress: () => null }),
}));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: (state: { settings: object }) => unknown) =>
    selector({
      settings: {
        aiSettings: {
          enabled: true,
          provider: 'ollama',
          ollamaBaseUrl: 'http://127.0.0.1:11434',
          ollamaModel: 'gemma4:e4b',
          ollamaEmbeddingModel: 'nomic-embed-text',
        },
        notebookAssistant: {
          provider: 'openai',
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-4o-mini',
          usageTrackingEnabled: false,
        },
      },
    }),
}));

describe('NotebookReview one-question MVP', () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.runOneQuestionAssistant.mockReset();
    mocks.goTo.mockReset();
    mocks.buildCurrentChapterContext.mockResolvedValue({
      contextType: 'chapter',
      sourceText: 'Greater speed increased output while reducing accuracy.',
      title: 'Chapter 1',
      chapterId: 'chapter-1',
    });
  });

  test('shows Ask Me One as the primary entry and keeps Chapter Quiz secondary', async () => {
    render(<NotebookReview bookKey='book-1' />);
    const ask = await screen.findByRole('button', { name: 'Ask Me One' });
    expect(ask.className).toContain('btn-primary');
    expect(screen.getByRole('button', { name: 'Chapter Quiz' }).className).toContain(
      'eink-bordered',
    );
  });

  test('shows an open question, reference idea, self-assessment, and evidence', async () => {
    mocks.runOneQuestionAssistant.mockResolvedValue({
      question: {
        id: 'one-1',
        type: 'open',
        question: 'Explain the trade-off in your own words.',
        referenceAnswer: 'Speed improves output but can reduce accuracy.',
        evidenceQuote: 'Greater speed increased output while reducing accuracy.',
        sourceAnchor: {
          blockId: 'block-1',
          cfi: 'epubcfi(/6/2!/4/2:0)',
          endCfi: 'epubcfi(/6/2!/4/2:58)',
        },
      },
    });
    render(<NotebookReview bookKey='book-1' />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Me One' }));
    const answer = await screen.findByRole('textbox', { name: 'Your answer' });
    expect(answer.className).toContain('eink-bordered');
    fireEvent.change(answer, { target: { value: 'More speed can harm accuracy.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Speed improves output but can reduce accuracy.')).toBeTruthy();
    expect(
      screen.getByText('Greater speed increased output while reducing accuracy.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I Got It' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View in Book' }));
    expect(mocks.goTo).toHaveBeenCalledWith('epubcfi(/6/2!/4/2:0)');
    expect(screen.queryByText('Correct')).toBeNull();
    expect(mocks.runOneQuestionAssistant).toHaveBeenCalledTimes(1);
  });

  test('grades a multiple-choice answer by choice id and can ask another', async () => {
    mocks.runOneQuestionAssistant.mockResolvedValue({
      question: {
        id: 'one-2',
        type: 'multiple_choice',
        question: 'What is the central trade-off?',
        choices: [
          { id: 'a', text: 'Speed versus accuracy' },
          { id: 'b', text: 'Cost versus color' },
          { id: 'c', text: 'Length versus title' },
        ],
        correctChoiceId: 'a',
        referenceAnswer: 'Greater speed can reduce accuracy.',
        evidenceQuote: 'Greater speed increased output while reducing accuracy.',
      },
    });
    render(<NotebookReview bookKey='book-1' />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Me One' }));
    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: 'Speed versus accuracy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Correct')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Another' }));
    await waitFor(() => expect(mocks.runOneQuestionAssistant).toHaveBeenCalledTimes(2));
  });

  test('shows abstention as a non-error state', async () => {
    mocks.runOneQuestionAssistant.mockResolvedValue({
      question: null,
      reason: 'insufficient_content',
    });
    render(<NotebookReview bookKey='book-1' />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Me One' }));
    expect(
      await screen.findByText('No useful question could be generated from this chapter.'),
    ).toBeTruthy();
    expect(screen.queryByText('The provider returned no usable question.')).toBeNull();
  });
});
