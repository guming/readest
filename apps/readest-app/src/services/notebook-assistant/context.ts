import type { BookDoc, SectionItem } from '@/libs/document';
import type { BookProgress } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { chunkSection } from '@/services/reedy/retrieval/CfiChunker';
import type { OneQuestionSourceBlock } from './types';

export interface NotebookAssistantContext {
  contextType: 'page' | 'chapter';
  sourceText: string;
  title: string;
  chapterId?: string;
  chapterTitle?: string;
  pageNumber?: number;
  pageCfi?: string;
  sourceBlocks?: OneQuestionSourceBlock[];
}

export interface SelectionReadingContext {
  before: string[];
  selectedBlock: string;
  after: string[];
}

const EMPTY_SELECTION_CONTEXT: SelectionReadingContext = {
  before: [],
  selectedBlock: '',
  after: [],
};

const SELECTION_BLOCK_SELECTOR =
  'p, li, blockquote, pre, td, th, figcaption, h1, h2, h3, h4, h5, h6';
const MAX_SELECTION_BLOCK_CHARS = 1_500;
const MAX_SELECTION_CONTEXT_CHARS = 6_000;

const boundedBlockText = (element: Element): string =>
  normalizeText(element.textContent || '').slice(0, MAX_SELECTION_BLOCK_CHARS);

export function buildSelectionContext(range: Range): SelectionReadingContext {
  try {
    const container = range.commonAncestorContainer;
    if (!container || range.collapsed) return { ...EMPTY_SELECTION_CONTEXT };
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const selectedElement = startElement?.closest(SELECTION_BLOCK_SELECTOR);
    const root = selectedElement?.parentElement;
    if (!selectedElement || !root) return { ...EMPTY_SELECTION_CONTEXT };
    const blocks = Array.from(root.querySelectorAll(SELECTION_BLOCK_SELECTOR)).filter(
      (element) => element.parentElement === root,
    );
    const index = blocks.indexOf(selectedElement);
    if (index < 0) return { ...EMPTY_SELECTION_CONTEXT };
    const before = blocks
      .slice(Math.max(0, index - 2), index)
      .map(boundedBlockText)
      .filter(Boolean);
    const selectedBlock = boundedBlockText(selectedElement);
    const after = blocks
      .slice(index + 1, index + 3)
      .map(boundedBlockText)
      .filter(Boolean);
    const result = { before, selectedBlock, after };
    if (JSON.stringify(result).length <= MAX_SELECTION_CONTEXT_CHARS) return result;
    return {
      before: before.map((text) => text.slice(0, 900)),
      selectedBlock: selectedBlock.slice(0, 1_500),
      after: after.map((text) => text.slice(0, 900)),
    };
  } catch {
    return { ...EMPTY_SELECTION_CONTEXT };
  }
}

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const textFromDocument = (doc: Document): string =>
  normalizeText(doc.body?.innerText || doc.body?.textContent || '');

const stripHtml = (html: string): string => {
  if (typeof DOMParser !== 'undefined') {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return textFromDocument(parsed);
  }
  return normalizeText(html.replace(/<[^>]+>/g, ' '));
};

const sectionIdFromHref = (bookDoc: BookDoc, href?: string): string | undefined => {
  if (!href) return undefined;
  const [sectionId] = bookDoc.splitTOCHref(href) as [string | undefined];
  return sectionId;
};

const findCurrentSection = (
  bookDoc: BookDoc,
  view: FoliateView | null,
  progress: BookProgress | null,
): SectionItem | undefined => {
  const primaryIndex = view?.renderer.primaryIndex;
  if (typeof primaryIndex === 'number' && bookDoc.sections[primaryIndex]) {
    return bookDoc.sections[primaryIndex];
  }
  const fromHref = sectionIdFromHref(bookDoc, progress?.sectionHref);
  if (fromHref) {
    const section = bookDoc.sections.find((item) => item.id === fromHref || item.href === fromHref);
    if (section) return section;
  }
  return bookDoc.sections[progress?.index ?? 0];
};

export async function buildCurrentPageContext(
  bookDoc: BookDoc,
  view: FoliateView | null,
  progress: BookProgress | null,
): Promise<NotebookAssistantContext> {
  const contents = view?.renderer.getContents() ?? [];
  const primaryIndex = view?.renderer.primaryIndex;
  const visible = contents.find((item) => item.index === primaryIndex) ?? contents[0];
  let sourceText = '';
  try {
    sourceText = normalizeText(progress?.range?.cloneContents().textContent || '');
  } catch {
    // A renderer relocate can invalidate the DOM Range between reads.
  }
  if (!sourceText) sourceText = visible ? textFromDocument(visible.doc) : '';
  return {
    contextType: 'page',
    sourceText,
    title: progress?.pageItem?.label || progress?.sectionLabel || 'Current Page',
    chapterId: sectionIdFromHref(bookDoc, progress?.sectionHref),
    chapterTitle: progress?.sectionLabel || undefined,
    pageNumber: progress?.page,
    pageCfi: progress?.location,
  };
}

export async function buildCurrentChapterContext(
  bookDoc: BookDoc,
  view: FoliateView | null,
  progress: BookProgress | null,
): Promise<NotebookAssistantContext> {
  const section = findCurrentSection(bookDoc, view, progress);
  let sourceText = '';
  if (section?.loadText) {
    try {
      sourceText = stripHtml((await section.loadText()) || '');
    } catch {
      // Some document backends cannot load the section text while the renderer is
      // still settling. The rendered document below is a valid fallback.
    }
  }
  if (!sourceText && view?.renderer.getContents) {
    const first = view.renderer.getContents()[0];
    sourceText = first ? textFromDocument(first.doc) : '';
  }
  let sourceBlocks: OneQuestionSourceBlock[] | undefined;
  if (section?.createDocument) {
    try {
      const sectionIndex = bookDoc.sections.indexOf(section);
      const doc = await section.createDocument();
      sourceBlocks = chunkSection(
        doc,
        Math.max(0, sectionIndex),
        progress?.sectionLabel || section.href || section.id,
        'notebook-assistant',
      ).map((chunk) => ({
        id: chunk.id,
        text: chunk.text,
        cfi: chunk.startCfi,
        endCfi: chunk.endCfi,
      }));
      if (sourceBlocks.length === 0) sourceBlocks = undefined;
    } catch {
      // CFI anchoring is a progressive enhancement; plain chapter context remains usable.
    }
  }
  return {
    contextType: 'chapter',
    sourceText,
    title: progress?.sectionLabel || section?.href || section?.id || 'Current Chapter',
    chapterId: section?.id || sectionIdFromHref(bookDoc, progress?.sectionHref),
    chapterTitle: progress?.sectionLabel || section?.href || section?.id || undefined,
    pageNumber: progress?.page,
    pageCfi: progress?.location,
    sourceBlocks,
  };
}
