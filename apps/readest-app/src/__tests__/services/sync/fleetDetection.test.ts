import { describe, test, expect, beforeEach, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import { checkMixedFleetOnce } from '@/services/sync/fleetDetection';
import type { SyncClient } from '@/libs/sync';

const translationFn = (key: string) => key;

const makeSyncClient = (books: unknown[] | null): SyncClient =>
  ({
    pullChanges: vi.fn(async () => ({ books, configs: null, notes: null })),
  }) as unknown as SyncClient;

const settingsWith = (patch: Partial<SystemSettings>): SystemSettings =>
  ({
    version: 1,
    webdav: { enabled: false },
    googleDrive: { enabled: false },
    ...patch,
  }) as SystemSettings;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkMixedFleetOnce', () => {
  test('no probe when local is the provider', async () => {
    const client = makeSyncClient([]);
    expect(await checkMixedFleetOnce(client, settingsWith({}), translationFn)).toBe(false);
    expect(client.pullChanges).not.toHaveBeenCalled();
  });

  test('no probe without a providerSelectedAt anchor', async () => {
    const client = makeSyncClient([]);
    const settings = settingsWith({ webdav: { enabled: true } } as Partial<SystemSettings>);
    expect(await checkMixedFleetOnce(client, settings, translationFn)).toBe(false);
    expect(client.pullChanges).not.toHaveBeenCalled();
  });

  test('does not probe account sync even with a selection anchor', async () => {
    const client = makeSyncClient([{ book_hash: 'h1' }]);
    const settings = settingsWith({
      webdav: { enabled: true, providerSelectedAt: 12345 },
    } as Partial<SystemSettings>);

    expect(await checkMixedFleetOnce(client, settings, translationFn)).toBe(false);
    expect(client.pullChanges).not.toHaveBeenCalled();
  });

  test('stays quiet across repeated calls', async () => {
    const client = makeSyncClient([{ book_hash: 'h1' }]);
    const settings = settingsWith({
      webdav: { enabled: true, providerSelectedAt: 12345 },
    } as Partial<SystemSettings>);

    await checkMixedFleetOnce(client, settings, translationFn);
    await checkMixedFleetOnce(client, settings, translationFn);

    expect(client.pullChanges).not.toHaveBeenCalled();
  });

  test('quiet when no newer rows exist', async () => {
    const client = makeSyncClient([]);
    const settings = settingsWith({
      webdav: { enabled: true, providerSelectedAt: 12345 },
    } as Partial<SystemSettings>);

    expect(await checkMixedFleetOnce(client, settings, translationFn)).toBe(false);
    expect(client.pullChanges).not.toHaveBeenCalled();
  });

  test('probe failures are silent (offline is not a fleet problem)', async () => {
    const client = {
      pullChanges: vi.fn(async () => {
        throw new Error('Not authenticated');
      }),
    } as unknown as SyncClient;
    const settings = settingsWith({
      webdav: { enabled: true, providerSelectedAt: 12345 },
    } as Partial<SystemSettings>);

    expect(await checkMixedFleetOnce(client, settings, translationFn)).toBe(false);
    expect(client.pullChanges).not.toHaveBeenCalled();
  });
});
