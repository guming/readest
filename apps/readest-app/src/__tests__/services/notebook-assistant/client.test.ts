import { beforeEach, describe, expect, test, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

import {
  NotebookAssistantError,
  estimateContextTokens,
  estimateQuizTokens,
  estimateSelectedTextTokens,
  normalizeAssistantBaseUrl,
  parseQuizResponse,
  runChapterQuizAssistant,
  runNotebookContextAssistant,
  runSelectedTextAssistant,
} from '@/services/notebook-assistant/client';
import { DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS } from '@/services/notebook-assistant/types';

describe('selected-text assistant client', () => {
  beforeEach(() => fetchMock.mockReset());

  test('normalizes the base URL and rejects non-http URLs', () => {
    expect(normalizeAssistantBaseUrl('https://api.example.com/v1///')).toBe(
      'https://api.example.com/v1',
    );
    expect(() => normalizeAssistantBaseUrl('file:///tmp/api')).toThrow(NotebookAssistantError);
  });

  test('uses a stable positive token estimate', () => {
    expect(estimateSelectedTextTokens('hello', 'translation')).toEqual({ input: 82, output: 128 });
    expect(estimateSelectedTextTokens('hello', 'explanation').input).toBeGreaterThan(100);
    expect(estimateContextTokens('chapter text', 'summary')).toEqual({ input: 224, output: 900 });
    expect(estimateQuizTokens('chapter text', 5)).toEqual({ input: 264, output: 1600 });
  });

  test('sends only the system prompt and selected source text', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: '你好' } }] }), {
        status: 200,
      }),
    );
    const settings = {
      ...DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
      baseUrl: 'https://api.example.com/v1',
    };
    const result = await runSelectedTextAssistant(
      {
        action: 'translation',
        sourceText: 'hello',
        targetLanguage: 'Chinese',
        provider: 'custom',
        model: settings.model,
      },
      settings,
      'secret',
    );
    expect(result).toBe('你好');
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hello' });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  test('classifies authentication failures without exposing response content', async () => {
    fetchMock.mockResolvedValue(new Response('sensitive provider body', { status: 401 }));
    const settings = {
      ...DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
      baseUrl: 'https://api.example.com/v1',
    };
    await expect(
      runSelectedTextAssistant(
        {
          action: 'explanation',
          sourceText: 'text',
          targetLanguage: 'English',
          provider: 'custom',
          model: settings.model,
        },
        settings,
        'secret',
      ),
    ).rejects.toMatchObject({ code: 'unauthorized', message: 'The API key was rejected.' });
  });

  test('sends bounded page and chapter context requests', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'Overview\nDone' } }] }), {
        status: 200,
      }),
    );
    const settings = {
      ...DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
      baseUrl: 'https://api.example.com/v1',
    };
    const result = await runNotebookContextAssistant(
      {
        action: 'summary',
        contextType: 'chapter',
        sourceText: 'only this chapter',
        title: 'Chapter 1',
        targetLanguage: 'English',
        provider: 'custom',
        model: settings.model,
      },
      settings,
      'secret',
    );
    expect(result).toBe('Overview\nDone');
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content).toContain('Context scope: chapter');
    expect(body.messages[1].content).toContain('only this chapter');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  test('parses quiz JSON and normalizes question ids', () => {
    const parsed = parseQuizResponse(
      JSON.stringify({
        questions: [
          {
            type: 'true_false',
            question: 'Readest is local-first.',
            answer: 'True',
            explanation: 'The context says it saves locally first.',
          },
        ],
      }),
    );
    expect(parsed.questions[0]).toMatchObject({
      id: 'q1',
      type: 'true_false',
      answer: 'True',
    });
  });

  test('requests a chapter quiz as structured JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  questions: [
                    {
                      id: 'q1',
                      type: 'short_answer',
                      question: 'What is the main idea?',
                      answer: 'Local-first reading',
                      explanation: 'The chapter focuses on local-first reading.',
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const settings = {
      ...DEFAULT_NOTEBOOK_ASSISTANT_SETTINGS,
      baseUrl: 'https://api.example.com/v1',
    };
    const result = await runChapterQuizAssistant(
      {
        sourceText: 'chapter context',
        title: 'Chapter 1',
        targetLanguage: 'English',
        provider: 'custom',
        model: settings.model,
      },
      settings,
      'secret',
    );
    expect(result.questions).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).toContain('Return only valid JSON');
    expect(body.messages[1].content).toContain('chapter context');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
