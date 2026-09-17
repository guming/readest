import { invoke } from '@tauri-apps/api/core';
import { isTauriAppPlatform } from '@/services/environment';
import { agentEvents } from './AgentEventBus';
import type { AgentEventType } from './AgentEventBus';

export const publishAgentEvent = (type: AgentEventType, bookHash: string, data?: unknown): void => {
  const event = agentEvents.publish(type, { bookHash, data });
  if (isTauriAppPlatform()) {
    void invoke('agent_bridge_emit_event', { event: JSON.stringify(event) }).catch(() => undefined);
  }
};
