import { describe, expect, it } from 'vitest';
import {
  findEvidenceRange,
  parseHistoryChapterGuide,
} from '@/services/notebook-assistant/historyChapterGuide';

const blocks = [
  { id: 'b1', text: 'The archive records a tax increase in 1842.', cfi: 'cfi-1', endCfi: 'cfi-2' },
];

describe('history chapter guide', () => {
  it('finds a quote across adjacent text nodes and normalizes whitespace', () => {
    const doc = new DOMParser().parseFromString(
      '<p>Taxes rose <em>sharply</em>\n in 1842.</p>',
      'text/html',
    );
    const range = findEvidenceRange(doc, 'rose sharply in 1842');
    expect(range?.toString().replace(/\s+/g, ' ').trim()).toBe('rose sharply in 1842');
  });

  it('anchors every major claim to a real passage', () => {
    const guide = parseHistoryChapterGuide(
      JSON.stringify({
        overview: 'The chapter studies taxation.',
        keyPoints: [
          { point: 'Taxes rose.', sourceBlockId: 'b1', evidenceQuote: 'a tax increase in 1842' },
        ],
        reasoning: [
          {
            point: 'The author infers pressure.',
            premise: 'The archive records an increase.',
            conclusion: 'The author infers fiscal pressure.',
            sourceBlockId: 'b1',
            evidenceQuote: 'The archive records a tax increase',
          },
        ],
        limits: [],
        takeaways: ['Distinguish records from interpretation.'],
      }),
      blocks,
    );
    expect(guide.keyPoints[0]?.sourceCfi).toBe('cfi-1');
  });

  it('accepts grounded findings when optional sections are omitted', () => {
    const guide = parseHistoryChapterGuide(
      JSON.stringify({
        keyPoints: [
          { point: 'Taxes rose.', sourceBlockId: 'b1', evidenceQuote: 'a tax increase in 1842' },
        ],
      }),
      blocks,
    );
    expect(guide.overview).toBe('Taxes rose.');
    expect(guide.reasoning).toEqual([]);
    expect(guide.limits).toEqual([]);
    expect(guide.takeaways).toEqual([]);
  });

  it('identifies a missing keyPoints field instead of reporting a generic incomplete response', () => {
    expect(() =>
      parseHistoryChapterGuide(JSON.stringify({ overview: 'Taxation.' }), blocks),
    ).toThrow('The provider response is missing the keyPoints array.');
  });

  it('ignores empty or malformed optional takeaways', () => {
    const guide = parseHistoryChapterGuide(
      JSON.stringify({
        keyPoints: [
          { point: 'Taxes rose.', sourceBlockId: 'b1', evidenceQuote: 'a tax increase in 1842' },
        ],
        takeaways: ['', null, 3, '  Keep records distinct from interpretation.  '],
      }),
      blocks,
    );
    expect(guide.takeaways).toEqual(['Keep records distinct from interpretation.']);
  });

  it('keeps valid grounded points when the response also contains malformed items', () => {
    const guide = parseHistoryChapterGuide(
      JSON.stringify({
        keyPoints: [
          null,
          { point: 'Taxes rose.', sourceBlockId: 'b1', evidenceQuote: 'a tax increase in 1842' },
          { point: '', sourceBlockId: 'b1', evidenceQuote: 'a tax increase in 1842' },
        ],
        reasoning: [null, { point: 'invalid' }],
      }),
      blocks,
    );
    expect(guide.keyPoints).toHaveLength(1);
    expect(guide.reasoning).toEqual([]);
  });

  it('rejects invented quotations', () => {
    expect(() =>
      parseHistoryChapterGuide(
        JSON.stringify({
          overview: 'Taxation.',
          keyPoints: [
            { point: 'Taxes fell.', sourceBlockId: 'b1', evidenceQuote: 'a tax decrease in 1842' },
          ],
          reasoning: [],
          limits: [],
          takeaways: ['Check the archive.'],
        }),
        blocks,
      ),
    ).toThrow();
  });

  it('rejects a quotation attributed to the wrong passage', () => {
    const otherBlocks = [
      ...blocks,
      { id: 'b2', text: 'A separate account mentions a protest.', cfi: 'cfi-3', endCfi: 'cfi-4' },
    ];
    expect(() =>
      parseHistoryChapterGuide(
        JSON.stringify({
          overview: 'Taxation.',
          keyPoints: [
            { point: 'Taxes rose.', sourceBlockId: 'b2', evidenceQuote: 'a tax increase in 1842' },
          ],
          reasoning: [],
          limits: [],
          takeaways: [],
        }),
        otherBlocks,
      ),
    ).toThrow();
  });

  it('does not call a substantial chapter empty when the model declines', () => {
    const substantial = [{ ...blocks[0]!, text: blocks[0]!.text.repeat(20) }];
    expect(() =>
      parseHistoryChapterGuide('{"reason":"insufficient_content"}', substantial),
    ).toThrow('The AI could not analyze this chapter. Please try again.');
  });
});
