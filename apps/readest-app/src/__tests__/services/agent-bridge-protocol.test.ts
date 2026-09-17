import { describe, expect, it } from 'vitest';
import { agentError, isAgentRpcRequest } from '@/services/agent-bridge/protocol';

describe('Lumen Agent protocol', () => {
  it('accepts and round-trips a JSON-RPC request', () => {
    const request = {
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'reader.search',
      params: { query: 'context' },
    };
    const parsed: unknown = JSON.parse(JSON.stringify(request));
    expect(isAgentRpcRequest(parsed)).toBe(true);
    expect(parsed).toEqual(request);
  });

  it('rejects malformed JSON-RPC values', () => {
    expect(isAgentRpcRequest(null)).toBe(false);
    expect(isAgentRpcRequest({ jsonrpc: '1.0', id: 1, method: 'system.health' })).toBe(false);
    expect(isAgentRpcRequest({ jsonrpc: '2.0', id: null, method: 'system.health' })).toBe(false);
  });

  it('creates stable structured errors', () => {
    expect(agentError('AUTH_REQUIRED', 'token required')).toEqual({
      code: 'AUTH_REQUIRED',
      message: 'token required',
      retryable: false,
    });
  });
});
