import type { SystemSettings } from '@/types/settings';
import type { TranslationFunc } from '@/hooks/useTranslation';
import type { SyncClient } from '@/libs/sync';

/**
 * Account sync is disabled in the local-first app. Mixed-fleet probing used
 * to read from the account sync API, so it is now a no-op even when a
 * user-owned sync storage provider is configured.
 */
export const checkMixedFleetOnce = async (
  _syncClient: SyncClient,
  _settings: SystemSettings,
  __: TranslationFunc,
): Promise<boolean> => {
  return false;
};
