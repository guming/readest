import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import type { AgentApproval, ReadingArtifact } from './protocol';

export type AgentClientType = 'mcp' | 'cli' | 'custom';
export type AgentGrantPermission = 'read' | 'navigate' | 'write' | 'bulk_write';
export type AgentGrantResource = 'current_book' | 'book' | 'library';
export type AgentActionStatus =
  | 'pending_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentClient {
  agentId: string;
  displayName: string;
  clientType: AgentClientType;
  createdAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
  protocolVersion: number;
}

export interface AgentGrant {
  id: string;
  agentId: string;
  resourceType: AgentGrantResource;
  resourceKey: string;
  permission: AgentGrantPermission;
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
}

export interface AgentActionRecord {
  actionId: string;
  agentId: string;
  requestId: string;
  idempotencyKey?: string;
  method: string;
  bookHash?: string;
  status: AgentActionStatus;
  requestJson: string;
  previewJson?: string;
  resultJson?: string;
  errorJson?: string;
  createdAt: number;
  updatedAt: number;
}

interface ApprovalRow {
  approval_id: string;
  action_id: string;
  status: string;
  preview_json: string;
  expires_at: number;
  [key: string]: unknown;
}
interface ArtifactRow {
  artifact_id: string;
  agent_id: string;
  book_hash: string;
  artifact_type: string;
  title: string;
  content_markdown: string;
  source_snapshot_json: string;
  status: string;
  created_at: number;
  updated_at: number;
  [key: string]: unknown;
}

interface ClientRow {
  agent_id: string;
  display_name: string;
  client_type: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
  protocol_version: number;
  [key: string]: unknown;
}

interface GrantRow {
  id: string;
  agent_id: string;
  resource_type: AgentGrantResource;
  resource_key: string;
  permission: AgentGrantPermission;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  [key: string]: unknown;
}

interface ActionRow {
  action_id: string;
  agent_id: string;
  request_id: string;
  idempotency_key: string | null;
  method: string;
  book_hash: string | null;
  status: AgentActionStatus;
  request_json: string;
  preview_json: string | null;
  result_json: string | null;
  error_json: string | null;
  created_at: number;
  updated_at: number;
  [key: string]: unknown;
}

export class AgentDb {
  private constructor(private readonly db: DatabaseService) {}

