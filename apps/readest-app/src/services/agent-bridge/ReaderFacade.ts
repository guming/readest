import { BookDoc } from '@/libs/document';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { getBookProgress } from '@/store/readerProgressStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { ReedyBackend } from '@/services/ai/adapters/ReedyBackend';
import type { AppService } from '@/types/system';
import { getReaderSelection } from '@/store/readerSelectionStore';
import { BookNote } from '@/types/book';
import {
  AgentAnnotation,
  AgentScope,
  ReaderChapter,
  ReaderContext,
  ReaderSource,
} from './protocol';

const value = (input: unknown): string => {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input.join(', ');
  if (input && typeof input === 'object' && 'name' in input) return String(input.name);
  return input == null ? '' : String(input);
};

const hashOf = (bookKey: string): string => bookKey.split('-')[0]!;

export class ReaderFacade {
  constructor(private readonly appService?: AppService) {}

  getCurrentContext(scope: AgentScope = 'current_page'): ReaderContext {
    const bookKey = useSidebarStore.getState().sideBarBookKey;
    const bookHash = bookKey ? hashOf(bookKey) : null;
    const book = bookHash ? useLibraryStore.getState().getBookByHash(bookHash) : undefined;
    const data = bookHash ? useBookDataStore.getState().getBookData(bookHash) : null;
    const progress = bookKey ? getBookProgress(bookKey) : null;
    const selection = getReaderSelection(bookKey);
    const position = progress
      ? {
          cfi: progress.location,
          chapterTitle: progress.sectionLabel || null,
          sectionIndex: progress.index ?? null,
          page: progress.page ?? null,
          progress: progress.fraction ?? null,
        }
      : null;
    return {
      schemaVersion: 1,
      book:
        book && bookHash
          ? {
              bookHash,
              title: value(data?.bookDoc?.metadata.title ?? book.title),
              author: value(data?.bookDoc?.metadata.author ?? book.author),
              format: book.format,
            }
          : null,
      position,
      selection: selection?.cfi
        ? { text: selection.text, cfi: selection.cfi, endCfi: selection.cfi, page: selection.page }
        : null,
      scope: {
        mode: scope,
        spoilerBoundary: scope === 'read_so_far' ? 'current_position' : 'none',
      },
    };
  }

  listChapters(bookHash: string): ReaderChapter[] {
    const doc = this.bookDoc(bookHash);
    return (doc.toc ?? []).map((item, index) => ({
      chapterId: String(item.id ?? index),
      title: item.label,
      sectionIndex: item.index ?? index,
      startCfi: item.cfi ?? doc.sections[item.index ?? index]?.cfi ?? '',
    }));
  }

  async search(bookHash: string, query: string, scope: AgentScope): Promise<ReaderSource[]> {
    const aiSettings = useSettingsStore.getState().settings.aiSettings;
    if (aiSettings?.reedy?.enabled) {
      try {
        const progress = this.progressFor(bookHash);
        if (!this.appService) throw new Error('READER_NOT_READY');
        const result = await new ReedyBackend(this.appService, aiSettings).searchBook({
          bookHash,
          query,
          spoilerBoundPosition: scope === 'read_so_far' ? progress?.index : undefined,
        });
        if (result.status === 'not_indexed' || result.status === 'empty_index')
          throw new Error('BOOK_NOT_INDEXED');
        return result.passages.map((passage) => ({
          sourceId: passage.id,
          bookHash: passage.bookHash,
          chapterTitle: passage.chapterTitle ?? undefined,
          sectionIndex: passage.sectionIndex,
          startCfi: passage.cfi,
          endCfi: passage.endCfi,
          text: passage.text,
          score: passage.score,
          searchMethod: 'hybrid',
          scope,
        }));
      } catch (error) {
        if (error instanceof Error && error.message === 'BOOK_NOT_INDEXED') throw error;
      }
    }
    const doc = this.bookDoc(bookHash);
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    const progress = this.progressFor(bookHash);
    const sources: ReaderSource[] = [];
    for (let index = 0; index < doc.sections.length; index += 1) {
      if (scope === 'read_so_far' && progress && index > progress.index) break;
      const text = (await doc.sections[index]!.loadText?.()) ?? '';
      const offset = text.toLocaleLowerCase().indexOf(normalized);
      if (offset < 0) continue;
      const excerptStart = Math.max(0, offset - 240);
      const excerptEnd = Math.min(text.length, offset + query.length + 480);
      const excerpt = text.slice(excerptStart, excerptEnd).trim();
      const cfi = doc.sections[index]!.cfi;
      sources.push({
        sourceId: `${bookHash}:${index}:${offset}`,
        bookHash,
        chapterTitle: this.chapterTitle(doc, index),
        sectionIndex: index,
        startCfi: cfi,
        endCfi: cfi,
        text: excerpt,
        searchMethod: 'direct',
        scope,
      });
      if (sources.length >= 20) break;
    }
    return sources;
  }

  async getSource(bookHash: string, cfi: string): Promise<ReaderSource> {
    const doc = this.bookDoc(bookHash);
    const index = doc.sections.findIndex(
      (section) => cfi.startsWith(section.cfi) || section.cfi.startsWith(cfi),
    );
    if (index < 0) throw new Error('SOURCE_NOT_FOUND');
    const text = (await doc.sections[index]!.loadText?.()) ?? '';
    return {
      sourceId: `${bookHash}:${index}`,
      bookHash,
      chapterTitle: this.chapterTitle(doc, index),
      sectionIndex: index,
      startCfi: doc.sections[index]!.cfi,
      endCfi: doc.sections[index]!.cfi,
      text,
      searchMethod: 'direct',
      scope: 'book',
    };
  }

  listAnnotations(bookHash: string): AgentAnnotation[] {
    const notes = useBookDataStore.getState().getConfig(bookHash)?.booknotes ?? [];
    return notes.map((note: BookNote) => ({
      id: note.id,
      bookHash: note.bookHash ?? bookHash,
      type: note.type,
      cfi: note.cfi,
      endCfi: note.xpointer1,
      page: note.page,
      text: note.text,
      note: note.note,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      deletedAt: note.deletedAt,
    }));
  }

  private bookDoc(bookHash: string): BookDoc {
    const doc = useBookDataStore.getState().getBookData(bookHash)?.bookDoc;
    if (!doc) throw new Error('BOOK_NOT_OPEN');
    return doc;
  }

  private progressFor(bookHash: string) {
    const key = useReaderStore.getState().bookKeys.find((item) => hashOf(item) === bookHash);
    return key ? getBookProgress(key) : null;
  }

  private chapterTitle(doc: BookDoc, index: number): string | undefined {
    const item = (doc.toc ?? []).find((entry) => (entry.index ?? -1) === index);
    return item?.label;
  }
}
