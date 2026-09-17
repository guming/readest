import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { isTauriAppPlatform } from '@/services/environment';
import type { AppService } from '@/types/system';
import type { AgentBridgeInfo, AgentRequestEnvelope } from './protocol';
import { createAgentRpcRouter, AgentRpcRouter } from './AgentRpcRouter';

interface NativeBridgeRequest {
  requestId: string;
  body: string;
  authorization?: string;
}

interface NativeEventSubscription {
  requestId: string;
  authorization?: string;
}

let router: AgentRpcRouter | null = null;
let unlisten: UnlistenFn | null = null;
let unlistenEventSubscription: UnlistenFn | null = null;
let bridgeInfo: AgentBridgeInfo | null = null;
let startPromise: Promise<AgentBridgeInfo | null> | null = null;
const bridgeListeners = new Set<(info: AgentBridgeInfo | null) => void>();

const notifyBridgeListeners = () => {
  for (const listener of bridgeListeners) listener(bridgeInfo);
};

export function subscribeAgentBridge(listener: (info: AgentBridgeInfo | null) => void): () => void {
  bridgeListeners.add(listener);
  listener(bridgeInfo);
  return () => bridgeListeners.delete(listener);
}

export async function startAgentBridge(appService: AppService): Promise<AgentBridgeInfo | null> {
  if (!isTauriAppPlatform() || appService.appPlatform !== 'tauri') return null;
  if (bridgeInfo) return bridgeInfo;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    router = createAgentRpcRouter(appService);
    try {
      unlisten = await listen<NativeBridgeRequest>('agent-bridge-request', async (event) => {
        const payload = event.payload;
        const envelope: AgentRequestEnvelope = {
          requestId: payload.requestId,
          body: payload.body,
          authorization: payload.authorization,
        };
        const response =
          (await router?.handle(envelope)) ??
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: 'BRIDGE_UNAVAILABLE',
              message: 'Agent Bridge is not ready',
              retryable: true,
            },
          });
        await invoke('agent_bridge_respond', { requestId: payload.requestId, response });
      });
      unlistenEventSubscription = await listen<NativeEventSubscription>(
        'agent-bridge-event-subscribe',
        async (event) => {
          const allowed = Boolean(
            event.payload.authorization &&
              (await router?.isAuthorized(event.payload.authorization)),
          );
          await invoke('agent_bridge_authorize_events', {
            requestId: event.payload.requestId,
            allowed,
          });
        },
      );
      bridgeInfo = await invoke<AgentBridgeInfo>('agent_bridge_start');
      notifyBridgeListeners();
      return bridgeInfo;
    } catch (error) {
      console.warn('Agent Bridge unavailable; continuing without it', error);
      await unlisten?.();
      await unlistenEventSubscription?.();
      unlisten = null;
      unlistenEventSubscription = null;
      router = null;
      bridgeInfo = null;
      notifyBridgeListeners();
      return null;
    }
  })();

  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

export async function createAgentPairingCode(): Promise<{
  code: string;
  expiresAt: number;
} | null> {
  return router?.createPairingCode() ?? null;
}

export async function resolveAgentApproval(
  agentId: string,
  approvalId: string,
  approved: boolean,
): Promise<unknown> {
  if (!router) throw new Error('Agent Bridge is not ready');
  return router.resolveApprovalLocally(agentId, approvalId, approved);
}

export async function resolveAgentPairing(requestId: string, approved: boolean): Promise<void> {
  if (!router) throw new Error('Agent Bridge is not ready');
  await router.resolvePairing(requestId, approved);
}

export async function stopAgentBridge(): Promise<void> {
  if (!bridgeInfo) return;
  await unlisten?.();
  await unlistenEventSubscription?.();
  unlisten = null;
  unlistenEventSubscription = null;
  router = null;
  bridgeInfo = null;
  notifyBridgeListeners();
  await invoke('agent_bridge_stop').catch((error: unknown) => {
    console.warn('Failed to stop Agent Bridge', error);
  });
}

export const getAgentBridgeInfo = (): AgentBridgeInfo | null => bridgeInfo;
