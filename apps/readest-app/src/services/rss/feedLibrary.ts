import type { AppService } from '@/types/system';
import { useFeedStore } from '@/store/feedStore';
import { eventDispatcher } from '@/utils/event';
import { stubTranslation as _ } from '@/utils/misc';

const loads = new WeakMap<AppService, Promise<void>>();

// The subscription outlives the Blogs view so writes cannot be lost on navigation.
export function ensureFeedsLoaded(appService: AppService): Promise<void> {
  const existing = loads.get(appService);
  if (existing) return existing;
  const load = appService
    .loadFeeds()
    .then((feeds) => {
      useFeedStore.getState().hydrate(feeds);
      let saving = Promise.resolve();
      useFeedStore.subscribe((state, previous) => {
        if (state.feeds === previous.feeds) return;
        const snapshot = state.feeds;
        saving = saving
          .then(() => appService.saveFeeds(snapshot))
          .catch((error: unknown) => {
            console.warn('Failed to save subscriptions', error);
            eventDispatcher.dispatch('toast', {
              type: 'error',
              message: _('Could not save subscriptions'),
            });
          });
      });
    })
    .catch((error: unknown) => {
      loads.delete(appService);
      throw error;
    });
  loads.set(appService, load);
  return load;
}
