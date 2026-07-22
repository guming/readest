import { beforeEach, describe, expect, test, vi } from 'vitest';

const fetchMock = vi.fn();
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

import {
  NotebookAssistantError,
  estimateContextTokens,
  estimateQuizTokens,
  estimateSelectedTextTokens,
  normalizeAssistantBaseUrl,
  parseOneQuestionResponse,
  parseQuizResponse,
  runChapterQuizAssistant,
  runNotebookContextAssistant,
  runOneQuestionAssistant,
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

  test('parses and validates one multiple-choice question against its source', () => {
    const parsed = parseOneQuestionResponse(
      JSON.stringify({
        question: {
          id: 'one-1',
          type: 'multiple_choice',
          question: 'Why can rewards reduce motivation?',
          choices: [
            { id: 'a', text: 'They always cost too much.' },
            { id: 'b', text: 'They can feel controlling.' },
            { id: 'c', text: 'They remove all choices.' },
          ],
          correctChoiceId: 'b',
          referenceAnswer: 'Rewards can replace intrinsic motivation when they feel controlling.',
          evidenceQuote: 'Rewards can feel controlling and weaken intrinsic motivation.',
        },
      }),
      'The author argues: Rewards can feel controlling and weaken intrinsic motivation.',
    );
    expect(parsed.question).toMatchObject({
      id: 'one-1',
      type: 'multiple_choice',
      correctChoiceId: 'b',
    });
  });

  test('resolves a model-selected source block to a trusted CFI anchor', () => {
    const sourceBlocks = [
      {
        id: 'block-1',
        text: 'Rewards can feel controlling and weaken intrinsic motivation.',
        cfi: 'epubcfi(/6/2!/4/2:0)',
        endCfi: 'epubcfi(/6/2!/4/2:62)',
      },
    ];
    const parsed = parseOneQuestionResponse(
      JSON.stringify({
        question: {
          id: 'anchored-1',
          type: 'open',
          question: 'Why can rewards reduce motivation?',
          referenceAnswer: 'They can feel controlling.',
          evidenceQuote: 'Rewards can feel controlling',
          sourceBlockId: 'block-1',
        },
      }),
      sourceBlocks[0]!.text,
      sourceBlocks,
    );
    expect(parsed.question?.sourceAnchor).toEqual({
      blockId: 'block-1',
      cfi: 'epubcfi(/6/2!/4/2:0)',
      endCfi: 'epubcfi(/6/2!/4/2:62)',
    });
  });

  test('rejects a missing or mismatched source block when anchored context is supplied', () => {
    const sourceBlocks = [
      {
        id: 'block-1',
        text: 'The supported statement appears here.',
        cfi: 'epubcfi(/6/2!/4/2:0)',
        endCfi: 'epubcfi(/6/2!/4/2:37)',
      },
    ];
    const response = (sourceBlockId: string) =>
      JSON.stringify({
        question: {
          type: 'open',
          question: 'What is supported?',
          referenceAnswer: 'The statement.',
          evidenceQuote: 'The supported statement',
          sourceBlockId,
        },
      });
    expect(() =>
      parseOneQuestionResponse(response('missing'), sourceBlocks[0]!.text, sourceBlocks),
    ).toThrow(NotebookAssistantError);
    expect(() =>
      parseOneQuestionResponse(
        response('block-1').replace('The supported statement', 'Outside evidence'),
        sourceBlocks[0]!.text,
        sourceBlocks,
      ),
    ).toThrow(NotebookAssistantError);
  });

  test('parses an open question and explicit abstention', () => {
    expect(
      parseOneQuestionResponse(
        JSON.stringify({
          question: {
            id: 'one-2',
            type: 'open',
            question: 'Explain the central trade-off in your own words.',
            referenceAnswer: 'Speed improves output but can reduce accuracy.',
            evidenceQuote: 'Greater speed increased output while reducing accuracy.',
          },
        }),
        'Greater speed increased output while reducing accuracy.',
      ).question,
    ).toMatchObject({ type: 'open' });
    expect(
      parseOneQuestionResponse(
        JSON.stringify({ question: null, reason: 'insufficient_content' }),
        'Copyright page',
      ),
    ).toEqual({ question: null, reason: 'insufficient_content' });
  });

  test('accepts common snake-case fields returned by compatible providers', () => {
    const sourceBlocks = [
      {
        id: 'block-1',
        text: 'Local-first keeps reading available without a network.',
        cfi: 'epubcfi(/6/2!/4/2:0)',
        endCfi: 'epubcfi(/6/2!/4/2:55)',
      },
    ];
    expect(
      parseOneQuestionResponse(
        JSON.stringify({
          question: {
            type: 'open',
            question: 'Why is local-first useful?',
            reference_answer: 'It keeps reading available without a network.',
            evidence_quote: 'Local-first keeps reading available without a network.',
            source_block_id: 'block-1',
          },
        }),
        sourceBlocks[0]!.text,
        sourceBlocks,
      ).question,
    ).toMatchObject({
      type: 'open',
      referenceAnswer: 'It keeps reading available without a network.',
    });
  });

  test('rejects invalid one-question choices and unsupported evidence', () => {
    const invalidChoice = JSON.stringify({
      question: {
        type: 'multiple_choice',
        question: 'What matters?',
        choices: [
          { id: 'a', text: 'Context' },
          { id: 'a', text: 'Context again' },
          { id: 'c', text: 'Evidence' },
        ],
        correctChoiceId: 'missing',
        referenceAnswer: 'Evidence matters.',
        evidenceQuote: 'Evidence matters.',
      },
    });
    expect(() => parseOneQuestionResponse(invalidChoice, 'Evidence matters.')).toThrow(
      NotebookAssistantError,
    );

    const unsupportedEvidence = JSON.stringify({
      question: {
        type: 'open',
        question: 'What matters?',
        referenceAnswer: 'Evidence matters.',
        evidenceQuote: 'This quote is not in the chapter.',
      },
    });
    expect(() => parseOneQuestionResponse(unsupportedEvidence, 'Evidence matters.')).toThrow(
      NotebookAssistantError,
    );
  });

  test('requests exactly one source-grounded question', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  question: {
                    id: 'one-3',
                    type: 'open',
                    question: 'Why is local-first useful?',
                    referenceAnswer: 'It keeps reading available without a network.',
                    evidenceQuote: 'Local-first keeps reading available without a network.',
                  },
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
    const result = await runOneQuestionAssistant(
      {
        sourceText: 'Local-first keeps reading available without a network.',
        title: 'Chapter 1',
        targetLanguage: 'English',
        provider: 'custom',
        model: settings.model,
      },
      settings,
      'secret',
    );
    expect(result.question?.type).toBe('open');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).toContain('exactly one');
    expect(body.messages[1].content).toContain('Local-first keeps reading');
    expect(JSON.stringify(body)).not.toContain('secret');
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
