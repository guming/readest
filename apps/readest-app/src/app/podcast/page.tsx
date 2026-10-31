'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import PlayerView from '@/app/player/components/PlayerView';
import { Toast } from '@/components/Toast';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useFeeds } from '@/hooks/useFeeds';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useFeedStore } from '@/store/feedStore';
import { openPodcastSession, podcastHash, podcastShowUrl } from '@/services/podcast/openPodcast';
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
import { eventDispatcher } from '@/utils/event';

type Session = Awaited<ReturnType<typeof openPodcastSession>>;

function PodcastContent() {
  const router = useAppRouter();
  const params = useSearchParams();
  const _ = useTranslation();
  const { loaded, error, retry } = useFeeds();
  const feedId = params?.get('feed') ?? '';
  const episodeId = params?.get('episode') ?? '';
  const feeds = useFeedStore((state) => state.feeds);
  const feed = feeds.find((entry) => entry.id === feedId);
  const item = feed?.items.find((entry) => entry.id === episodeId);
  const [session, setSession] = useState<Session | null>(null);
  const [failed, setFailed] = useState(false);
  const opening = useRef<{ key: string; promise: Promise<Session> } | null>(null);
  const insets = useThemeStore((state) => state.safeAreaInsets);
  useTheme({ systemUIVisible: false });
  const goBack = () => router.push(podcastShowUrl(feedId));
  useKeyDownActions({ onCancel: goBack });

  useEffect(() => {
    if (!loaded || !feed || !item?.audio) return;
    const key = JSON.stringify([feed.id, item.id]);
    if (opening.current?.key !== key) {
      opening.current = { key, promise: openPodcastSession(feed, item) };
    }
    let cancelled = false;
    setSession(null);
    setFailed(false);
    opening.current.promise
      .then((result) => {
        if (!cancelled) setSession(result);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // Subscription refreshes must not recreate an active playback session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, feedId, episodeId]);

  useEffect(() => {
    if (!session) return;
    const onChanged = (event: Event) => {
      if (
        ttsSessionManager.getSessionByHash(podcastHash(feedId))?.controller === session.controller
      )
        return;
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (
        reason === 'stopped' &&
        session.controller.terminated &&
        !session.controller.getPlaybackInfo()?.position
      ) {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Unable to play this episode'),
        });
      }
      router.replace(podcastShowUrl(feedId));
    };
    ttsSessionManager.addEventListener('session-changed', onChanged);
    return () => ttsSessionManager.removeEventListener('session-changed', onChanged);
  }, [session, feedId, router, _]);

  return (
    <main
      className='full-height bg-base-100 flex flex-col overflow-hidden'
      style={{ paddingTop: insets?.top ?? 0, paddingBottom: insets?.bottom ?? 0 }}
    >
      {session && feed && item ? (
        <PlayerView
          book={{
            hash: podcastHash(feed.id),
            title: feed.title,
            author: feed.author ?? '',
            coverImageUrl: item.imageUrl ?? feed.iconUrl,
          }}
          bookKey={session.bookKey}
          controller={session.controller}
          onGoBack={goBack}
          onBrowseEpisodes={goBack}
          onSelectEpisode={() => {}}
          pendingEpisodeId={null}
        />
      ) : error || failed || (loaded && !item?.audio) ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-4 p-4'>
          <p>{_('Unable to open this episode')}</p>
          {error && (
            <button type='button' className='btn btn-ghost eink-bordered' onClick={retry}>
              {_('Retry')}
            </button>
          )}
          <button type='button' className='btn btn-primary' onClick={goBack}>
            {_('Podcasts')}
          </button>
        </div>
      ) : (
        <div className='flex flex-1 items-center justify-center'>
          <span className='loading loading-spinner' />
        </div>
      )}
      <Toast />
    </main>
  );
}

export default function PodcastPage() {
  return (
    <Suspense fallback={<div className='full-height' />}>
      <PodcastContent />
    </Suspense>
  );
}
