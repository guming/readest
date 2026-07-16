import { describe, expect, test } from 'vitest';

import {
  buildCurrentChapterContext,
  buildCurrentPageContext,
} from '@/services/notebook-assistant/context';
import type { BookDoc } from '@/libs/document';
import type { BookProgress } from '@/types/book';

const makeProgress = (): BookProgress => {
  const container = document.createElement('div');
  container.innerHTML = '<p>Visible page text</p><p>Text outside the visible range</p>';
  const range = document.createRange();
  range.selectNodeContents(container.firstElementChild!);
  return {
    location: 'epubcfi(/6/2)',
    sectionHref: 'chapter-1.xhtml',
    sectionLabel: 'Chapter One',
    section: { current: 0, total: 3 },
    pageinfo: { current: 11, total: 200 },
    pageItem: { label: 'Page 12' },
    timeinfo: { section: 2, total: 20 },
    fraction: 0.1,
    index: 0,
    range,
    page: 12,
  };
};

const makeBookDoc = (): BookDoc =>
  ({
    sections: [
      {
        id: 'chapter-1.xhtml',
        href: 'chapter-1.xhtml',
        loadText: async () => '<main><h1>Chapter One</h1><p>Complete chapter text.</p></main>',
      },
    ],
    splitTOCHref: (href: string) => [href],
  }) as unknown as BookDoc;

describe('notebook assistant reading context', () => {
  test('current page uses the visible progress range and records page/chapter metadata', async () => {
    const context = await buildCurrentPageContext(makeBookDoc(), null, makeProgress());
    expect(context.sourceText).toBe('Visible page text');
    expect(context.sourceText).not.toContain('outside');
    expect(context.pageNumber).toBe(12);
    expect(context.pageCfi).toBe('epubcfi(/6/2)');
    expect(context.chapterId).toBe('chapter-1.xhtml');
    expect(context.chapterTitle).toBe('Chapter One');
  });

  test('current chapter loads the complete section and keeps the current page anchor', async () => {
    const context = await buildCurrentChapterContext(makeBookDoc(), null, makeProgress());
    expect(context.sourceText).toContain('Complete chapter text.');
    expect(context.contextType).toBe('chapter');
    expect(context.pageNumber).toBe(12);
    expect(context.chapterTitle).toBe('Chapter One');
  });
});
