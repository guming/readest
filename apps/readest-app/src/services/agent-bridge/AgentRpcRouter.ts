import { AgentDb, AgentActionRecord } from './AgentDb';
import {
  AGENT_PROTOCOL_VERSION,
  AgentCapabilities,
  AgentErrorCode,
  AgentRequestEnvelope,
  AgentRpcRequest,
  agentError,
  isAgentRpcRequest,
} from './protocol';
import { ReaderFacade } from './ReaderFacade';
import type { AppService } from '@/types/system';
import env from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { BookNote } from '@/types/book';
import { uniqueId } from '@/utils/misc';
import { agentEvents } from './AgentEventBus';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

type Pairing = { code: string; expiresAt: number };
type PendingPairing = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  params: Record<string, unknown>;
};

export class AgentRpcRouter {
  private dbPromise: Promise<AgentDb> | null = null;
  private readonly reader: ReaderFacade;
  private pairing: Pairing | null = null;
  private readonly pendingPairings = new Map<string, PendingPairing>();

  constructor(private readonly appService: AppService) {
    this.reader = new ReaderFacade(appService);
  }

  async createPairingCode(): Promise<{ code: string; expiresAt: number }> {
    const code = `${Math.floor(100000 + Math.random() * 900000)}`;
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.pairing = { code, expiresAt };
    return { code, expiresAt };
  }

  async isAuthorized(authorization?: string): Promise<boolean> {
    try {
      await this.authenticate(authorization);
      return true;
    } catch {
      return false;
    }
  }

