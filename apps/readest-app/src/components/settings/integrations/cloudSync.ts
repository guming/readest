/**
 * Re-export shim: the activation helpers moved to the services layer
 * (`src/services/sync/cloudSyncActivation.ts`) so service modules never
 * import from components. Existing component-side imports keep working.
 */
export {
  withActiveCloudProvider,
  persistActiveCloudProvider,
  type CloudSyncActivationKind,
} from '@/services/sync/cloudSyncActivation';
import { persistActiveCloudProvider } from '@/services/sync/cloudSyncActivation';
import type { EnvConfigType } from '@/services/environment';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

export const persistCloudProviderEnabled = (
  envConfig: EnvConfigType,
  kind: FileSyncBackendKind,
  enabled: boolean,
) => persistActiveCloudProvider(envConfig, enabled ? kind : null);
