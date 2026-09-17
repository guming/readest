export const AGENT_PROTOCOL_VERSION = 1 as const;

export type AgentScope = 'selection' | 'current_page' | 'current_chapter' | 'read_so_far' | 'book';

export type AgentPermission = 'read' | 'navigate' | 'write' | 'bulk_write';

export type AgentErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_REVOKED'
  | 'PERMISSION_DENIED'
  | 'BOOK_NOT_OPEN'
  | 'BOOK_NOT_FOUND'
  | 'BOOK_NOT_INDEXED'
  | 'SELECTION_NOT_FOUND'
  | 'SOURCE_NOT_FOUND'
  | 'READER_NOT_READY'
  | 'PROTOCOL_UNSUPPORTED'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR'
  | 'BRIDGE_UNAVAILABLE';

export interface AgentRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface AgentRpcError {
  code: AgentErrorCode;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export interface AgentRpcSuccess<T> {
  jsonrpc: '2.0';
  id: string | number;
  result: T;
}

export interface AgentRpcFailure {
  jsonrpc: '2.0';
  id: string | number;
  error: AgentRpcError;
}

export type AgentRpcResponse<T> = AgentRpcSuccess<T> | AgentRpcFailure;

export interface ReaderContext {
  schemaVersion: typeof AGENT_PROTOCOL_VERSION;
  book: {
    bookHash: string;
    title: string;
    author: string;
    format: string;
  } | null;
  position: {
    cfi: string | null;
    chapterTitle: string | null;
    sectionIndex: number | null;
    page: number | null;
    progress: number | null;
  } | null;
  selection: {
    text: string;
    cfi: string;
    endCfi?: string;
    page?: number;
  } | null;
  scope: {
    mode: AgentScope;
    spoilerBoundary: 'current_position' | 'none';
  };
}

export interface ReaderChapter {
  chapterId: string;
  title: string;
  sectionIndex: number;
  startCfi: string;
}

export interface ReaderSource {
  sourceId: string;
  bookHash: string;
  chapterTitle?: string;
  sectionIndex: number;
  startCfi: string;
  endCfi: string;
  page?: number;
  text: string;
  score?: number;
  searchMethod?: 'fts' | 'vector' | 'hybrid' | 'direct';
  scope: AgentScope;
}

export interface AgentAnnotation {
  id: string;
  bookHash: string;
  type: string;
  cfi: string;
  endCfi?: string;
  page?: number;
  text?: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface AgentCapability {
  name: string;
  permission: AgentPermission;
  available: boolean;
}

export interface AgentCapabilities {
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  appVersion: string;
  platform: string;
  capabilities: AgentCapability[];
}

export interface AgentHealth {
  ok: true;
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  port: number;
}

export interface AgentRequestEnvelope {
  requestId: string;
  body: string;
  authorization?: string;
}

export interface AgentBridgeInfo {
  port: number;
  protocolVersion: typeof AGENT_PROTOCOL_VERSION;
  discoveryPath: string;
  startedAt: number;
}

export type AgentActionStatus =
  | 'pending_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type ArtifactType = 'summary' | 'report' | 'question_set' | 'quote_collection';

export interface AgentApproval {
  approvalId: string;
  actionId: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  preview: unknown;
  expiresAt: number;
}

export interface ReadingArtifact {
  artifactId: string;
  agentId: string;
  bookHash: string;
  type: ArtifactType;
  title: string;
  contentMarkdown: string;
  sourceSnapshot: ReaderSource[];
  status: 'active' | 'orphaned' | 'deleted';
  createdAt: number;
  updatedAt: number;
}

export const READ_ONLY_METHODS = [
  'system.health',
  'system.capabilities',
  'reader.get_context',
  'reader.list_chapters',
  'reader.search',
  'reader.get_source',
  'annotations.list',
] as const;

export type ReadOnlyMethod = (typeof READ_ONLY_METHODS)[number];

export const agentError = (
  code: AgentErrorCode,
  message: string,
  retryable = false,
  details?: unknown,
): AgentRpcError => ({ code, message, retryable, ...(details === undefined ? {} : { details }) });

export const isAgentRpcRequest = (value: unknown): value is AgentRpcRequest => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['jsonrpc'] === '2.0' &&
    (typeof candidate['id'] === 'string' || typeof candidate['id'] === 'number') &&
    typeof candidate['method'] === 'string' &&
    candidate['method'].length > 0
  );
};
