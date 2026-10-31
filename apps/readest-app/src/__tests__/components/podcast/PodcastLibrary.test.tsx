import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import PodcastLibrary from '@/app/podcasts/components/PodcastLibrary';
import { useFeedStore } from '@/store/feedStore';
import { usePodcastStore } from '@/store/podcastStore';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => ({ push, replace: push }) }));
vi.mock('@/hooks/useFeeds', () => ({
  useFeeds: () => ({ loaded: true, error: false, retry: vi.fn() }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div>{children}</div> : null,
}));
vi.mock('@/app/library/components/feeds/AddFeedModal', () => ({ default: () => null }));
vi.mock('@/services/podcast/openPodcast', () => ({
  podcastShowUrl: (id: string) => `/podcasts?feed=${id}`,
  podcastHash: (id: string) => id,
  podcastUrl: () => '/podcast',
  openPodcastSession: vi.fn(),
}));
vi.mock('@/services/tts/TTSSessionManager', () => ({
  ttsSessionManager: { getSessionByHash: vi.fn() },
}));

beforeEach(() => {
  push.mockClear();
  usePodcastStore.setState({ progress: {} });
  useFeedStore.getState().hydrate([
    {
      id: 'show',
      kind: 'podcast',
      title: 'A good show',
      author: 'Host',
      url: 'https://example.com/rss',
      addedAt: 0,
      lastFetchedAt: Date.now(),
      items: [],
    },
    {
      id: 'blog',
      kind: 'article',
      title: 'An article feed',
      url: 'https://example.com/blog',
      addedAt: 0,
      lastFetchedAt: Date.now(),
      items: [],
    },
  ]);
});
afterEach(cleanup);

describe('podcast shelf', () => {
  it('shows podcasts without article filters or inline destructive actions', () => {
    render(<PodcastLibrary feedId={null} />);
    expect(screen.getByRole('button', { name: 'A good show' })).toBeTruthy();
    expect(screen.queryByText('An article feed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Articles' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove feed' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /A good show/ }));
    expect(push).toHaveBeenCalledWith('/podcasts?feed=show');
  });

  it('gives empty subscriptions a podcast-specific starting action', () => {
    useFeedStore.getState().hydrate([]);
    render(<PodcastLibrary feedId={null} />);
    expect(screen.getByRole('button', { name: 'Add your first podcast' })).toBeTruthy();
    expect(screen.queryByText('No feeds yet.')).toBeNull();
  });
});
