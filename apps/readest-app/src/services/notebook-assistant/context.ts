import type { BookDoc, SectionItem } from '@/libs/document';
import type { BookProgress } from '@/types/book';
import type { FoliateView } from '@/types/view';

export interface NotebookAssistantContext {
  contextType: 'page' | 'chapter';
  sourceText: string;
  title: string;
  chapterId?: string;
  chapterTitle?: string;
  pageNumber?: number;
  pageCfi?: string;
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
    sourceText = stripHtml((await section.loadText()) || '');
  } else if (view?.renderer.getContents) {
    const first = view.renderer.getContents()[0];
    sourceText = first ? textFromDocument(first.doc) : '';
  }
  return {
    contextType: 'chapter',
    sourceText,
    title: progress?.sectionLabel || section?.href || section?.id || 'Current Chapter',
    chapterId: section?.id || sectionIdFromHref(bookDoc, progress?.sectionHref),
    chapterTitle: progress?.sectionLabel || section?.href || section?.id || undefined,
    pageNumber: progress?.page,
    pageCfi: progress?.location,
  };
}
