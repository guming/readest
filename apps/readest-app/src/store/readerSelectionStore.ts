import type { TextSelection } from '@/utils/sel';
import { publishAgentEvent } from '@/services/agent-bridge/AgentEventBridge';

const selections = new Map<string, TextSelection | null>();

export const getReaderSelection = (bookKey: string | null): TextSelection | null =>
  bookKey ? (selections.get(bookKey) ?? null) : null;

export const setReaderSelection = (bookKey: string, selection: TextSelection | null): void => {
  if (selection) selections.set(bookKey, selection);
  else selections.delete(bookKey);
  if (selection)
    publishAgentEvent('reading.selection_changed', bookKey.split('-')[0]!, {
      text: selection.text,
      cfi: selection.cfi,
    });
};
