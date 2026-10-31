import { beforeEach, describe, expect, it, vi } from 'vitest';

const { clock, manager } = vi.hoisted(() => {
  class Clock extends EventTarget {
    currentTime = 0;
    duration = 100;
    playbackRate = 1;
    paused = true;
    async load(_url: string, start: number) {
      this.currentTime = start;
    }
    async play() {
      this.paused = false;
    }
    pause() {
      this.paused = true;
    }
    destroy() {}
  }
  return {
    clock: new Clock(),
    manager: {
      getSessionByHash: vi.fn(),
      getActiveSession: vi.fn(),
      claim: vi.fn(),
      stopActive: vi.fn().mockResolvedValue(undefined),
    },
  };
});
vi.mock('@/services/audiobook/AudiobookClock', () => ({
  HtmlAudioClock: vi.fn(function () {
    return clock;
  }),
}));
vi.mock('@/services/tts/TTSSessionManager', () => ({ ttsSessionManager: manager }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/services/rss/feedGuardedFetch', () => ({ assertFetchAllowed: vi.fn() }));

import { openPodcastSession, podcastHash, podcastUrl } from '@/services/podcast/openPodcast';
import { usePodcastStore } from '@/store/podcastStore';
import type { RssFeed } from '@/types/rss';

const feed: RssFeed = {
  id: 'https://example.com/feed',
  url: 'https://example.com/feed',
  title: 'Show',
  addedAt: 0,
  items: [
    {
      id: 'episode',
      title: 'Episode',
      link: '',
      read: false,
      audio: { url: 'https://example.com/a.mp3', mimeType: 'audio/mpeg' },
    },
  ],
};
const item = feed.items[0]!;

beforeEach(() => {
  vi.clearAllMocks();
  manager.getSessionByHash.mockReturnValue(null);
  manager.getActiveSession.mockReturnValue(null);
  usePodcastStore.setState({ progress: {} });
  clock.currentTime = 0;
});

describe('RSS podcast playback sessions', () => {
  it('claims the shared slot with a podcast route and persists headless progress', async () => {
    usePodcastStore.getState().updateProgress(feed.id, item.id, 42, 100);
    const session = await openPodcastSession(feed, item);
    expect(manager.claim).toHaveBeenCalledWith(
      session.bookKey,
      session.controller,
      expect.objectContaining({ title: 'Episode', playbackUrl: podcastUrl(feed.id, item.id) }),
    );
    expect(session.bookKey.split('-')[0]).toBe(podcastHash(feed.id));
    await session.controller.start();
    expect(clock.currentTime).toBe(42);
    clock.currentTime = 55;
    await session.controller.pause();
    expect(usePodcastStore.getState().progress[feed.id]?.[item.id]?.positionSec).toBe(55);
    await session.controller.shutdown();
  });

  it('marks only natural completion as played and replays it from the start', async () => {
    const session = await openPodcastSession(feed, item);
    await session.controller.start();
    clock.currentTime = 100;
    clock.dispatchEvent(new Event('ended'));
    expect(usePodcastStore.getState().progress[feed.id]?.[item.id]?.finished).toBe(true);
    await session.controller.shutdown();
    const replay = await openPodcastSession(feed, item);
    await replay.controller.start();
    expect(clock.currentTime).toBe(0);
    await replay.controller.shutdown();
  });

  it('reuses the same episode instead of restarting it', async () => {
    const session = await openPodcastSession(feed, item);
    manager.getSessionByHash.mockReturnValue(session);
    expect(await openPodcastSession(feed, item)).toEqual(session);
    expect(manager.claim).toHaveBeenCalledTimes(1);
    await session.controller.shutdown();
  });

  it('finishes tearing down another source before claiming the slot', async () => {
    manager.getActiveSession.mockReturnValue({ bookHash: 'another-source' });
    const session = await openPodcastSession(feed, item);
    expect(manager.stopActive).toHaveBeenCalledWith('replaced');
    expect(manager.stopActive.mock.invocationCallOrder[0]).toBeLessThan(
      manager.claim.mock.invocationCallOrder[0]!,
    );
    await session.controller.shutdown();
  });
});
