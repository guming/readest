import { md5 } from 'js-md5';
import type { RssFeed, RssFeedItem } from '@/types/rss';
import { AudiobookController } from '@/services/audiobook/AudiobookController';
import { HtmlAudioClock } from '@/services/audiobook/AudiobookClock';
import { NativeAudiobookClock } from '@/services/audiobook/NativeAudiobookClock';
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
import { isTauriAppPlatform } from '@/services/environment';
import { assertFetchAllowed } from '@/services/rss/feedGuardedFetch';
import { usePodcastStore } from '@/store/podcastStore';
import { getOSPlatform, uniqueId } from '@/utils/misc';

export const podcastHash = (feedId: string): string => md5(`podcast:${feedId}`);
export const podcastUrl = (feedId: string, episodeId: string): string =>
  `/podcast?${new URLSearchParams({ feed: feedId, episode: episodeId })}`;
export const podcastShowUrl = (feedId: string): string =>
  `/podcasts?${new URLSearchParams({ feed: feedId })}`;

export async function openPodcastSession(feed: RssFeed, item: RssFeedItem) {
  if (!item.audio) throw new Error('No audio attachment');
  assertFetchAllowed(item.audio.url);
  const hash = podcastHash(feed.id);
  const existing = ttsSessionManager.getSessionByHash(hash);
  if (existing?.controller.kind === 'audiobook') {
    const controller = existing.controller as AudiobookController;
    if (controller.getEpisodeId() === item.id && !controller.terminated) {
      return { bookKey: existing.bookKey, controller };
    }
  }
  // Complete native teardown before loading a different episode into AVPlayer.
  if (ttsSessionManager.getActiveSession()) await ttsSessionManager.stopActive('replaced');
  const progress = usePodcastStore.getState().progress[feed.id]?.[item.id];
  const native = isTauriAppPlatform() && getOSPlatform() === 'ios';
  const clock = native ? new NativeAudiobookClock() : new HtmlAudioClock();
  const save = (position: number, finished = false) => {
    const duration = controller.getPlaybackInfo()?.duration ?? item.duration ?? 0;
    usePodcastStore.getState().updateProgress(feed.id, item.id, position, duration, finished);
  };
  const controller = new AudiobookController(
    {
      itemId: feed.id,
      episodeId: item.id,
      title: item.title,
      author: feed.author ?? feed.title,
      tracks: [
        {
          index: 0,
          startOffset: 0,
          duration: item.duration ?? progress?.durationSec ?? 0,
          contentUrl: item.audio.url,
          mimeType: item.audio.mimeType,
        },
      ],
      chapters: [],
      resolveUrl: (url) => url,
      startAt: progress?.finished ? 0 : (progress?.positionSec ?? 0),
    },
    clock,
    {
      onPlay: () => save(controller.getPlaybackInfo()?.position ?? 0),
      onTick: (position) => save(position),
      onPause: (position) => save(position),
      onSeek: (position) => save(position),
      onEnd: (position, reason) => {
        // Initial setup errors must not erase a previously saved resume point.
        if (reason === 'error' && position === 0) return;
        save(position, reason === 'ended');
      },
    },
  );
  const bookKey = `${hash}-${uniqueId()}`;
  ttsSessionManager.claim(bookKey, controller, {
    bookKey,
    title: item.title,
    author: feed.title,
    coverImageUrl: item.imageUrl ?? feed.iconUrl ?? null,
    metadataMode: 'chapter',
    ownsAudioFocus: native,
    playbackUrl: podcastUrl(feed.id, item.id),
  });
  return { bookKey, controller };
}
