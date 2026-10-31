import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { usePodcastStore } from '@/store/podcastStore';
import { PodcastEpisodes } from '@/app/library/components/feeds/PodcastEpisodes';
import LibraryViewTabs from '@/components/LibraryViewTabs';
import type { RssFeed } from '@/types/rss';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/components/Dialog', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div role='dialog'>{children}</div> : null,
}));
const feed: RssFeed = {
  id: 'show',
  url: 'https://example.com/rss',
  title: 'Show',
  addedAt: 0,
  items: [
    {
      id: 'a',
      title: 'Episode A',
      link: 'https://example.com/a',
      read: false,
      audio: { url: 'https://example.com/a.mp3', mimeType: 'audio/mpeg' },
      contentHtml: '<p>Show notes</p><script>alert(1)</script>',
    },
    { id: 'b', title: 'Episode B', link: '', read: false },
  ],
};
beforeEach(() => usePodcastStore.setState({ progress: {} }));
afterEach(cleanup);

describe('podcast subscription UI', () => {
  it('keeps the main navigation at Books, Highlights and Podcasts', () => {
    const onPodcasts = vi.fn();
    render(<LibraryViewTabs active='books' onPodcasts={onPodcasts} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Books',
      'Highlights',
      'Podcasts',
    ]);
    fireEvent.click(screen.getByText('Podcasts'));
    expect(onPodcasts).toHaveBeenCalledOnce();
  });

  it('opens sanitized show notes separately from playback', () => {
    const onPlay = vi.fn();
    render(<PodcastEpisodes feed={feed} onPlay={onPlay} pendingId={null} />);
    fireEvent.click(screen.getByText('Episode A'));
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog').querySelector('script')).toBeNull();
    expect(screen.getByText('Show notes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play: Episode A' }));
    expect(onPlay).toHaveBeenCalledWith(feed.items[0]);
    expect(
      (screen.getByRole('button', { name: 'Play: Episode B' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows continue listening only for unfinished audio episodes', () => {
    usePodcastStore.getState().updateProgress(feed.id, 'a', 42, 100);
    const onPlay = vi.fn();
    const { rerender } = render(<PodcastEpisodes feed={feed} onPlay={onPlay} pendingId={null} />);
    fireEvent.click(screen.getByRole('button', { name: /Continue listening/ }));
    expect(onPlay).toHaveBeenCalledWith(feed.items[0]);
    usePodcastStore.getState().updateProgress(feed.id, 'a', 100, 100, true);
    rerender(<PodcastEpisodes feed={feed} onPlay={onPlay} pendingId={null} />);
    expect(screen.queryByRole('button', { name: /Continue listening/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay: Episode A' })).toBeTruthy();
  });
});
