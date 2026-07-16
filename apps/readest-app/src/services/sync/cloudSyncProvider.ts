import type { SystemSettings } from '@/types/settings';
import type { UserPlan } from '@/types/quota';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/**
 * The user's selected sync provider for library data (book files,
 * book rows, progress, notes). 'local' is the local-only default; the
 * others are third-party file-sync backends configured by the user.
 *
 * The selection is DERIVED from the existing per-device enabled flags —
 * there is no separate persisted field, so it inherits the device-local
 * semantics of `webdav.enabled` / `googleDrive.enabled` and needs no
 * migration. `withActiveCloudProvider` keeps the flags mutually
 * exclusive; if both are ever enabled (hand-edited or restored
 * settings), WebDAV wins deterministically.
 */
export type CloudSyncProviderKind = 'local' | FileSyncBackendKind;

export interface CloudSyncGate {
  provider: CloudSyncProviderKind;
  /**
   * Legacy status bit kept for older call sites. BYO storage providers are
   * local-first and do not depend on the user's Readest account or plan, so
   * current gates never pause third-party sync.
   */
  paused: boolean;
}

/** Settings slice key for a third-party backend kind. */
export const settingsKeyForBackend = (
  kind: FileSyncBackendKind,
): 'webdav' | 'googleDrive' | 's3' | 'onedrive' => (kind === 'gdrive' ? 'googleDrive' : kind);

/** Human-readable provider name (product names — deliberately untranslated). */
export const cloudProviderDisplayName = (kind: CloudSyncProviderKind): string =>
  kind === 'gdrive'
    ? 'Google Drive'
    : kind === 'webdav'
      ? 'WebDAV'
      : kind === 's3'
        ? 'S3'
        : kind === 'onedrive'
          ? 'OneDrive'
          : 'Local';

export const getCloudSyncProvider = (
  settings: SystemSettings | null | undefined,
): CloudSyncProviderKind =>
  settings?.webdav?.enabled
    ? 'webdav'
    : settings?.googleDrive?.enabled
      ? 'gdrive'
      : settings?.s3?.enabled
        ? 's3'
        : settings?.onedrive?.enabled
          ? 'onedrive'
          : 'local';

/** Cached for compatibility with older plan-aware call sites. */
let cachedUserPlan: UserPlan = 'free';

export const setCachedUserPlan = (plan: UserPlan | undefined): void => {
  cachedUserPlan = plan ?? 'free';
};

export const getCachedUserPlan = (): UserPlan => cachedUserPlan;

export const resolveCloudSyncGate = (
  settings: SystemSettings | null | undefined,
  _plan: UserPlan = cachedUserPlan,
): CloudSyncGate => {
  const provider = getCloudSyncProvider(settings);
  return { provider, paused: false };
};

/**
 * One-time upgrade migration helper (appService migrate20260706): users
 * who already had WebDAV/Drive enabled before provider selection shipped
 * become "third-party selected" on upgrade. With syncBooks at its old
 * `false` default their books would back up nowhere. Flip syncBooks on for the SELECTED
 * provider only. Mutates `settings` in place (the migration runner saves
 * the same snapshot afterwards) and returns whether anything changed.
 */
export const applySyncBooksAutoEnable = (settings: SystemSettings): boolean => {
  const provider = getCloudSyncProvider(settings);
  if (provider === 'webdav' && settings.webdav && !settings.webdav.syncBooks) {
    settings.webdav = { ...settings.webdav, syncBooks: true };
    return true;
  }
  if (provider === 'gdrive' && settings.googleDrive && !settings.googleDrive.syncBooks) {
    settings.googleDrive = { ...settings.googleDrive, syncBooks: true };
    return true;
  }
  if (provider === 'onedrive' && settings.onedrive && !settings.onedrive.syncBooks) {
    settings.onedrive = { ...settings.onedrive, syncBooks: true };
    return true;
  }
  return false;
};

/**
 * Whether Readest Cloud storage may be written to (book file uploads).
 * The local-first app no longer writes to Readest Cloud from the client.
 */
export const isReadestCloudStorageActive = (
  _settings: SystemSettings | null | undefined,
  _plan?: UserPlan,
): boolean => false;
