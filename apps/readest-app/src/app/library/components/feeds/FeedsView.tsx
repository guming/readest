'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MdAdd, MdDelete, MdRefresh, MdArrowBack } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useFeedStore } from '@/store/feedStore';
import { openFeedArticle, handleOpenArticle } from '@/services/rss/articleIngest';
import { navigateToReader } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { formatDate } from '@/utils/book';
import type { RssFeed, RssFeedItem } from '@/types/rss';
import AddFeedModal from './AddFeedModal';
import { PodcastEpisodes } from './PodcastEpisodes';
import { useFeeds } from '@/hooks/useFeeds';
import { usePodcastStore } from '@/store/podcastStore';
import { openPodcastSession, podcastHash, podcastUrl } from '@/services/podcast/openPodcast';
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';

interface FeedsViewProps {
  onClose: () => void;
  embedded?: boolean;
  initialFeedId?: string | null;
}

export function FeedsView({ onClose, embedded = false, initialFeedId }: FeedsViewProps) {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  const feeds = useFeedStore((s) => s.feeds);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(initialFeedId ?? null);
  const [filter, setFilter] = useState<'all' | 'article' | 'podcast'>('all');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const claiming = useRef(false);
  const progress = usePodcastStore((state) => state.progress);
  const { loaded, error, retry } = useFeeds();
  const [showAddModal, setShowAddModal] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  useEffect(() => {
    setSelectedFeedId(initialFeedId ?? null);
  }, [initialFeedId]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const refresh = async () => {
      const stale = useFeedStore
        .getState()
        .feeds.filter((feed) => Date.now() - (feed.lastFetchedAt ?? 0) > 15 * 60 * 1000);
      for (let index = 0; index < stale.length && !cancelled; index += 4) {
        await Promise.allSettled(
          stale.slice(index, index + 4).map((feed) => useFeedStore.getState().refreshFeed(feed.id)),
        );
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  const handlePlay = async (item: RssFeedItem, feed: RssFeed) => {
    if (claiming.current) return;
    claiming.current = true;
    setPendingId(item.id);
    try {
      const session = await openPodcastSession(feed, item);
      if (session.controller.state !== 'playing') void session.controller.start();
      router.push(podcastUrl(feed.id, item.id));
    } catch {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Unable to play this episode'),
      });
    } finally {
      claiming.current = false;
      setPendingId(null);
    }
  };

  const handleRefresh = async (feed: RssFeed) => {
    setRefreshing(feed.id);
    try {
      await useFeedStore.getState().refreshFeed(feed.id);
    } finally {
      setRefreshing(null);
    }
  };

  const handleRemove = async (id: string) => {
    if (ttsSessionManager.getSessionByHash(podcastHash(id)))
      await ttsSessionManager.stopActive('deleted');
    useFeedStore.getState().removeFeed(id);
    usePodcastStore.getState().removeFeed(id);
    if (selectedFeedId === id) setSelectedFeedId(null);
  };

  const handleOpenItem = async (item: RssFeedItem, feed: RssFeed) => {
    if (!appService) return;
    eventDispatcher.dispatch('toast', {
      type: 'info',
      message: _('Opening article…'),
      timeout: 2500,
    });
    await handleOpenArticle(
      {
        item,
        feed,
        books: useLibraryStore.getState().library,
        appService,
        settings,
        isLoggedIn: !!user,
        translate: _,
      },
      {
        openArticle: openFeedArticle,
        updateBooks: (books) => useLibraryStore.getState().updateBooks(envConfig, books),
        markRead: () => useFeedStore.getState().markItemRead(feed.id, item.id),
        navigate: (hash) => navigateToReader(router, [hash]),
        onError: (message) =>
          eventDispatcher.dispatch('toast', { type: 'error', message, timeout: 3500 }),
      },
    );
  };

  // Keep selectedFeed in sync when the store updates (refresh may add items).
  const liveFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;
  const visibleFeeds = feeds.filter(
    (feed) => filter === 'all' || (feed.kind ?? 'article') === filter,
  );

  const sortedItems = liveFeed
    ? [...liveFeed.items].sort((a, b) => {
        if (a.read !== b.read) return a.read ? 1 : -1;
        const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
        const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
        return db - da;
      })
    : [];

  const content = !loaded ? (
    <div className='px-4 py-8 text-center'>
      {error ? (
        <button type='button' className='btn btn-ghost eink-bordered' onClick={retry}>
          {_('Could not load subscriptions. Retry')}
        </button>
      ) : (
        <span className='loading loading-spinner' />
      )}
    </div>
  ) : (
    <div className='bg-base-100 relative flex flex-col overflow-y-auto pb-4'>
      {liveFeed ? (
        /* Article list */
        <div className='flex flex-col'>
          <button
            type='button'
            className='btn btn-ghost btn-sm mb-2 flex items-center gap-1 self-start'
            onClick={() => {
              setSelectedFeedId(null);
              if (embedded) router.replace('/podcasts');
            }}
            aria-label={_('Back to feed list')}
          >
            <MdArrowBack className='h-4 w-4' />
            {_('Feeds')}
          </button>
          {liveFeed.kind === 'podcast' ? (
            <PodcastEpisodes
              feed={liveFeed}
              onPlay={(item) => void handlePlay(item, liveFeed)}
              pendingId={pendingId}
            />
          ) : sortedItems.length === 0 ? (
            <p className='text-base-content/50 px-4 py-8 text-center text-sm'>
              {_('No articles in this feed.')}
            </p>
          ) : (
            <ul className='divide-base-200 divide-y'>
              {sortedItems.map((item) => (
                <li key={item.id}>
                  <button
                    type='button'
                    className={`hover:bg-base-200 w-full cursor-pointer px-4 py-3 text-start transition-colors ${item.read ? 'text-base-content/50' : ''}`}
                    onClick={() => void handleOpenItem(item, liveFeed)}
                  >
                    <div className='flex flex-col gap-1'>
                      <span
                        className={`text-sm leading-snug ${item.read ? 'font-normal' : 'font-medium'}`}
                      >
                        {item.title}
                      </span>
                      {item.publishedAt && (
                        <span className='text-base-content/40 text-xs'>
                          {formatDate(item.publishedAt)}
                        </span>
                      )}
                      {item.summary && (
                        <span className='text-base-content/60 line-clamp-2 text-xs leading-relaxed'>
                          {item.summary}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        /* Feed list */
        <div className='flex flex-col'>
          <div className='flex items-center justify-between px-4 py-2'>
            <span className='text-base-content/60 text-sm'>
              {feeds.length === 0 ? _('No feeds yet.') : ''}
            </span>
            <button
              type='button'
              className='btn btn-ghost btn-sm flex items-center gap-1'
              onClick={() => setShowAddModal(true)}
              aria-label={_('Add feed')}
            >
              <MdAdd className='h-4 w-4' />
              {_('Add feed')}
            </button>
          </div>
          <div className='flex flex-wrap gap-2 px-4 pb-3' aria-label={_('Filter subscriptions')}>
            {(['all', 'article', 'podcast'] as const).map((value) => (
              <button
                key={value}
                type='button'
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={`btn btn-sm eink-bordered ${filter === value ? 'btn-contrast' : 'btn-ghost'}`}
              >
                {value === 'all' ? _('All') : value === 'article' ? _('Articles') : _('Podcasts')}
              </button>
            ))}
          </div>
          {visibleFeeds.length === 0 ? (
            <p className='text-base-content/40 px-4 py-8 text-center text-sm'>
              {_('Subscribe to blogs and podcasts with an RSS URL.')}
            </p>
          ) : (
            <ul className='divide-base-200 divide-y'>
              {visibleFeeds.map((feed) => {
                const unread =
                  feed.kind === 'podcast'
                    ? feed.items.filter(
                        (item) => item.audio && !progress[feed.id]?.[item.id]?.finished,
                      ).length
                    : useFeedStore.getState().unreadCount(feed.id);
                return (
                  <li key={feed.id} className='flex flex-col'>
                    <div className='flex items-center gap-2 px-4 py-3'>
                      <button
                        type='button'
                        className='hover:bg-base-200 flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded text-start transition-colors'
                        onClick={() => {
                          setSelectedFeedId(feed.id);
                          if (embedded)
                            router.replace(`/podcasts?${new URLSearchParams({ feed: feed.id })}`);
                        }}
                      >
                        <div className='flex items-center gap-2'>
                          <span className='text-sm font-medium leading-snug'>{feed.title}</span>
                          {feed.kind === 'podcast' && (
                            <span className='text-base-content/60 text-xs'>{_('Podcast')}</span>
                          )}
                          {unread > 0 && (
                            <span className='badge badge-primary badge-sm shrink-0 text-xs'>
                              {unread}
                            </span>
                          )}
                        </div>
                        {feed.description && (
                          <span className='text-base-content/50 truncate text-xs'>
                            {feed.description}
                          </span>
                        )}
                      </button>
                      <div className='flex shrink-0 items-center gap-1'>
                        <button
                          type='button'
                          className='btn btn-ghost btn-xs'
                          aria-label={_('Refresh feed')}
                          title={_('Refresh')}
                          disabled={refreshing === feed.id}
                          onClick={() => void handleRefresh(feed)}
                        >
                          {refreshing === feed.id ? (
                            <span className='loading loading-spinner loading-xs' />
                          ) : (
                            <MdRefresh className='h-4 w-4' />
                          )}
                        </button>
                        <button
                          type='button'
                          className='btn btn-ghost btn-xs text-error'
                          aria-label={_('Remove feed')}
                          title={_('Remove')}
                          onClick={() => void handleRemove(feed.id)}
                        >
                          <MdDelete className='h-4 w-4' />
                        </button>
                      </div>
                    </div>
                    {feed.errorMessage && (
                      <p className='text-error px-4 pb-2 text-xs'>{feed.errorMessage}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {embedded ? (
        content
      ) : (
        <Dialog
          isOpen={true}
          title={liveFeed?.title ?? _('Feeds')}
          onClose={onClose}
          bgClassName='sm:!bg-black/75'
          boxClassName='sm:min-w-[520px] sm:w-3/4 sm:h-[85%] sm:!max-w-screen-sm'
        >
          {content}
        </Dialog>
      )}
      <AddFeedModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={(feed) => {
          setSelectedFeedId(feed.id);
          if (embedded) router.replace(`/podcasts?${new URLSearchParams({ feed: feed.id })}`);
        }}
      />
    </>
  );
}
