import type { ReaderSource } from './protocol';

export type AgentEventType =
  | 'book.opened'
  | 'reading.position_changed'
  | 'reading.selection_changed'
  | 'annotation.created'
  | 'annotation.updated'
  | 'approval.required'
  | 'action.completed'
  | 'action.failed';

export interface AgentEvent {
  id: number;
  type: AgentEventType;
  bookHash?: string;
  payload?: unknown;
  createdAt: number;
}

class AgentEventBus {
  private nextId = 1;
  private readonly history: AgentEvent[] = [];
  publish(type: AgentEventType, payload?: { bookHash?: string; data?: unknown }): AgentEvent {
    const event: AgentEvent = {
      id: this.nextId++,
      type,
      bookHash: payload?.bookHash,
      payload: payload?.data,
      createdAt: Date.now(),
    };
    this.history.push(event);
    if (this.history.length > 200) this.history.shift();
    return event;
  }
  since(cursor = 0): AgentEvent[] {
    return this.history.filter((event) => event.id > cursor);
  }
}

export const agentEvents = new AgentEventBus();
export const snapshotSource = (source: ReaderSource): ReaderSource => ({ ...source });
