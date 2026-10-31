'use client';

import { useEffect, useRef, useState } from 'react';
import { MdAdd, MdArrowBack, MdMoreHoriz, MdPodcasts, MdRefresh } from 'react-icons/md';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useFeeds } from '@/hooks/useFeeds';
import { useTranslation } from '@/hooks/useTranslation';
import { useFeedStore } from '@/store/feedStore';
import { usePodcastStore } from '@/store/podcastStore';
import {
  openPodcastSession,
  podcastHash,
  podcastShowUrl,
  podcastUrl,
} from '@/services/podcast/openPodcast';
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
import { eventDispatcher } from '@/utils/event';
import type { RssFeed, RssFeedItem } from '@/types/rss';
import Dialog from '@/components/Dialog';
import AddFeedModal from '@/app/library/components/feeds/AddFeedModal';
import { PodcastArtwork } from '@/app/library/components/feeds/PodcastArtwork';
import { PodcastEpisodes } from '@/app/library/components/feeds/PodcastEpisodes';

export default function PodcastLibrary({ feedId }: { feedId: string | null }) {
  const _ = useTranslation();
  const router = useAppRouter();
  const { loaded, error, retry } = useFeeds();
  const feeds = useFeedStore((state) => state.feeds);
  const progress = usePodcastStore((state) => state.progress);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const claiming = useRef(false);
  const shows = feeds.filter(
    (feed) => feed.kind === 'podcast' || feed.items.some((item) => item.audio),
  );
  const selected = shows.find((feed) => feed.id === feedId);

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

  const play = async (feed: RssFeed, item: RssFeedItem) => {
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

  const refresh = async () => {
    if (!selected || refreshing) return;
    setRefreshing(true);
    try {
      await useFeedStore.getState().refreshFeed(selected.id);
    } finally {
      setRefreshing(false);
    }
  };
  const remove = async () => {
    if (!selected || removing) return;
    setRemoving(true);
    try {
      if (ttsSessionManager.getSessionByHash(podcastHash(selected.id)))
        await ttsSessionManager.stopActive('deleted');
      useFeedStore.getState().removeFeed(selected.id);
      usePodcastStore.getState().removeFeed(selected.id);
      setManaging(false);
      router.replace('/podcasts');
    } finally {
      setRemoving(false);
    }
  };

  if (!loaded)
    return (
      <div className='flex min-h-64 items-center justify-center'>
        {error ? (
          <button type='button' className='btn btn-ghost eink-bordered' onClick={retry}>
            {_('Could not load subscriptions. Retry')}
          </button>
        ) : (
          <span className='loading loading-spinner loading-sm' />
        )}
      </div>
    );

  return (
    <>
      {selected ? (
        <>
          <div className='mb-7 flex items-center justify-between'>
            <button
              type='button'
              className='text-base-content/60 hover:text-base-content flex min-h-11 items-center gap-2 text-sm transition-colors'
              onClick={() => router.push('/podcasts')}
            >
              <MdArrowBack size={18} className='rtl:rotate-180' />
              {_('All shows')}
            </button>
            <button
              type='button'
              className='btn btn-ghost btn-circle'
              aria-label={_('Manage subscription')}
              onClick={() => setManaging(true)}
            >
              <MdMoreHoriz size={24} />
            </button>
          </div>
          {selected.errorMessage && (
            <p role='alert' className='text-error mb-4 text-sm'>
              {selected.errorMessage}
            </p>
          )}
          <PodcastEpisodes
            feed={selected}
            onPlay={(item) => void play(selected, item)}
            pendingId={pendingId}
          />
        </>
      ) : (
        <>
          <div className='mb-8 flex items-center justify-between gap-4'>
            <div>
              <h2 className='text-2xl font-semibold tracking-tight'>{_('Your shows')}</h2>
              <p className='text-base-content/50 mt-1 text-sm'>
                {_('A little more listening, a little more discovery.')}
              </p>
            </div>
            <button
              type='button'
              className='btn btn-contrast eink-bordered h-10 min-h-10 shrink-0 gap-1.5 rounded-full px-4 text-sm'
              onClick={() => setAdding(true)}
            >
              <MdAdd size={20} />
              <span>{_('Add podcast')}</span>
            </button>
          </div>
          {shows.length === 0 ? (
            <div className='flex min-h-80 flex-col items-center justify-center px-6 text-center'>
              <div className='eink-bordered bg-base-200 mb-6 flex h-20 w-20 items-center justify-center rounded-3xl'>
                <MdPodcasts size={36} className='text-base-content/50' />
              </div>
              <h3 className='text-xl font-semibold'>{_('Make room for a good conversation.')}</h3>
              <p className='text-base-content/55 mt-3 max-w-xs text-sm leading-relaxed'>
                {_('Add a podcast RSS link. Your next listen will be waiting here.')}
              </p>
              <button
                type='button'
                className='btn btn-primary mt-6 rounded-full px-6'
                onClick={() => setAdding(true)}
              >
                {_('Add your first podcast')}
              </button>
            </div>
          ) : (
            <div className='grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4'>
              {shows.map((feed) => {
                const unfinished = feed.items.filter(
                  (item) => item.audio && !progress[feed.id]?.[item.id]?.finished,
                ).length;
                return (
                  <button
                    key={feed.id}
                    type='button'
                    aria-label={feed.title}
                    className='group min-w-0 text-start'
                    onClick={() => router.push(podcastShowUrl(feed.id))}
                  >
                    <PodcastArtwork src={feed.iconUrl} title={feed.title} className='w-full' />
                    <h3 className='mt-3 line-clamp-2 text-sm font-semibold leading-snug sm:text-base'>
                      {feed.title}
                    </h3>
                    <p className='text-base-content/50 mt-1 truncate text-xs sm:text-sm'>
                      {feed.author || _('Podcast')}
                    </p>
                    <span className='text-base-content/45 mt-1.5 block text-xs'>
                      {_('{{count}} unplayed', { count: unfinished })}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      <AddFeedModal
        isOpen={adding}
        podcastOnly
        onClose={() => setAdding(false)}
        onAdded={(feed) => router.push(podcastShowUrl(feed.id))}
      />
      <Dialog
        isOpen={managing && !!selected}
        title={_('Manage subscription')}
        snapHeight={0.4}
        onClose={() => setManaging(false)}
      >
        {selected && (
          <div className='flex flex-col gap-3 pb-5'>
            <p className='font-medium'>{selected.title}</p>
            <button
              type='button'
              disabled={refreshing}
              onClick={() => void refresh()}
              className='eink-bordered bg-base-200 flex min-h-12 items-center gap-3 rounded-xl px-4 text-start text-sm'
            >
              <MdRefresh size={20} />
              {refreshing ? _('Refreshing…') : _('Refresh feed')}
            </button>
            <p className='text-base-content/55 mt-3 text-xs leading-relaxed'>
              {_('Unsubscribing removes this show and its listening history from this device.')}
            </p>
            <button
              type='button'
              disabled={removing}
              onClick={() => void remove()}
              className='eink-bordered text-error flex min-h-12 items-center rounded-xl border border-base-300 px-4 text-start text-sm'
            >
              {_('Unsubscribe')}
            </button>
          </div>
        )}
      </Dialog>
    </>
  );
}