  async handle(envelope: AgentRequestEnvelope): Promise<string> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(envelope.body);
    } catch {
      return JSON.stringify(
        this.failure(null, 'INVALID_REQUEST', 'request body is not valid JSON'),
      );
    }
    if (!isAgentRpcRequest(parsed)) {
      return JSON.stringify(this.failure(null, 'INVALID_REQUEST', 'invalid JSON-RPC request'));
    }
    const request = parsed;
    try {
      const result = await this.dispatch(request, envelope.authorization);
      return JSON.stringify({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) {
      const code =
        error instanceof Error && this.isErrorCode(error.message)
          ? error.message
          : 'INTERNAL_ERROR';
      const message = code === 'INTERNAL_ERROR' ? 'Agent request failed' : this.messageFor(code);
      return JSON.stringify(this.failure(request.id, code, message));
    }
  }

  private async dispatch(request: AgentRpcRequest, authorization?: string): Promise<unknown> {
    if (request.method === 'system.health') {
      return { ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, port: 0 };
    }
    if (request.method === 'system.create_pairing_code') return this.createPairingCode();
    if (request.method === 'system.pair') return this.pair(request.params);
    if (request.method === 'system.request_pairing') return this.requestPairing(request.params);

    const client = await this.authenticate(authorization);
    if (request.method === 'system.capabilities') return this.capabilities();
    if (request.method === 'system.disconnect') {
      return { disconnected: await (await this.db()).revokeClient(client.agentId) };
    }
    if (request.method === 'system.list_agents') return (await this.db()).listClients();
    if (request.method === 'system.revoke_agent') {
      const params = this.objectParams(request.params);
      await this.requirePermission(client.agentId, 'write', 'library', 'library');
      return { revoked: await (await this.db()).revokeClient(String(params['agentId'])) };
    }
    if (request.method === 'approval.list') return (await this.db()).listApprovals(client.agentId);
    if (request.method === 'approval.resolve') throw new Error('PERMISSION_DENIED');
    if (request.method === 'events.subscribe') {
      const cursor =
        typeof this.objectParams(request.params)['cursor'] === 'number'
          ? (this.objectParams(request.params)['cursor'] as number)
          : 0;
      const events = [];
      for (const event of agentEvents.since(cursor)) {
        if (
          !event.bookHash ||
          (await (await this.db()).hasGrant(client.agentId, 'book', event.bookHash, 'read'))
        )
          events.push(event);
      }
      return { events, nextCursor: events.at(-1)?.id ?? cursor };
    }
    if (request.method === 'action.cancel') {
      const actionId = String(this.objectParams(request.params)['actionId'] ?? '');
      const action = await (await this.db()).getAction(actionId);
      if (!action || action.agentId !== client.agentId) throw new Error('SOURCE_NOT_FOUND');
      if (action.status === 'pending_approval' || action.status === 'running') {
        await (await this.db()).updateAction(actionId, { status: 'cancelled' });
      }
      return { actionId, status: 'cancelled' };
    }
    if (request.method === 'artifacts.list')
      return (await this.db()).listArtifacts(
        client.agentId,
        this.bookHash(this.objectParams(request.params)['bookHash']) ?? undefined,
      );
    if (request.method === 'artifacts.get') {
      const artifact = await (await this.db()).getArtifact(
        client.agentId,
        String(this.objectParams(request.params)['artifactId'] ?? ''),
      );
      if (!artifact) throw new Error('SOURCE_NOT_FOUND');
      return artifact;
    }
    if (request.method === 'artifacts.delete')
      return {
        deleted: await (await this.db()).deleteArtifact(
          client.agentId,
          String(this.objectParams(request.params)['artifactId'] ?? ''),
        ),
      };
    if (request.method === 'artifacts.create')
      return this.createArtifact(client.agentId, request.params);

    const params = this.objectParams(request.params);
    const bookHash = this.bookHash(params['bookHash']);
    await this.requirePermission(
      client.agentId,
      'read',
      bookHash ? 'book' : 'current_book',
      bookHash ?? 'current',
    );
    const targetBookHash = bookHash ?? this.currentBookHash();
    const requestedScope = this.scope(params['scope']);
    if (requestedScope === 'selection') throw new Error('SELECTION_NOT_FOUND');
    if (request.method === 'reader.get_context')
      return this.reader.getCurrentContext(requestedScope);
    if (request.method === 'reader.list_chapters') return this.reader.listChapters(targetBookHash);
    if (request.method === 'reader.search') {
      const query = typeof params['query'] === 'string' ? params['query'] : '';
      return this.reader.search(targetBookHash, query, requestedScope);
    }
    if (request.method === 'reader.get_source') {
      if (typeof params['cfi'] !== 'string') throw new Error('SOURCE_NOT_FOUND');
      return this.reader.getSource(targetBookHash, params['cfi']);
    }
    if (request.method === 'annotations.list') return this.reader.listAnnotations(targetBookHash);
    if (request.method === 'reader.open') {
      await this.requirePermission(client.agentId, 'navigate', 'book', targetBookHash);
      const viewKey = useReaderStore
        .getState()
        .bookKeys.find((key) => key.split('-')[0] === targetBookHash);
      const view = useReaderStore.getState().getView(viewKey ?? targetBookHash);
      if (!view || typeof params['cfi'] !== 'string') throw new Error('READER_NOT_READY');
      await view.goTo(params['cfi']);
      return { navigated: true, cfi: params['cfi'] };
    }
    if (
      request.method === 'annotations.create_note' ||
      request.method === 'annotations.create_highlight'
    ) {
      await this.requirePermission(client.agentId, 'write', 'book', targetBookHash);
      return this.createApproval(client.agentId, request, targetBookHash);
    }
    throw new Error('INVALID_REQUEST');
  }

  private async createApproval(
    agentId: string,
    request: AgentRpcRequest,
    bookHash: string,
  ): Promise<unknown> {
    const params = this.objectParams(request.params);
    const actionId = crypto.randomUUID();
    const db = await this.db();
    if (typeof params['idempotencyKey'] === 'string') {
      const existing = await db.getActionByIdempotency(agentId, params['idempotencyKey']);
      if (existing) {
        return {
          actionId: existing.actionId,
          status: existing.status,
          preview: existing.previewJson ? (JSON.parse(existing.previewJson) as unknown) : undefined,
        };
      }
    }
    const action = await db.createAction({
      actionId,
      agentId,
      requestId: String(request.id),
      idempotencyKey:
        typeof params['idempotencyKey'] === 'string' ? params['idempotencyKey'] : undefined,
      method: request.method,
      bookHash,
      status: 'pending_approval',
      request,
    });
    const preview = {
      method: request.method,
      bookHash,
      cfi: params['cfi'],
      endCfi: params['endCfi'],
      quotedText: params['quotedText'],
      text: params['text'],
      note: params['note'],
    };
    await db.updateAction(action.actionId, { previewJson: JSON.stringify(preview) });
    await db.createApproval({
      approvalId: crypto.randomUUID(),
      actionId,
      agentId,
      preview,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    this.publishEvent('approval.required', { bookHash, data: { actionId, preview } });
    return { actionId, status: 'pending_approval', preview };
  }

  private async resolveApproval(agentId: string, raw: unknown): Promise<unknown> {
    const params = this.objectParams(raw);
    const approval = (await (await this.db()).listApprovals(agentId)).find(
      (item) => item.approvalId === String(params['approvalId'] ?? ''),
    );
    if (!approval) throw new Error('SOURCE_NOT_FOUND');
    const approved = params['approved'] === true;
    if (
      !(await (
        await this.db()
      ).resolveApproval(approval.approvalId, approved ? 'approved' : 'rejected'))
    )
      throw new Error('PERMISSION_DENIED');
    const action = await (await this.db()).getAction(approval.actionId);
    if (!action) throw new Error('SOURCE_NOT_FOUND');
    if (!approved) {
      await (await this.db()).updateAction(action.actionId, { status: 'cancelled' });
      return { actionId: action.actionId, status: 'cancelled' };
    }
    await (await this.db()).updateAction(action.actionId, { status: 'running' });
    let result: { id: string };
    try {
      result = await this.executeWrite(action);
    } catch (error) {
      await (await this.db()).updateAction(action.actionId, {
        status: 'failed',
        errorJson: JSON.stringify({
          message: error instanceof Error ? error.message : 'write failed',
        }),
      });
      this.publishEvent('action.failed', {
        bookHash: action.bookHash,
        data: { actionId: action.actionId },
      });
      throw error;
    }
    await (await this.db()).updateAction(action.actionId, {
      status: 'completed',
      resultJson: JSON.stringify(result),
    });
    this.publishEvent('action.completed', {
      bookHash: action.bookHash,
      data: { actionId: action.actionId, result },
    });
    return { actionId: action.actionId, status: 'completed', result };
  }

  private publishEvent(
    type: Parameters<typeof agentEvents.publish>[0],
    payload: Parameters<typeof agentEvents.publish>[1],
  ): void {
    const event = agentEvents.publish(type, payload);
    void invoke('agent_bridge_emit_event', { event: JSON.stringify(event) }).catch(() => undefined);
  }

  async resolveApprovalLocally(
    agentId: string,
    approvalId: string,
    approved: boolean,
  ): Promise<unknown> {
    return this.resolveApproval(agentId, { approvalId, approved });
  }

  private async executeWrite(action: AgentActionRecord): Promise<{ id: string }> {
    const request = JSON.parse(action.requestJson) as AgentRpcRequest;
    const params = this.objectParams(request.params);
    const bookHash = action.bookHash ?? this.currentBookHash();
    const cfi = typeof params['cfi'] === 'string' ? params['cfi'] : '';
    const quotedText = typeof params['quotedText'] === 'string' ? params['quotedText'] : '';
    const source = await this.reader.getSource(bookHash, cfi);
    if (quotedText && !source.text.includes(quotedText)) throw new Error('SOURCE_MISMATCH');
    const bookKey =
      useReaderStore.getState().bookKeys.find((key) => key.split('-')[0] === bookHash) ?? bookHash;
    const config = useBookDataStore.getState().getConfig(bookKey);
    if (!config) throw new Error('BOOK_NOT_OPEN');
    const now = Date.now();
    const note: BookNote = {
      id: uniqueId(),
      type: 'annotation',
      bookHash,
      cfi,
      xpointer1: typeof params['endCfi'] === 'string' ? params['endCfi'] : undefined,
      text: quotedText || undefined,
      note: typeof params['note'] === 'string' ? params['note'] : '',
      createdAt: now,
      updatedAt: now,
    };
    useReaderStore.getState().getView(bookKey)?.addAnnotation(note);
    await useBookDataStore
      .getState()
      .saveConfig(
        env,
        bookKey,
        { ...config, booknotes: [...(config.booknotes ?? []), note] },
        useSettingsStore.getState().settings,
      );
    return { id: note.id };
  }

  private async createArtifact(agentId: string, raw: unknown): Promise<unknown> {
    const params = this.objectParams(raw);
    const type = params['type'];
    if (
      type !== 'summary' &&
      type !== 'report' &&
      type !== 'question_set' &&
      type !== 'quote_collection'
    )
      throw new Error('INVALID_REQUEST');
    const bookHash = this.bookHash(params['bookHash']) ?? this.currentBookHash();
    await this.requirePermission(agentId, 'write', 'book', bookHash);
    if (typeof params['title'] !== 'string' || typeof params['contentMarkdown'] !== 'string')
      throw new Error('INVALID_REQUEST');
    const artifact = await (await this.db()).createArtifact({
      artifactId: crypto.randomUUID(),
      agentId,
      bookHash,
      type,
      title: params['title'],
      contentMarkdown: params['contentMarkdown'],
      sourceSnapshot: Array.isArray(params['sourceSnapshot'])
        ? (params['sourceSnapshot'] as never[])
        : [],
    });
    this.publishEvent('action.completed', {
      bookHash,
      data: { artifactId: artifact.artifactId, type: 'artifact.created' },
    });
    return artifact;
  }

  private async pair(raw: unknown): Promise<unknown> {
    const params = this.objectParams(raw);
    if (
      !this.pairing ||
      this.pairing.expiresAt <= Date.now() ||
      params['pairingCode'] !== this.pairing.code
    ) {
      throw new Error('PERMISSION_DENIED');
    }
    this.pairing = null;
    return this.createClient(params);
  }

  private async createClient(params: Record<string, unknown>): Promise<unknown> {
    const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    const agentId = crypto.randomUUID();
    const clientType =
      params['clientType'] === 'cli' || params['clientType'] === 'mcp'
        ? params['clientType']
        : 'custom';
    const db = await this.db();
    const client = await db.createClient({
      agentId,
      displayName:
        typeof params['displayName'] === 'string' ? params['displayName'] : 'External Agent',
      clientType,
      token,
    });
    await db.upsertGrant({
      id: crypto.randomUUID(),
      agentId,
      resourceType: 'current_book',
      resourceKey: 'current',
      permission: 'read',
    });
    return { agent: client, token, grants: await db.listGrants(agentId) };
  }

  private async requestPairing(raw: unknown): Promise<unknown> {
    const params = this.objectParams(raw);
    const requestId = crypto.randomUUID();
    const expiresAt = Date.now() + 120 * 1000;
    const pairing = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPairings.delete(requestId);
        reject(new Error('PERMISSION_DENIED'));
      }, 120 * 1000);
      this.pendingPairings.set(requestId, { resolve, reject, timer, params });
    });
    try {
      await emit('agent-pairing-request', {
        requestId,
        displayName:
          typeof params['displayName'] === 'string' ? params['displayName'] : 'Local MCP Agent',
        clientType: typeof params['clientType'] === 'string' ? params['clientType'] : 'mcp',
        permissions: ['read'],
        expiresAt,
      });
    } catch (error) {
      const pending = this.pendingPairings.get(requestId);
      if (pending) {
        this.pendingPairings.delete(requestId);
        clearTimeout(pending.timer);
        pending.reject(error);
      }
    }
    return pairing;
  }

  async resolvePairing(requestId: string, approved: boolean): Promise<void> {
    const pending = this.pendingPairings.get(requestId);
    if (!pending) throw new Error('SOURCE_NOT_FOUND');
    this.pendingPairings.delete(requestId);
    clearTimeout(pending.timer);
    if (!approved) {
      pending.reject(new Error('PERMISSION_DENIED'));
      return;
    }
    try {
      pending.resolve(await this.createClient(pending.params));
    } catch (error) {
      pending.reject(error);
    }
  }

  private capabilities(): AgentCapabilities {
    return {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      appVersion: process.env['NEXT_PUBLIC_APP_VERSION'] ?? 'development',
      platform: this.appService.appPlatform,
      capabilities: [
        { name: 'reader.get_context', permission: 'read', available: true },
        { name: 'reader.list_chapters', permission: 'read', available: true },
        { name: 'reader.search', permission: 'read', available: true },
        { name: 'reader.get_source', permission: 'read', available: true },
        { name: 'annotations.list', permission: 'read', available: true },
        { name: 'reader.open', permission: 'navigate', available: true },
        { name: 'annotations.create_note', permission: 'write', available: true },
        { name: 'annotations.create_highlight', permission: 'write', available: true },
        { name: 'artifacts.create', permission: 'write', available: true },
      ],
    };
  }

  private async authenticate(header?: string) {
    if (!header?.startsWith('Bearer ')) throw new Error('AUTH_REQUIRED');
    const client = await (await this.db()).findClientByToken(header.slice(7).trim());
    if (!client) throw new Error('AUTH_REQUIRED');
    if (client.revokedAt) throw new Error('AUTH_REVOKED');
    await (await this.db()).touchClient(client.agentId);
    return client;
  }

  private async requirePermission(
    agentId: string,
    permission: 'read' | 'navigate' | 'write' | 'bulk_write',
    type: 'book' | 'current_book' | 'library',
    key: string,
  ) {
    if (!(await this.db()).hasGrant(agentId, type, key, permission))
      throw new Error('PERMISSION_DENIED');
  }

  private async db(): Promise<AgentDb> {
    this.dbPromise ??= AgentDb.open(this.appService);
    return this.dbPromise;
  }

  private currentBookHash(): string {
    const context = this.reader.getCurrentContext('current_page');
    if (!context.book) throw new Error('BOOK_NOT_OPEN');
    return context.book.bookHash;
  }

  private bookHash(raw: unknown): string | null {
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  }

  private scope(raw: unknown) {
    return raw === 'selection' ||
      raw === 'current_page' ||
      raw === 'current_chapter' ||
      raw === 'read_so_far' ||
      raw === 'book'
      ? raw
      : ('current_page' as const);
  }

  private objectParams(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, unknown>;
  }

  private failure(id: string | number | null, code: AgentErrorCode, message: string) {
    return { jsonrpc: '2.0', id, error: agentError(code, message, code === 'BRIDGE_UNAVAILABLE') };
  }

  private isErrorCode(value: string): value is AgentErrorCode {
    return [
      'AUTH_REQUIRED',
      'AUTH_REVOKED',
      'PERMISSION_DENIED',
      'BOOK_NOT_OPEN',
      'BOOK_NOT_FOUND',
      'BOOK_NOT_INDEXED',
      'SELECTION_NOT_FOUND',
      'SOURCE_NOT_FOUND',
      'READER_NOT_READY',
      'PROTOCOL_UNSUPPORTED',
      'INVALID_REQUEST',
      'INTERNAL_ERROR',
      'BRIDGE_UNAVAILABLE',
    ].includes(value);
  }

  private messageFor(code: AgentErrorCode): string {
    return code === 'AUTH_REQUIRED'
      ? 'Agent token required'
      : code.replaceAll('_', ' ').toLowerCase();
  }
}

export const createAgentRpcRouter = (appService: AppService) => new AgentRpcRouter(appService);
