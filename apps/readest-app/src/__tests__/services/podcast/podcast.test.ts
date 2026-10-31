import { beforeEach, describe, expect, it } from 'vitest';
import { parseFeed } from '@/services/rss/feedParser';
import { useFeedStore } from '@/store/feedStore';
import { usePodcastStore } from '@/store/podcastStore';

const feedUrl = 'https://example.com/rss';
const xml = (url = '/episode.mp3', guid = '<guid>episode-1</guid>') => `
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
<title>Podcast</title><link>https://example.com</link><description>A show</description>
<itunes:author>Host</itunes:author><itunes:image href="/cover.jpg"/>
<item><title>Episode</title>${guid}<description>Show notes</description>
<enclosure url="${url}" type="audio/mpeg" length="12345"/>
<itunes:duration>1:02:03</itunes:duration></item></channel></rss>`;

describe('RSS podcast subscriptions', () => {
  beforeEach(() => {
    useFeedStore.getState().hydrate([]);
    usePodcastStore.setState({ progress: {} });
  });

  it('extracts audio and podcast metadata without requiring an episode web link', () => {
    const parsed = parseFeed(xml(), feedUrl);
    expect(parsed.kind).toBe('podcast');
    expect(parsed.author).toBe('Host');
    expect(parsed.iconUrl).toBe('https://example.com/cover.jpg');
    expect(parsed.items[0]).toMatchObject({
      id: 'episode-1',
      duration: 3723,
      audio: { url: 'https://example.com/episode.mp3', mimeType: 'audio/mpeg', byteLength: 12345 },
    });
  });

  it('uses audio URL as identity when GUID and web link are absent', () => {
    expect(parseFeed(xml('/episode.mp3', ''), feedUrl).items[0]?.id).toBe(
      'https://example.com/episode.mp3',
    );
  });

  it('rejects non-http media and handles absent or malformed durations', () => {
    const parsed = parseFeed(xml('javascript:alert(1)').replace('1:02:03', 'bad'), feedUrl);
    expect(parsed.items[0]?.audio).toBeUndefined();
    expect(parsed.items[0]?.duration).toBeUndefined();
    expect(parseFeed(xml().replace('1:02:03', '75'), feedUrl).items[0]?.duration).toBe(75);
    expect(
      parseFeed(xml().replace('<itunes:duration>1:02:03</itunes:duration>', ''), feedUrl).items[0]
        ?.duration,
    ).toBeUndefined();
  });

  it('keeps GUID progress when the enclosure changes on refresh', async () => {
    const feed = await useFeedStore
      .getState()
      .addFeed(feedUrl, async () => parseFeed(xml(), feedUrl));
    expect(feed.kind).toBe('podcast');
    usePodcastStore.getState().updateProgress(feed.id, 'episode-1', 42, 3723);
    await useFeedStore
      .getState()
      .refreshFeed(feed.id, async () => parseFeed(xml('/new.mp3'), feedUrl));
    expect(useFeedStore.getState().feeds[0]?.items[0]?.audio?.url).toBe(
      'https://example.com/new.mp3',
    );
    expect(usePodcastStore.getState().progress[feed.id]?.['episode-1']?.positionSec).toBe(42);
  });

  it('isolates progress between shows and removes only the unsubscribed show', () => {
    const store = usePodcastStore.getState();
    store.updateProgress('a', 'same-guid', 42, 100);
    store.updateProgress('b', 'same-guid', 8, 100);
    store.removeFeed('a');
    expect(usePodcastStore.getState().progress['a']).toBeUndefined();
    expect(usePodcastStore.getState().progress['b']?.['same-guid']?.positionSec).toBe(8);
  });
});
