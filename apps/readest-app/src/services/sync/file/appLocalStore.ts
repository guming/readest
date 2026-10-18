import { AppService } from '@/types/system';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { getCoverFilename, getLocalBookFilename } from '@/utils/book';
import { LocalStore } from './localStore';

// Discovery can prepare multiple remote books concurrently, while saving the
// library is a read-modify-write operation. Serialize those commits per app
// instance so concurrent providers cannot overwrite each other's new rows.
const libraryAddQueues = new WeakMap<AppService, Promise<void>>();
const serializeLibraryAdd = async (appService: AppService, work: () => Promise<void>) => {
  const previous = libraryAddQueues.get(appService) ?? Promise.resolve();
  const next = previous.then(work, work);
  libraryAddQueues.set(
    appService,
    next.catch(() => {}),
  );
  await next;
};

/**
 * The app-backed {@link LocalStore} used by every file-sync consumer (the
 * reader hook and the library "Sync now" form). Consolidating the buffered +
 * streaming book/cover loaders here is the whole reason the bridge exists:
 * the logic used to be copy-pasted across both consumers.
 *
 * In-place imports keep their bytes outside `Books/<hash>/`, so the book-file
 * helpers resolve to `(book.filePath, 'None')` when `filePath` is set and fall
 * through to the hash-copy `Books`-relative path otherwise — mirroring
 * `cloudService.uploadBook` so sync treats in-place books as first-class.
 */
export const createAppLocalStore = ({
  appService,
  settings,
  envConfig,
}: {
  appService: AppService;
  settings: SystemSettings;
  envConfig: EnvConfigType;
}): LocalStore => ({
  loadConfig: (book) => appService.loadBookConfig(book, settings),
  saveBookConfig: (book, config) => appService.saveBookConfig(book, config, settings),

  loadBookFile: async (book) => {
    const fp = book.filePath ?? getLocalBookFilename(book);
    const base = book.filePath ? 'None' : 'Books';
    if (!(await appService.exists(fp, base))) return null;
    const file = await appService.openFile(fp, base);
    const bytes = await file.arrayBuffer();
    return { bytes, size: bytes.byteLength };
  },

  resolveLocalBookPath: async (book) => {
    const fp = book.filePath ?? getLocalBookFilename(book);
    const base = book.filePath ? 'None' : 'Books';
    if (!(await appService.exists(fp, base))) return null;
    const file = await appService.openFile(fp, base);
    const size = file.size;
    // Release the FD before streaming so the Tauri side can re-open the path
    // for the PUT without contending.
    const closable = file as { close?: () => Promise<void> };
    if (closable.close) await closable.close();
    const path = await appService.resolveFilePath(fp, base);
    return { path, size };
  },

  saveBookFile: async (book, bytes) => {
    await appService.writeFile(getLocalBookFilename(book), 'Books', bytes);
  },

  prepareLocalBookPath: async (book) => {
    // The Rust downloader writes the file verbatim and does NOT create parent
    // dirs — make sure the per-hash folder under Books exists first.
    try {
      if (!(await appService.exists(book.hash, 'Books'))) {
        await appService.createDir(book.hash, 'Books', true);
      }
    } catch (e) {
      console.warn('createAppLocalStore: mkdir failed', book.hash, e);
    }
    return appService.resolveFilePath(getLocalBookFilename(book), 'Books');
  },

  loadBookCover: async (book) => {
    const fp = getCoverFilename(book);
    if (!(await appService.exists(fp, 'Books'))) return null;
    const file = await appService.openFile(fp, 'Books');
    const bytes = await file.arrayBuffer();
    return { bytes, size: bytes.byteLength };
  },

  saveBookCover: async (book, bytes) => {
    await appService.writeFile(getCoverFilename(book), 'Books', bytes);
  },

  addBookToLibrary: async (book) => {
    try {
      book.coverImageUrl = await appService.generateCoverImageUrl(book);
    } catch (e) {
      // Missing/broken cover shouldn't block adding the book — the bookshelf
      // renders a placeholder when coverImageUrl is empty.
      console.warn('createAppLocalStore: cover URL generation failed', book.hash, e);
      book.coverImageUrl = null;
    }
    book.syncedAt = Date.now();
    // The caller owns this state. Cloud-shelf discovery can create a remote
    // row without a local book file, so it must not be stamped as downloaded.
    if (!book.metaHash) book.metaHash = book.hash;
    // Hydrate from disk if the store hasn't loaded yet. Merging against an
    // empty in-memory array would persist this book as the *entire* library
    // and clobber whatever is on disk. Mirrors useLibraryStore.updateBooks'
    // hardening; the Sync-now caller also hydrates up front, so this is
    // belt-and-suspenders for a data-loss path.
    await serializeLibraryAdd(appService, async () => {
      let library = useLibraryStore.getState().library;
      if (!useLibraryStore.getState().libraryLoaded) {
        library = await appService.loadLibraryBooks();
        useLibraryStore.getState().setLibrary(library);
      }

      const existingIndex = library.findIndex((candidate) => candidate.hash === book.hash);
      if (existingIndex >= 0) {
        const existing = library[existingIndex]!;
        // A newer live row revives an older local tombstone. All other repeats
        // are idempotent and leave the current row untouched.
        if (
          !existing.deletedAt ||
          book.deletedAt ||
          (book.updatedAt ?? 0) <= (existing.deletedAt ?? 0)
        ) {
          return;
        }
      }

      const newLibrary =
        existingIndex >= 0
          ? [...library.slice(0, existingIndex), book, ...library.slice(existingIndex + 1)]
          : [...library, book];
      await appService.saveLibraryBooks(newLibrary);
      useLibraryStore.getState().setLibrary(newLibrary);
    });
  },

  updateBookMetadata: async (book) => {
    // The cover bytes were just refreshed via saveBookCover, so regenerate the
    // device-local blob URL the bookshelf renders.
    try {
      book.coverImageUrl = await appService.generateCoverImageUrl(book);
    } catch (e) {
      console.warn('createAppLocalStore: cover URL generation failed', book.hash, e);
    }
    book.syncedAt = Date.now();
    // Hydrate before updating: updateBook merges against the in-memory library,
    // so an unloaded store would persist an empty (or single-book) library and
    // clobber the disk. See the same guard in addBookToLibrary.
    if (!useLibraryStore.getState().libraryLoaded) {
      useLibraryStore.getState().setLibrary(await appService.loadLibraryBooks());
    }
    // updateBook persists via saveLibraryBooks and refreshes the store, so the
    // new title / author / cover show up without a reload.
    await useLibraryStore.getState().updateBook(envConfig, book);
  },

  deleteBookLocally: async (book) => {
    // Remove this device's managed copy of the book file (cloudService.deleteBook
    // with 'local' only ever touches app-managed Books/<hash>/ sources; an
    // in-place / external original is left untouched). The tombstone itself is
    // set by the engine before this call — we just persist it.
    try {
      await appService.deleteBook(book, 'local');
    } catch (e) {
      console.warn('createAppLocalStore: local book delete failed', book.hash, e);
    }
    book.coverImageUrl = null;
    book.syncedAt = Date.now();
    if (!useLibraryStore.getState().libraryLoaded) {
      useLibraryStore.getState().setLibrary(await appService.loadLibraryBooks());
    }
    await useLibraryStore.getState().updateBook(envConfig, book);
  },
});
