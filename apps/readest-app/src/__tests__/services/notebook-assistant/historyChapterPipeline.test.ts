import { describe, expect, it, vi } from 'vitest';
import {
  groupHistoryPassages,
  runHistoryChapterPipeline,
} from '@/services/notebook-assistant/historyChapterPipeline';
import type { HistoryChapterGuide } from '@/services/notebook-assistant/historyChapterGuide';

const blocks = Array.from({ length: 7 }, (_, index) => ({
  id: `b${index}`,
  text: `The record for event ${index} describes a change in policy. `.repeat(12),
  cfi: `cfi-${index}`,
  endCfi: `end-${index}`,
}));

describe('history chapter pipeline', () => {
  it('groups consecutive passages without losing order', () => {
    const groups = groupHistoryPassages(blocks, 1_000);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flat().map((block) => block.id)).toEqual(blocks.map((block) => block.id));
  });

  it('analyzes each group before synthesizing and reports progress', async () => {
    const progress = vi.fn();
    const analyze = vi.fn(
      async (group: (typeof blocks)[number][]): Promise<HistoryChapterGuide> => ({
        schemaVersion: 1 as const,
        overview: 'A policy changes.',
        keyPoints: [
          {
            point: 'Policy changed.',
            evidenceQuote: 'change in policy',
            sourceBlockId: group[0]!.id,
            sourceCfi: group[0]!.cfi,
          },
        ],
        reasoning: [],
        limits: [],
        takeaways: [],
      }),
    );
    const synthesize = vi.fn(async (notes: HistoryChapterGuide[]) => notes[0]!);
    await runHistoryChapterPipeline(blocks, {
      analyze,
      synthesize,
      onProgress: progress,
      maxGroupChars: 1_000,
    });
    expect(analyze).toHaveBeenCalledTimes(groupHistoryPassages(blocks, 1_000).length);
    expect(synthesize).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith({ stage: 'complete', completed: 1, total: 1 });
  });
});