  static async open(appService: AppService): Promise<AgentDb> {
    const db = await appService.openDatabase('agent', 'agent.db', 'Data');
    return new AgentDb(db);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async createClient(args: {
    agentId: string;
    displayName: string;
    clientType: AgentClientType;
    token: string;
    now?: number;
  }): Promise<AgentClient> {
    const now = args.now ?? Date.now();
    await this.db.execute(
      `INSERT INTO agent_clients
       (agent_id, display_name, client_type, token_hash, created_at, protocol_version)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [args.agentId, args.displayName, args.clientType, await hashToken(args.token), now],
    );
    const client = await this.getClient(args.agentId);
    if (!client) throw new Error(`AgentDb: client disappeared after create: ${args.agentId}`);
    return client;
  }

  async getClient(agentId: string): Promise<AgentClient | null> {
    const rows = await this.db.select<ClientRow>(
      'SELECT agent_id, display_name, client_type, created_at, last_seen_at, revoked_at, protocol_version FROM agent_clients WHERE agent_id = ?',
      [agentId],
    );
    return rows[0] ? toClient(rows[0]) : null;
  }

  async findClientByToken(token: string): Promise<AgentClient | null> {
    const rows = await this.db.select<ClientRow>(
      `SELECT agent_id, display_name, client_type, created_at, last_seen_at, revoked_at, protocol_version
       FROM agent_clients WHERE token_hash = ?`,
      [await hashToken(token)],
    );
    return rows[0] ? toClient(rows[0]) : null;
  }

  async touchClient(agentId: string, now = Date.now()): Promise<void> {
    await this.db.execute('UPDATE agent_clients SET last_seen_at = ? WHERE agent_id = ?', [
      now,
      agentId,
    ]);
  }

  async revokeClient(agentId: string, now = Date.now()): Promise<boolean> {
    const result = await this.db.execute(
      'UPDATE agent_clients SET revoked_at = ? WHERE agent_id = ? AND revoked_at IS NULL',
      [now, agentId],
    );
    return result.rowsAffected > 0;
  }

  async expireAllClients(now = Date.now()): Promise<void> {
    await this.db.execute('UPDATE agent_clients SET revoked_at = ? WHERE revoked_at IS NULL', [
      now,
    ]);
  }

  async listClients(): Promise<AgentClient[]> {
    const rows = await this.db.select<ClientRow>(
      'SELECT agent_id, display_name, client_type, created_at, last_seen_at, revoked_at, protocol_version FROM agent_clients ORDER BY created_at DESC',
    );
    return rows.map(toClient);
  }

  async upsertGrant(args: Omit<AgentGrant, 'createdAt'> & { createdAt?: number }): Promise<void> {
    await this.db.execute(
      `INSERT INTO agent_grants
       (id, agent_id, resource_type, resource_key, permission, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(agent_id, resource_type, resource_key, permission) DO UPDATE SET
         expires_at = excluded.expires_at,
         revoked_at = excluded.revoked_at`,
      [
        args.id,
        args.agentId,
        args.resourceType,
        args.resourceKey,
        args.permission,
        args.createdAt ?? Date.now(),
        args.expiresAt ?? null,
        args.revokedAt ?? null,
      ],
    );
  }

  async listGrants(agentId: string): Promise<AgentGrant[]> {
    const rows = await this.db.select<GrantRow>(
      'SELECT * FROM agent_grants WHERE agent_id = ? ORDER BY created_at DESC',
      [agentId],
    );
    return rows.map(toGrant);
  }

  async hasGrant(
    agentId: string,
    resourceType: AgentGrantResource,
    resourceKey: string,
    permission: AgentGrantPermission,
    now = Date.now(),
  ): Promise<boolean> {
    const rows = await this.db.select<{ id: string; [key: string]: unknown }>(
      `SELECT id FROM agent_grants
       WHERE agent_id = ? AND resource_type = ? AND resource_key = ?
         AND permission = ? AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`,
      [agentId, resourceType, resourceKey, permission, now],
    );
    return rows.length > 0;
  }

  async revokeGrant(
    agentId: string,
    resourceType: AgentGrantResource,
    resourceKey: string,
    permission: AgentGrantPermission,
    now = Date.now(),
  ): Promise<boolean> {
    const result = await this.db.execute(
      'UPDATE agent_grants SET revoked_at = ? WHERE agent_id = ? AND resource_type = ? AND resource_key = ? AND permission = ? AND revoked_at IS NULL',
      [now, agentId, resourceType, resourceKey, permission],
    );
    return result.rowsAffected > 0;
  }

  async getActionByIdempotency(
    agentId: string,
    idempotencyKey: string,
  ): Promise<AgentActionRecord | null> {
    const rows = await this.db.select<ActionRow>(
      'SELECT * FROM agent_actions WHERE agent_id = ? AND idempotency_key = ?',
      [agentId, idempotencyKey],
    );
    return rows[0] ? toAction(rows[0]) : null;
  }

  async createAction(args: {
    actionId: string;
    agentId: string;
    requestId: string;
    idempotencyKey?: string;
    method: string;
    bookHash?: string;
    status: AgentActionStatus;
    request: unknown;
    now?: number;
  }): Promise<AgentActionRecord> {
    const now = args.now ?? Date.now();
    await this.db.execute(
      `INSERT INTO agent_actions
       (action_id, agent_id, request_id, idempotency_key, method, book_hash, status, request_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.actionId,
        args.agentId,
        args.requestId,
        args.idempotencyKey ?? null,
        args.method,
        args.bookHash ?? null,
        args.status,
        JSON.stringify(args.request),
        now,
        now,
      ],
    );
    const action = await this.getAction(args.actionId);
    if (!action) throw new Error(`AgentDb: action disappeared after create: ${args.actionId}`);
    return action;
  }

  async getAction(actionId: string): Promise<AgentActionRecord | null> {
    const rows = await this.db.select<ActionRow>(
      'SELECT * FROM agent_actions WHERE action_id = ?',
      [actionId],
    );
    return rows[0] ? toAction(rows[0]) : null;
  }

  async updateAction(
    actionId: string,
    updates: Partial<
      Pick<AgentActionRecord, 'status' | 'previewJson' | 'resultJson' | 'errorJson'>
    >,
  ): Promise<void> {
    const values: unknown[] = [];
    const sets: string[] = [];
    const fields: Array<[keyof typeof updates, string]> = [
      ['status', 'status'],
      ['previewJson', 'preview_json'],
      ['resultJson', 'result_json'],
      ['errorJson', 'error_json'],
    ];
    for (const [key, column] of fields) {
      if (updates[key] === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(updates[key] ?? null);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(Date.now(), actionId);
    await this.db.execute(
      `UPDATE agent_actions SET ${sets.join(', ')} WHERE action_id = ?`,
      values,
    );
  }

  async listActions(agentId: string, limit = 50): Promise<AgentActionRecord[]> {
    const rows = await this.db.select<ActionRow>(
      'SELECT * FROM agent_actions WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?',
      [agentId, Math.max(1, Math.min(limit, 200))],
    );
    return rows.map(toAction);
  }

  async createApproval(args: {
    approvalId: string;
    actionId: string;
    agentId: string;
    preview: unknown;
    expiresAt: number;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO agent_approvals (approval_id, action_id, agent_id, status, preview_json, created_at, expires_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      [
        args.approvalId,
        args.actionId,
        args.agentId,
        JSON.stringify(args.preview),
        Date.now(),
        args.expiresAt,
      ],
    );
  }

  async listApprovals(agentId: string): Promise<AgentApproval[]> {
    const rows = await this.db.select<ApprovalRow>(
      `SELECT * FROM agent_approvals WHERE agent_id = ? ORDER BY created_at DESC`,
      [agentId],
    );
    return rows.map((row) => ({
      approvalId: row.approval_id,
      actionId: row.action_id,
      status:
        row.status === 'pending' && row.expires_at <= Date.now()
          ? 'expired'
          : (row.status as AgentApproval['status']),
      preview: JSON.parse(row.preview_json) as unknown,
      expiresAt: row.expires_at,
    }));
  }

  async resolveApproval(approvalId: string, status: 'approved' | 'rejected'): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE agent_approvals SET status = ?, resolved_at = ? WHERE approval_id = ? AND status = 'pending' AND expires_at > ?`,
      [status, Date.now(), approvalId, Date.now()],
    );
    return result.rowsAffected > 0;
  }

  async createArtifact(
    args: Omit<ReadingArtifact, 'createdAt' | 'updatedAt' | 'status'>,
  ): Promise<ReadingArtifact> {
    const now = Date.now();
    await this.db.execute(
      `INSERT INTO agent_artifacts (artifact_id, agent_id, book_hash, artifact_type, title, content_markdown, source_snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        args.artifactId,
        args.agentId,
        args.bookHash,
        args.type,
        args.title,
        args.contentMarkdown,
        JSON.stringify(args.sourceSnapshot),
        now,
        now,
      ],
    );
    return { ...args, status: 'active', createdAt: now, updatedAt: now };
  }

  async listArtifacts(agentId: string, bookHash?: string): Promise<ReadingArtifact[]> {
    const rows = await this.db.select<ArtifactRow>(
      bookHash
        ? `SELECT * FROM agent_artifacts WHERE agent_id = ? AND book_hash = ? AND status != 'deleted' ORDER BY updated_at DESC`
        : `SELECT * FROM agent_artifacts WHERE agent_id = ? AND status != 'deleted' ORDER BY updated_at DESC`,
      bookHash ? [agentId, bookHash] : [agentId],
    );
    return rows.map(toArtifact);
  }

  async getArtifact(agentId: string, artifactId: string): Promise<ReadingArtifact | null> {
    const rows = await this.db.select<ArtifactRow>(
      'SELECT * FROM agent_artifacts WHERE agent_id = ? AND artifact_id = ?',
      [agentId, artifactId],
    );
    return rows[0] ? toArtifact(rows[0]) : null;
  }

  async deleteArtifact(agentId: string, artifactId: string): Promise<boolean> {
    const result = await this.db.execute(
      `UPDATE agent_artifacts SET status = 'deleted', updated_at = ? WHERE agent_id = ? AND artifact_id = ? AND status != 'deleted'`,
      [Date.now(), agentId, artifactId],
    );
    return result.rowsAffected > 0;
  }

  async markArtifactsOrphaned(bookHash: string): Promise<void> {
    await this.db.execute(
      `UPDATE agent_artifacts SET status = 'orphaned', updated_at = ? WHERE book_hash = ? AND status = 'active'`,
      [Date.now(), bookHash],
    );
  }
}

function toClient(row: ClientRow): AgentClient {
  return {
    agentId: row.agent_id,
    displayName: row.display_name,
    clientType: row.client_type as AgentClientType,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    protocolVersion: row.protocol_version,
  };
}

function toGrant(row: GrantRow): AgentGrant {
  return {
    id: row.id,
    agentId: row.agent_id,
    resourceType: row.resource_type,
    resourceKey: row.resource_key,
    permission: row.permission,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
  };
}

function toAction(row: ActionRow): AgentActionRecord {
  return {
    actionId: row.action_id,
    agentId: row.agent_id,
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key ?? undefined,
    method: row.method,
    bookHash: row.book_hash ?? undefined,
    status: row.status,
    requestJson: row.request_json,
    previewJson: row.preview_json ?? undefined,
    resultJson: row.result_json ?? undefined,
    errorJson: row.error_json ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toArtifact(row: ArtifactRow): ReadingArtifact {
  return {
    artifactId: row.artifact_id,
    agentId: row.agent_id,
    bookHash: row.book_hash,
    type: row.artifact_type as ReadingArtifact['type'],
    title: row.title,
    contentMarkdown: row.content_markdown,
    sourceSnapshot: JSON.parse(row.source_snapshot_json) as ReadingArtifact['sourceSnapshot'],
    status: row.status as ReadingArtifact['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
