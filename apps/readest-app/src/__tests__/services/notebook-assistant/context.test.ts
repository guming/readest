import { describe, expect, test, vi } from 'vitest';
import { generateText } from 'ai';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: vi.fn(),
}));
vi.mock('@/services/ai/providers', () => ({
  getAIProvider: () => ({ getModel: () => 'mock-vision-model' }),
}));

import {
  buildCurrentChapterContext,
  buildCurrentPageContext,
  buildSelectionContext,
  getCurrentChapterIdentity,
} from '@/services/notebook-assistant/context';
import {
  buildLearningGuideContext,
  resolveLearningGuideTargetLanguage,
} from '@/services/notebook-assistant/learningGuideContext';
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
        createDocument: async () =>
          new DOMParser().parseFromString(
            '<main><h1>Chapter One</h1><p>Complete chapter text with a grounded passage for navigation.</p></main>',
            'text/html',
          ),
      },
    ],
    splitTOCHref: (href: string) => [href],
  }) as unknown as BookDoc;

describe('notebook assistant reading context', () => {
  test('learning guide follows the book language when no target language is configured', () => {
    expect(resolveLearningGuideTargetLanguage('', 'zh-CN', 'en-US')).toBe(
      'Simplified Chinese (zh-CN)',
    );
    expect(resolveLearningGuideTargetLanguage('', ['zh-TW', 'en'], 'en-US')).toBe(
      'Traditional Chinese (zh-TW)',
    );
  });

  test('configured learning guide language overrides the book language', () => {
    expect(resolveLearningGuideTargetLanguage('ja', 'zh-CN', 'en-US')).toBe('Japanese (ja)');
  });

  test('learning guide falls back to the system language when book language is missing', () => {
    expect(resolveLearningGuideTargetLanguage('', '', 'fr-FR')).toBe('French (France) (fr-FR)');
  });

  test('learning guide treats a PDF without an outline as having an empty table of contents', async () => {
    const bookDoc = { ...makeBookDoc(), toc: null } as unknown as BookDoc;

    const context = await buildLearningGuideContext({
      bookKey: 'pdf-without-outline',
      metadata: { title: 'Outline-free PDF', author: 'Author', language: 'en' },
      bookDoc,
      costMode: 'conservative',
    });

    expect(context.tocTitles).toEqual([]);
    expect(context.sourceKinds).not.toContain('toc');
    expect(context.sourceText).toContain('Complete chapter text.');
  });

  test('learning guide accepts PDF outline leaves with null subitems', async () => {
    const bookDoc = {
      ...makeBookDoc(),
      toc: [
        {
          label: 'Part One',
          subitems: [{ label: 'Chapter One', subitems: null }],
        },
      ],
    } as unknown as BookDoc;

    const context = await buildLearningGuideContext({
      bookKey: 'pdf-outline-null-leaf',
      metadata: { title: 'Outlined PDF', author: 'Author', language: 'en' },
      bookDoc,
      costMode: 'conservative',
    });

    expect(context.tocTitles).toEqual(['Part One', 'Chapter One']);
    expect(context.sourceKinds).toContain('toc');
  });

  test('learning guide accepts numeric PDF page IDs', async () => {
    const sections = [0, 1, 2].map((id) => ({
      id,
      linear: 'yes',
      loadText: async () => 'A complete page of extracted text from the PDF.',
    }));
    const context = await buildLearningGuideContext({
      bookKey: 'numbered-pdf',
      metadata: { title: 'Numbered PDF', author: 'Author', language: 'en' },
      bookDoc: { ...makeBookDoc(), toc: [], sections } as unknown as BookDoc,
      costMode: 'conservative',
    });
    expect(context.sourceText).toContain('A complete page of extracted text');
  });

  test('scanned PDF uses a vision model to read image-only pages', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: 'This scanned page explains algorithms and data structures with enough detail to prepare a useful reading guide.',
    } as Awaited<ReturnType<typeof generateText>>);
    const sections = [0, 1].map((id) => ({
      id,
      linear: 'yes',
      loadText: async () => '',
      loadImageBlob: async () => new Blob(['page image'], { type: 'image/png' }),
    }));
    const context = await buildLearningGuideContext({
      bookKey: 'scanned-pdf',
      metadata: { title: 'Scanned PDF', author: 'Author', language: 'en' },
      bookDoc: { ...makeBookDoc(), toc: [], sections } as unknown as BookDoc,
      costMode: 'conservative',
      aiSettings: {
        connections: [
          { id: 'vision', provider: 'openrouter', model: 'mock', supportsVision: true },
        ],
        notebookConnectionId: 'vision',
      } as Parameters<typeof buildLearningGuideContext>[0]['aiSettings'],
    });
    expect(context.status).toBe('grounded');
    expect(context.sourceText).toContain('Scanned page 1:');
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  test('scanned PDF without vision produces a preliminary guide context', async () => {
    const bookDoc = {
      ...makeBookDoc(),
      toc: [{ label: 'A long chapter title about algorithms and data structures'.repeat(8) }],
      sections: [
        { id: 0, linear: 'yes', loadText: async () => '', loadImageBlob: async () => new Blob() },
      ],
    } as unknown as BookDoc;
    const context = await buildLearningGuideContext({
      bookKey: 'outline-only-scan',
      metadata: { title: 'Scanned PDF', author: 'Author', language: 'en' },
      bookDoc,
      costMode: 'conservative',
    });
    expect(context.status).toBe('preliminary');
    expect(context.sourceKinds).toContain('toc');
    expect(context.sourceKinds).not.toContain('chapter');
    expect(context.sourceText).toContain('Scanned PDF');
  });

  test('PDF with a short cover uses later text pages without requiring vision', async () => {
    const sections = [0, 1].map((id) => ({
      id,
      linear: 'yes',
      loadText: async () =>
        id === 0 ? 'Cover' : 'This is a searchable chapter with enough text. '.repeat(12),
      loadImageBlob: async () => new Blob(),
    }));
    const context = await buildLearningGuideContext({
      bookKey: 'searchable-pdf',
      metadata: { title: 'Searchable PDF', author: 'Author', language: 'en' },
      bookDoc: { ...makeBookDoc(), toc: [], sections } as unknown as BookDoc,
      costMode: 'conservative',
    });
    expect(context.sourceText).toContain('Opening page 2:');
    expect(context.status).toBe('grounded');
  });

  test('selection context includes the selected block and two neighboring blocks per side', () => {
    const container = document.createElement('main');
    container.innerHTML = [
      '<p>First paragraph.</p>',
      '<p>Second paragraph.</p>',
      '<p>Selected paragraph with important text.</p>',
      '<p>Fourth paragraph.</p>',
      '<p>Fifth paragraph.</p>',
      '<p>Sixth paragraph must be excluded.</p>',
    ].join('');
    const selected = container.children[2]!.firstChild!;
    const range = document.createRange();
    range.setStart(selected, 0);
    range.setEnd(selected, selected.textContent!.length);

    const context = buildSelectionContext(range);

    expect(context.before).toEqual(['First paragraph.', 'Second paragraph.']);
    expect(context.selectedBlock).toBe('Selected paragraph with important text.');
    expect(context.after).toEqual(['Fourth paragraph.', 'Fifth paragraph.']);
    expect(JSON.stringify(context)).not.toContain('Sixth paragraph');
  });

  test('selection context falls back to empty context for a detached invalid range', () => {
    const range = document.createRange();
    range.detach();
    expect(buildSelectionContext(range)).toEqual({ before: [], selectedBlock: '', after: [] });
  });

  test('current page uses the visible progress range and records page/chapter metadata', async () => {
    const context = await buildCurrentPageContext(makeBookDoc(), null, makeProgress());
    expect(context.sourceText).toBe('Visible page text');
    expect(context.sourceText).not.toContain('outside');
    expect(context.pageNumber).toBe(12);
    expect(context.pageCfi).toBe('epubcfi(/6/2)');
    expect(context.chapterId).toBe('chapter-1.xhtml');
    expect(context.chapterTitle).toBe('Chapter One');
  });

  test('current page awaits asynchronous PDF TOC href resolution', async () => {
    const bookDoc = {
      ...makeBookDoc(),
      splitTOCHref: async () => [0, null],
    } as unknown as BookDoc;
    const context = await buildCurrentPageContext(bookDoc, null, makeProgress());
    expect(context.chapterId).toBe('0');
    const chapter = await buildCurrentChapterContext(bookDoc, null, makeProgress());
    expect(chapter.contextType).toBe('chapter');
    const identity = await getCurrentChapterIdentity(bookDoc, null, makeProgress());
    expect(identity.contextType).toBe('chapter');
  });

  test('current chapter loads the complete section and keeps the current page anchor', async () => {
    const context = await buildCurrentChapterContext(makeBookDoc(), null, makeProgress());
    expect(context.sourceText).toContain('Complete chapter text.');
    expect(context.contextType).toBe('chapter');
    expect(context.pageNumber).toBe(12);
    expect(context.chapterTitle).toBe('Chapter One');
    expect(context.sourceBlocks).toHaveLength(1);
    expect(context.sourceBlocks?.[0]).toMatchObject({
      id: 'notebook-assistant-0-0',
      text: expect.stringContaining('grounded passage'),
      cfi: expect.stringContaining('epubcfi('),
      endCfi: expect.stringContaining('epubcfi('),
    });
  });

  test('current chapter falls back to rendered text when section loading is not ready', async () => {
    const bookDoc = makeBookDoc();
    bookDoc.sections[0]!.loadText = async () => '';
    const renderedDoc = new DOMParser().parseFromString(
      '<main><p>Chapter text already visible in the reader.</p></main>',
      'text/html',
    );
    const view = {
      renderer: {
        primaryIndex: 0,
        getContents: () => [{ index: 0, doc: renderedDoc }],
      },
    };

    const context = await buildCurrentChapterContext(
      bookDoc,
      view as Parameters<typeof buildCurrentChapterContext>[1],
      makeProgress(),
    );

    expect(context.sourceText).toBe('Chapter text already visible in the reader.');
  });
});
