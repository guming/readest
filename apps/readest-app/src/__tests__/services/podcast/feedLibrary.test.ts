import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFeedsLoaded } from '@/services/rss/feedLibrary';
import { useFeedStore } from '@/store/feedStore';
import type { AppService } from '@/types/system';

beforeEach(() => useFeedStore.getState().hydrate([]));

describe('subscription persistence outside the Blogs page', () => {
  it('hydrates once and keeps saving subsequent writes without a mounted view', async () => {
    const loadFeeds = vi.fn().mockResolvedValue([]);
    const saveFeeds = vi.fn().mockResolvedValue(undefined);
    const service = { loadFeeds, saveFeeds } as unknown as AppService;
    await Promise.all([ensureFeedsLoaded(service), ensureFeedsLoaded(service)]);
    expect(loadFeeds).toHaveBeenCalledTimes(1);
    await useFeedStore
      .getState()
      .addFeed('https://example.com/feed', async () => ({ title: 'Show', items: [] }));
    await vi.waitFor(() => expect(saveFeeds).toHaveBeenCalledTimes(1));
    await ensureFeedsLoaded(service);
    expect(useFeedStore.getState().feeds).toHaveLength(1);
    expect(loadFeeds).toHaveBeenCalledTimes(1);
  });

  it('allows retry after a load failure without overwriting stored subscriptions', async () => {
    const loadFeeds = vi
      .fn()
      .mockRejectedValueOnce(new Error('Disk unavailable'))
      .mockResolvedValue([]);
    const saveFeeds = vi.fn();
    const service = { loadFeeds, saveFeeds } as unknown as AppService;
    await expect(ensureFeedsLoaded(service)).rejects.toThrow('Disk unavailable');
    expect(saveFeeds).not.toHaveBeenCalled();
    await expect(ensureFeedsLoaded(service)).resolves.toBeUndefined();
    expect(loadFeeds).toHaveBeenCalledTimes(2);
  });
});
