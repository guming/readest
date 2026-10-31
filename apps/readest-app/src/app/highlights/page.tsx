'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { IoArrowBack } from 'react-icons/io5';
import { PiCopy, PiShareNetwork } from 'react-icons/pi';
import LibraryBookCover from '@/components/BookCover';
import NowPlayingBar from '@/app/library/components/NowPlayingBar';
import LibraryViewTabs from '@/components/LibraryViewTabs';
import { Toast } from '@/components/Toast';
import { useEnv } from '@/context/EnvContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useLibrary } from '@/hooks/useLibrary';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import type { Book, BookNote } from '@/types/book';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import { navigateToLibrary } from '@/utils/nav';
import { shareSelectedText } from '@/utils/share';

type HighlightGroup = { book: Book; notes: BookNote[] };

const BookCover = ({ book, large = false }: { book: Book; large?: boolean }) => (
  <span
    className={`eink-bordered bg-base-200 relative flex shrink-0 items-center justify-center overflow-hidden rounded border border-base-300 ${large ? 'h-28 w-20' : 'h-20 w-14'}`}
  >
    <LibraryBookCover book={book} mode='list' coverFit='crop' imageClassName='rounded' />
  </span>
);

const HighlightsContent = () => {
  const router = useAppRouter();
  const searchParams = useSearchParams();
  const bookHash = searchParams?.get('book');
  const { appService } = useEnv();
  const { libraryLoaded } = useLibrary();
  const books = useLibraryStore((state) => state.library);
  const settings = useSettingsStore((state) => state.settings);
  const setThemeScope = useThemeStore((state) => state.setThemeScope);
  const insets = useThemeStore((state) => state.safeAreaInsets);
  const headerRef = useRef<HTMLElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(headerRef);
  const _ = useTranslation();
  const [groups, setGroups] = useState<HighlightGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(20);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => setThemeScope('library'), [setThemeScope]);

  useEffect(() => {
    if (!libraryLoaded || !appService) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const available = books.filter(
        (book) => !book.deletedAt && (!bookHash || book.hash === bookHash),
      );
      const next: HighlightGroup[] = [];
      // Limit concurrent file reads on large libraries.
      for (let index = 0; index < available.length; index += 8) {
        const batch = await Promise.allSettled(
          available.slice(index, index + 8).map(async (book) => {
            const cached = useBookDataStore.getState().getConfig(book.hash);
            const config = cached ?? (await appService.loadBookConfig(book, settings));
            const notes = (config.booknotes ?? [])
              .filter(
                (note) => !note.deletedAt && note.type === 'annotation' && !!note.text?.trim(),
              )
              .sort((a, b) => b.createdAt - a.createdAt);
            return { book, notes };
          }),
        );
        next.push(
          ...batch
            .filter(
              (result): result is PromiseFulfilledResult<HighlightGroup> =>
                result.status === 'fulfilled',
            )
            .map((result) => result.value)
            .filter((group) => group.notes.length > 0),
        );
        if (cancelled) return;
      }
      if (!cancelled) {
        setGroups(next);
        setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [appService, bookHash, books, libraryLoaded, settings]);

  const selected = groups.find((group) => group.book.hash === bookHash);
  useEffect(() => setVisibleCount(20), [bookHash]);
  useEffect(() => {
    if (!selected || visibleCount >= selected.notes.length || !loadMoreRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisibleCount((count) => count + 20);
    });
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [selected, visibleCount]);
  const goBack = () => {
    if (bookHash) router.push('/highlights');
    else navigateToLibrary(router, undefined, undefined, true);
  };
  const copyHighlight = async (note: BookNote) => {
    const copied = await writeTextToClipboard(note.text ?? '');
    eventDispatcher.dispatch('toast', {
      type: copied ? 'info' : 'error',
      message: copied ? _('Copied to clipboard') : _('Failed to copy'),
      timeout: 2000,
    });
  };
  const shareHighlight = async (note: BookNote, book: Book) => {
    const page =
      note.page != null && note.page > 0 ? ` · ${_('Page {{number}}', { number: note.page })}` : '';
    const text = `${note.text}\n\n${book.title}${page}`;
    if (
      appService?.isMobileApp ||
      appService?.isMacOSApp ||
      typeof navigator.share === 'function'
    ) {
      await shareSelectedText(text, undefined, appService);
    } else {
      const copied = await writeTextToClipboard(text);
      eventDispatcher.dispatch('toast', {
        type: copied ? 'info' : 'error',
        message: copied ? _('Copied to clipboard') : _('Failed to copy'),
        timeout: 2000,
      });
    }
  };

  return (
    <main className='full-height bg-base-200 text-base-content flex flex-col overflow-hidden'>
      <header
        ref={headerRef}
        className={`titlebar bg-base-100 flex shrink-0 items-center gap-3 border-b border-base-300 py-3 pr-4 ${isTrafficLightVisible ? 'pl-24' : 'pl-4'}`}
        style={{ paddingTop: Math.max(12, insets?.top ?? 0) }}
      >
        {bookHash && (
          <button
            type='button'
            onClick={goBack}
            aria-label={_('Back')}
            className='exclude-title-bar-mousedown btn btn-ghost btn-square btn-sm'
          >
            <IoArrowBack size={20} />
          </button>
        )}
        <h1 className='min-w-0 truncate text-lg font-semibold'>
          {selected ? selected.book.title : _('Your Library')}
        </h1>
      </header>
      {!bookHash && (
        <LibraryViewTabs
          active='highlights'
          onPodcasts={() => router.push('/podcasts')}
          onBooks={() => navigateToLibrary(router, undefined, undefined, true)}
        />
      )}
      <div
        className='scroll-container min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6'
        style={{
          paddingBottom: `calc(${Math.max(20, insets?.bottom ?? 0)}px + var(--now-playing-inset, 0px))`,
        }}
      >
        <div className={bookHash ? 'mx-auto max-w-3xl space-y-3' : 'space-y-3'}>
          {loading ? (
            <p className='text-base-content/60 py-12 text-center'>{_('Loading highlights...')}</p>
          ) : bookHash && selected ? (
            <>
              <div className='mb-5 flex items-center gap-4'>
                <BookCover book={selected.book} />
                <div>
                  <h2 className='font-semibold'>{selected.book.title}</h2>
                  {selected.book.author && (
                    <p className='text-base-content/60 text-sm'>{selected.book.author}</p>
                  )}
                </div>
              </div>
              {selected.notes.slice(0, visibleCount).map((note) => (
                <article
                  key={note.id}
                  className='eink-bordered rounded-lg border border-base-content/15 border-l-2 border-l-primary/60 p-5'
                >
                  {note.page != null && note.page > 0 && (
                    <p className='text-base-content/55 mb-2 text-xs'>
                      {_('Page {{number}}', { number: note.page })}
                    </p>
                  )}
                  <p className='whitespace-pre-wrap break-words leading-relaxed'>{note.text}</p>
                  {note.note && (
                    <p className='text-base-content/65 mt-3 border-t border-base-300 pt-3 text-sm'>
                      {note.note}
                    </p>
                  )}
                  <div className='mt-4 flex justify-end gap-2 border-t border-base-content/10 pt-3'>
                    <button
                      type='button'
                      onClick={() => void copyHighlight(note)}
                      aria-label={_('Copy')}
                      className='eink-bordered text-base-content/70 hover:bg-base-300/40 flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs'
                    >
                      <PiCopy className='size-4' aria-hidden='true' />
                      {_('Copy')}
                    </button>
                    <button
                      type='button'
                      onClick={() => void shareHighlight(note, selected.book)}
                      aria-label={_('Share')}
                      className='eink-bordered text-base-content/70 hover:bg-base-300/40 flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs'
                    >
                      <PiShareNetwork className='size-4' aria-hidden='true' />
                      {_('Share')}
                    </button>
                  </div>
                </article>
              ))}
              {visibleCount < selected.notes.length && <div ref={loadMoreRef} className='h-1' />}
            </>
          ) : bookHash ? (
            <p className='text-base-content/60 py-12 text-center'>{_('No highlights found.')}</p>
          ) : groups.length ? (
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'>
              {groups.map(({ book, notes }) => (
                <button
                  key={book.hash}
                  type='button'
                  onClick={() => router.push(`/highlights?book=${encodeURIComponent(book.hash)}`)}
                  className='eink-bordered hover:bg-base-300/30 flex min-h-40 w-full items-start gap-4 rounded-lg border border-base-content/15 p-4 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
                >
                  <BookCover book={book} large />
                  <span className='flex min-w-0 flex-1 flex-col self-stretch'>
                    <span className='line-clamp-2 font-semibold leading-snug'>{book.title}</span>
                    {book.author && (
                      <span className='text-base-content/60 mt-1 block truncate text-xs'>
                        {book.author}
                      </span>
                    )}
                    <span className='text-base-content/70 mt-3 line-clamp-2 text-sm leading-relaxed'>
                      {notes[0]?.text}
                    </span>
                    <span className='text-base-content/50 mt-auto flex justify-between gap-2 pt-3 text-xs'>
                      <span>
                        {notes.length} {_('Highlights')}
                      </span>
                      {notes[0]?.page != null && notes[0].page > 0 && (
                        <span>{_('Page {{number}}', { number: notes[0].page })}</span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className='text-base-content/60 py-12 text-center'>{_('No highlights yet.')}</p>
          )}
        </div>
      </div>
      <NowPlayingBar isSelectMode={false} />
      <Toast />
    </main>
  );
};

export default function HighlightsPage() {
  return (
    <Suspense fallback={<div className='full-height' />}>
      <HighlightsContent />
    </Suspense>
  );
}
