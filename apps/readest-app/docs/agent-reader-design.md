# Lumen Agent Reader Design

## 1. 文档信息

- 功能：Lumen Agent Bridge
- 状态：设计草案，待确认
- 目标：让 Codex、Hermes、OpenClaw 等外部 Agent 以结构化、可授权、可回溯的方式使用 Lumen
- 首期平台：Tauri Desktop，macOS、Windows、Linux
- 保持不变：Web、iOS、Android 的现有阅读、同步、AI 和分享功能
- 相关现有模块：Reader、BookConfig、BookNote、Reedy retrieval、Reedy tools、Tauri CLI、deep link

## 2. 背景与问题

Lumen 当前已经具备书籍导入、阅读位置、CFI、高亮、笔记、全文检索和 Reedy agent runtime 等能力，但这些能力主要服务于 Lumen 内部 UI。外部 Agent 目前不能稳定地完成以下事情：

1. 获取用户当前正在阅读的书籍、章节、位置和选区。
2. 按指定范围检索原文，并拿到可跳转的引用。
3. 读取用户已有的笔记、高亮和阅读进度。
4. 请求 Lumen 跳转、创建笔记或保存阅读成果。
5. 知道操作是否成功、是否需要用户确认，以及失败原因。

目标不是在 Lumen 内再做一个通用聊天机器人，而是让 Lumen 成为外部 Agent 的可信阅读入口：

> Lumen 提供准确的阅读上下文、可定位的原文证据和受控的阅读操作。复杂的研究、项目分析和跨工具工作流由外部 Agent 负责。

## 3. 产品目标

### 3.1 目标

- 外部 Agent 可以发现 Lumen 的能力和版本。
- Agent 可以获得结构化阅读上下文，而不需要读取 HTML 或截屏猜测状态。
- Agent 可以检索带章节和 CFI 的原文证据。
- Agent 可以请求导航和写入操作。
- 用户始终知道哪个 Agent 正在访问什么，以及 Agent 做了什么。
- 现有书籍、笔记、同步和内置 AI 数据保持兼容。
- 连接失败、权限不足、索引缺失和阅读器未就绪时，都能返回稳定错误。

### 3.2 非目标

本次设计不包含：

- 让 Lumen 取代 Codex、Hermes 或 OpenClaw 的任务编排能力。
- 在 Lumen 中实现完整的多 Agent 调度系统。
- 让 Agent 直接修改 EPUB、PDF 或其他原始书籍文件。
- 让外部 Agent 默认访问整个书库。
- 将 Agent 会话、任务或访问令牌加入现有书籍同步协议。
- 改造现有 Reedy 内置 AI 的聊天 UI。
- 首期支持 iOS、Android 或 Web 的本地外部进程连接。
- 提供未经用户确认的批量笔记和高亮写入。

## 4. 当前代码基础与约束

### 4.1 可以复用的能力

- `ReadingContextSnapshot` 已能表达当前阅读位置、章节、页码和选区。
- `BookNote` 已能表达书签、批注、摘录、引用、CFI 和文本范围。
- `ReedyDb` 已提供本地书籍分块、FTS、向量检索和索引状态。
- `BookRetriever` 已有基于书籍范围的混合检索能力。
- `ReedyTool` 和 `ToolRegistry` 已有参数校验、权限、超时、取消和串行化机制。
- `navigateToCfi`、`createNote`、`createHighlight` 已表达核心阅读操作。
- `ReedyEvent` 已能表达工具调用、工具结果、引用、错误、取消和完成事件。
- Tauri 已启用单实例、deep link 和 desktop CLI 插件。
- 数据库迁移系统支持独立 schema，例如 `reedy`、`statistics` 和 `hardcover-sync`。

### 4.2 需要补齐的能力

- 面向外部进程的本地双向协议。
- Agent 客户端注册、令牌和权限授权。
- 外部请求与内部 Reader/Reedy 能力之间的适配层。
- 任务、审批和活动记录。
- 外部请求的版本协商和稳定错误模型。
- Agent Bridge 的桌面端状态和用户管理界面。

### 4.3 现有功能不得被改变的部分

- 不修改 `BookNote` 的字段、去重逻辑和保存路径。
- 不修改 `BookConfig`、`library.json`、书籍文件和现有同步 payload。
- 不修改 `reedy_book_chunks`、向量表和既有检索语义。
- 不修改现有 `lumen://book/...`、annotation deep link 和分享链接格式。
- 不修改 `aiSettings.reedy.runtime` 的现有 `mvp` 和 `agent` 分流行为。
- 不让 Agent Bridge 成为现有 Reader 初始化和打开书籍流程的前置依赖。

## 5. 总体方案

采用一个嵌入 Lumen Desktop 的本地 Agent Bridge，加上薄客户端适配器：

```text
Codex / Hermes / OpenClaw
          │ stdio MCP
          ▼
       Lumen CLI
          │ JSON-RPC over loopback HTTP
          ▼
     Lumen Agent Bridge
                    │
        Reader Context / Source / Action adapters
                    │
               Lumen Reader
```

### 5.1 传输选择

首期使用 `127.0.0.1` 上的 HTTP JSON-RPC 2.0：

- 外部 Agent 不需要了解 Tauri IPC。
- Codex、Hermes、OpenClaw 和自定义脚本都可以接入。
- 请求和响应容易记录、调试和测试。
- 可以在同一协议上增加 SSE 事件流。
- 服务只监听 loopback，不暴露到局域网。

Lumen CLI 是 Agent 侧协议适配器，不拥有 Reader 业务逻辑：

- `lumen mcp` 将 MCP tool 调用转换为 JSON-RPC。
- `lumen context/search/...` 将命令行参数转换为 JSON-RPC。
- 权限、数据格式和错误语义只在 Agent Bridge 中实现一次。

Codex 通过标准 stdio MCP 命令注册 Lumen：

```bash
codex mcp add lumen -- lumen mcp
```

Lumen CLI 负责读取 Lumen 的 discovery 文件和本地凭证，Codex 不需要知道
Lumen Bridge 的随机端口或 JSON-RPC 细节。

### 5.2 CLI 安装

Lumen Desktop 将自身的已签名主可执行文件复制为 CLI 模式入口。用户在
Settings → Agent Access 点击“Install CLI”后，桌面端通过 Tauri command
将 `lumen` 安装到用户本地 bin 目录；点击“Connect Codex”后，Lumen 调用
`codex mcp add lumen -- <installed-lumen-path> mcp` 完成注册。这样不依赖
Node.js、npm 或用户手工修改 PATH。CLI 通过启动参数 `mcp` 进入 stdio
MCP 模式，普通启动参数仍进入 Reader 桌面应用。

### 5.3 为什么不直接使用 deep link

现有 deep link 适合一次性打开书籍或定位笔记，但不适合双向 Agent 协作，因为它不能可靠地：

- 返回结构化结果。
- 表示长任务状态。
- 传递审批请求。
- 订阅阅读位置变化。
- 区分权限错误、索引错误和操作错误。

deep link 保持现有行为，并作为可选的导航降级入口，不承担 Agent Bridge 协议职责。

### 5.4 首期运行边界

- 仅在 Tauri Desktop 启动 Agent Bridge。
- Web、iOS、Android 不启动监听端口，也不改变当前行为。
- Bridge 启动失败不影响 Lumen 启动、打开书籍、阅读、同步和内置 AI。
- 默认仅允许当前用户本机进程通过一次性配对完成连接。

## 6. 核心对象

### 6.1 Context

当前用户正在阅读的状态快照。

```ts
interface ReaderContext {
  schemaVersion: 1;
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
    mode: 'selection' | 'current_page' | 'current_chapter' | 'read_so_far' | 'book';
    spoilerBoundary: 'current_position' | 'none';
  };
}
```

### 6.2 Source

Agent 从 Lumen 获取的可追溯原文片段。

```ts
interface ReaderSource {
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
  scope: 'selection' | 'current_page' | 'current_chapter' | 'read_so_far' | 'book';
}
```

### 6.3 Action

Agent 对 Lumen 发起的导航、写入或导出请求。

```ts
interface AgentAction {
  actionId: string;
  agentId: string;
  method: string;
  bookHash?: string;
  preview?: unknown;
  status: 'pending_approval' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  completedAt?: number;
}
```

### 6.4 Artifact

Agent 生成并写回 Lumen 的阅读成果。首期只保存 Markdown 内容和结构化来源，不引入新的 NotebookCard 类型。

```ts
interface ReadingArtifact {
  artifactId: string;
  bookHash: string;
  type: 'summary' | 'report' | 'question_set' | 'quote_collection';
  title: string;
  contentMarkdown: string;
  sourceIds: string[];
  sourceSnapshot: ReaderSource[];
  createdByAgentId: string;
  createdAt: number;
  updatedAt: number;
}
```

## 7. 外部 API 设计

### 7.1 HTTP 基础

```text
POST http://127.0.0.1:{port}/rpc
GET  http://127.0.0.1:{port}/events
GET  http://127.0.0.1:{port}/health
```

所有请求必须携带：

```http
Authorization: Bearer <agent-token>
Content-Type: application/json
X-Lumen-Protocol-Version: 1
```

端口使用随机可用端口，端口信息写入当前用户临时目录的运行时文件，不写入仓库和书籍目录：

```json
{
  "protocolVersion": 1,
  "port": 43127,
  "pid": 12345,
  "startedAt": 1788393600000
}
```

运行时文件内容不包含 token。外部客户端通过用户配对流程得到 token。

### 7.2 JSON-RPC 请求格式

```json
{
  "jsonrpc": "2.0",
  "id": "req_123",
  "method": "reader.get_context",
  "params": {
    "scope": "current_chapter"
  }
}
```

成功响应：

```json
{
  "jsonrpc": "2.0",
  "id": "req_123",
  "result": {
    "schemaVersion": 1,
    "book": {},
    "position": {},
    "selection": null,
    "scope": {}
  }
}
```

失败响应：

```json
{
  "jsonrpc": "2.0",
  "id": "req_123",
  "error": {
    "code": "BOOK_NOT_OPEN",
    "message": "No book is currently open",
    "retryable": false,
    "details": {}
  }
}
```

### 7.3 能力发现

方法：`system.capabilities`

```json
{
  "protocolVersion": 1,
  "appVersion": "0.11.18",
  "platform": "macos",
  "capabilities": [
    {
      "name": "reader.get_context",
      "permission": "read",
      "available": true
    },
    {
      "name": "reader.search",
      "permission": "read",
      "available": true
    },
    {
      "name": "reader.navigate",
      "permission": "navigate",
      "available": true
    },
    {
      "name": "annotations.create_note",
      "permission": "write",
      "available": true
    }
  ]
}
```

Agent 必须先调用能力发现，不得假设某个方法一定存在。

### 7.4 Reader API

#### `reader.get_context`

请求：

```json
{
  "scope": "selection"
}
```

`scope` 可选值：`selection`、`current_page`、`current_chapter`、`read_so_far`、`book`。

规则：

- `selection` 没有选区时返回 `SELECTION_NOT_FOUND`。
- `read_so_far` 受当前阅读位置限制。
- `book` 只有在用户授权整本书后才可使用。
- 返回结果包含实际生效的 scope，不接受 Agent 静默扩大范围。

#### `reader.list_chapters`

返回当前书籍目录及章节的稳定索引：

```json
{
  "bookHash": "book_123",
  "chapters": [
    {
      "chapterId": "section_4",
      "title": "第四章",
      "sectionIndex": 4,
      "startCfi": "epubcfi(...)"
    }
  ]
}
```

#### `reader.search`

请求：

```json
{
  "query": "系统思维",
  "scope": "read_so_far",
  "chapterId": "section_4",
  "topK": 10
}
```

规则：

- `topK` 服务端限制为 20。
- 首期复用 `BookRetriever` 的 FTS、向量或混合检索。
- 未建立索引时返回 `BOOK_NOT_INDEXED`，不自动阻塞索引整个书库。
- 结果必须包含 `startCfi`、`endCfi` 和文本。
- 服务端过滤超出 scope 的结果。

#### `reader.get_source`

请求：

```json
{
  "bookHash": "book_123",
  "startCfi": "epubcfi(...)",
  "endCfi": "epubcfi(...)"
}
```

只返回指定书籍中可解析的原文范围。不能跨书籍解析 CFI。

#### `reader.open`

请求：

```json
{
  "bookHash": "book_123",
  "cfi": "epubcfi(...)"
}
```

该方法属于 `navigate` 权限。首次调用或用户设置为每次确认时，返回审批请求，不直接导航。

### 7.5 Annotation API

#### `annotations.list`

请求：

```json
{
  "bookHash": "book_123",
  "types": ["annotation", "bookmark", "excerpt"],
  "includeDeleted": false
}
```

首期只允许访问当前授权书籍。结果沿用 `BookNote` 的语义，但通过外部 DTO 返回，不直接暴露内部对象引用。

#### `annotations.create_note`

请求：

```json
{
  "bookHash": "book_123",
  "cfi": "epubcfi(...)",
  "endCfi": "epubcfi(...)",
  "quotedText": "原文摘录",
  "note": "Agent 生成的笔记",
  "sourceIds": ["book_123:source_1"]
}
```

响应分两步：

1. 未获批准时返回 `approvalId`、规范化后的预览和过期时间。
2. 用户批准后返回 `annotationId`、写入后的 CFI 和事件 ID。

Agent 不得使用 `quotedText` 之外的内容覆盖原文，Lumen 需要验证 CFI 范围和引用文本的一致性。无法验证时返回 `SOURCE_MISMATCH`，不写入。

#### `annotations.create_highlight`

使用现有高亮样式和颜色规则。Agent 可请求颜色，但 Lumen 需要在不支持时回退到用户默认样式，并在结果中返回实际使用的样式。

### 7.6 Artifact API

#### `artifacts.create`

请求：

```json
{
  "bookHash": "book_123",
  "type": "report",
  "title": "本书对当前项目的启发",
  "contentMarkdown": "## 核心观点\n...",
  "sourceIds": ["book_123:source_1", "book_123:source_8"],
  "sourceSnapshot": []
}
```

首期写入独立 Agent 数据库，不直接写入 `BookConfig` 或 `NotebookCard`。用户可以在 Lumen 中预览后，选择导出 Markdown 或转为现有 Notebook 卡片。转为 Notebook 卡片是显式用户动作，不由 Agent API 自动完成。

#### `artifacts.list`

按 `bookHash`、类型和创建时间查询。默认只返回当前授权书籍的成果。

### 7.7 Approval API

#### `approval.list`

返回当前 Agent 的待审批操作。

#### `approval.resolve`

请求：

```json
{
  "approvalId": "approval_123",
  "decision": "approve"
}
```

审批只对单次 action 生效，不自动扩大 Agent 的长期权限。批量操作必须展示完整数量、书籍范围和预计写入对象。

### 7.8 Event API

`GET /events` 使用 SSE，事件类型包括：

```text
connection.changed
book.opened
reading.position_changed
reading.selection_changed
annotation.created
annotation.updated
approval.required
action.completed
action.failed
```

事件只发送给拥有对应书籍权限的 Agent。事件 payload 不包含超出授权范围的原文。

## 8. 内部实现架构

### 8.1 分层

```text
AgentBridgeServer
  ├── ProtocolRouter
  ├── AuthService
  ├── CapabilityRegistry
  ├── ApprovalService
  ├── AgentTaskService
  ├── AgentEventBus
  └── ReaderFacade
        ├── ContextAdapter
        ├── SourceAdapter
        ├── AnnotationAdapter
        ├── NavigationAdapter
        └── ArtifactAdapter
```

### 8.2 ReaderFacade

`ReaderFacade` 是唯一允许 Agent Bridge 访问 Reader 状态和写入 Reader 数据的内部接口。Bridge 不直接操作 React store，也不直接操作 DOM。

建议接口：

```ts
interface ReaderFacade {
  getCurrentContext(scope: ContextScope): Promise<ReaderContext>;
  listChapters(bookHash: string): Promise<ChapterInfo[]>;
  search(args: SearchArgs): Promise<ReaderSource[]>;
  getSource(args: SourceRange): Promise<ReaderSource>;
  openBook(bookHash: string, cfi?: string): Promise<OpenBookResult>;
  listAnnotations(args: ListAnnotationsArgs): Promise<AnnotationDto[]>;
  previewCreateNote(args: CreateNoteArgs): Promise<AnnotationPreview>;
  createNote(args: CreateNoteArgs): Promise<AnnotationDto>;
  previewCreateHighlight(args: CreateHighlightArgs): Promise<AnnotationPreview>;
  createHighlight(args: CreateHighlightArgs): Promise<AnnotationDto>;
}
```

### 8.3 复用 Reedy 工具但不直接暴露 ToolRegistry

现有 `ToolRegistry` 的权限和参数校验适合内部 Agent runtime，但外部协议还需要：

- Agent 身份和资源授权。
- API 版本协商。
- 请求幂等键。
- 审批 ID。
- 外部错误码。
- 连接生命周期。

因此不直接把 `ToolRegistry.toVercelToolSet()` 暴露给外部 Agent，而是让 `ReaderFacade` 复用其中的领域服务和既有工具实现。现有内置 Reedy 行为保持不变。

### 8.4 请求生命周期

```text
外部请求
  │
  ▼
HTTP 认证
  │
  ▼
JSON-RPC 解析和版本校验
  │
  ▼
Agent 权限和书籍范围校验
  │
  ├── read：直接调用 ReaderFacade
  ├── navigate：创建或检查 approval
  └── write：生成预览并等待 approval
  │
  ▼
记录 action 和 event
  │
  ▼
返回结构化结果
```

## 9. 数据存储方案

### 9.1 存储原则

- 新增 Agent 数据使用独立 `agent.db`，不写入 `reedy.db`。
- 不修改 `BookConfig`、`BookNote`、`library.json` 和既有同步数据。
- Agent 数据默认仅本地存储，不进入云同步。
- 原文内容不复制进 Agent 数据库，成果中的来源快照只保存用户确认后生成的必要片段。
- 所有表都增加 schema version 或由数据库 migration version 管理。
- 删除书籍时不自动删除 Agent 成果，先标记为 orphaned，避免误删用户研究成果。

### 9.2 `agent.db` 表设计

#### `agent_clients`

保存已配对的 Agent 身份，不保存明文 token。

```sql
CREATE TABLE IF NOT EXISTS agent_clients (
  agent_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  client_type TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  protocol_version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_agent_clients_active
ON agent_clients (revoked_at, last_seen_at DESC);
```

#### `agent_grants`

表示 Agent 可访问的资源和能力。

```sql
CREATE TABLE IF NOT EXISTS agent_grants (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  UNIQUE (agent_id, resource_type, resource_key, permission),
  FOREIGN KEY (agent_id) REFERENCES agent_clients(agent_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_grants_agent
ON agent_grants (agent_id, revoked_at, expires_at);
```

`resource_type` 首期支持 `current_book`、`book` 和 `library`。首期 UI 只开放 `current_book` 和明确选择的 `book`。

#### `agent_actions`

保存操作审计和幂等结果。

```sql
CREATE TABLE IF NOT EXISTS agent_actions (
  action_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  idempotency_key TEXT,
  method TEXT NOT NULL,
  book_hash TEXT,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  preview_json TEXT,
  result_json TEXT,
  error_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (agent_id, idempotency_key),
  FOREIGN KEY (agent_id) REFERENCES agent_clients(agent_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_recent
ON agent_actions (agent_id, created_at DESC);
```

#### `agent_approvals`

保存等待用户确认的操作。

```sql
CREATE TABLE IF NOT EXISTS agent_approvals (
  approval_id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY (action_id) REFERENCES agent_actions(action_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agent_clients(agent_id) ON DELETE CASCADE
);
```

#### `agent_artifacts`

保存 Agent 生成的阅读成果。

```sql
CREATE TABLE IF NOT EXISTS agent_artifacts (
  artifact_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  book_hash TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  source_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agent_clients(agent_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_book
ON agent_artifacts (book_hash, updated_at DESC);
```

### 9.3 Token 存储

建议：

- token 只在配对成功时显示一次。
- 数据库保存 token 的 SHA-256 hash，不保存明文。
- 当前运行 token 在内存中保存，用于验证请求。
- 撤销 Agent 时删除内存 token 并将 `revoked_at` 写入数据库。
- 已授权 token 由 Lumen CLI 持久化保存，应用重启后不需要重新配对。

这是一个有意的安全取舍，可以避免新增 OS keychain 跨平台实现。若后续验证出长期自动化需求，再增加系统钥匙串存储，不改变 API 语义。

### 9.4 迁移和兼容

新增 `agent` schema，并在 `src/services/database/migrations/index.ts` 末尾追加 migration。现有 schema 不改、不重排、不删除。

首次打开 Agent Bridge 时：

1. 打开或创建 `Data/agent.db`。
2. 执行 `getMigrations('agent')`。
3. 迁移失败时禁用 Agent Bridge，并记录错误，不影响主应用。

首期不迁移任何已有 Reedy session、AI conversation 或 NotebookCard 数据。

### 9.5 数据保留

- `agent_actions` 和事件记录默认保留 30 天。
- `agent_approvals` 完成或过期后保留 7 天。
- `agent_artifacts` 由用户管理，不自动清理。
- token hash 和授权记录保留到用户撤销或删除 Agent。
- 提供“清除 Agent 数据”入口，但该操作只删除 `agent.db` 中的数据，不能删除书籍、笔记或用户配置。

## 10. 连接与权限流程

### 10.1 配对流程

```text
Codex 首次调用 `lumen mcp`，Lumen 收到本机 Agent 授权请求
  │
  ▼
Lumen 显示 Agent 名称和申请的只读权限
  │
  ▼
用户点击允许
  │
  ▼
Lumen 生成 agentId 和 token，并返回给 `lumen mcp`
  │
  ▼
Lumen CLI 保存本地凭证，Lumen Desktop 只保存 token hash

应用重启不会让凭证失效；只有用户在 Lumen 中显式 revoke，或运行
`lumen disconnect` 撤销当前连接时才失效。

如果自动授权不可用，用户可以在 Settings → Agent Access 生成 pairing code，
再运行 `lumen connect --code 123456` 完成手动配对。pairing code 只作为手动
配对和故障恢复入口。
```

配对码：

- 仅在内存中保存。
- 10 分钟后过期。
- 只能使用一次。
- 不能授予 library 级别权限。

### 10.2 读取流程

```text
Agent 调用 reader.get_context
  │
  ▼
校验 token 和 agent grant
  │
  ▼
ReaderFacade 读取当前 Reader 状态
  │
  ▼
按 scope 过滤内容
  │
  ▼
返回 ReaderContext
```

### 10.3 写入流程

```text
Agent 请求 create_note
  │
  ▼
校验书籍、CFI、quotedText 和权限
  │
  ▼
生成预览，写入 pending action
  │
  ▼
Lumen 展示待确认卡片
  │
  ├── 用户取消 → action cancelled
  └── 用户确认 → 调用现有 annotation 保存流程
                         │
                         ▼
                    返回 annotationId
```

### 10.4 导航流程

导航不修改数据，但会改变用户当前阅读位置，因此默认属于 `navigate` 权限。用户可以选择“本次连接自动允许导航”，但该设置不影响写入权限。

## 11. Lumen 内部 UI

首期只新增 Agent Access 和 Activity Center，不新增 Agent 聊天页面。

### 11.1 Agent Access

包含：

- Bridge 开关和运行状态。
- 当前端口和连接状态，不显示 token。
- 已配对 Agent 列表。
- 每个 Agent 的资源权限和能力权限。
- Revoke、Pause、重新配对。
- 生成一次性 pairing code。
- 查看协议版本和最近连接时间。

### 11.2 Activity Center

包含：

- 当前 Agent。
- 当前请求和任务状态。
- 最近读取的书籍。
- 最近导航操作。
- 待审批的笔记、高亮和批量操作。
- 成功、失败和取消原因。

Activity Center 只展示 Agent 活动，不展示聊天消息。

### 11.3 现有 UI 不变

- Notebook 的 Notes、Assistant、Review 标签不删除、不改语义。
- 现有内置 AI 仍然使用当前 `aiSettings` 和 Reedy runtime。
- 现有 annotation editor、NotebookCard 和导出流程继续工作。

## 12. 典型业务流程

### 12.1 读取当前选区

1. 用户在 Lumen 中打开一本书并选中文字。
2. OpenClaw 调用 `reader.get_context`，scope 为 `selection`。
3. Lumen 返回选区、CFI、章节、页码和书籍标识。
4. OpenClaw 调用 `reader.search` 查找相关章节。
5. Lumen 返回带 CFI 的 `ReaderSource` 数组。
6. OpenClaw 在自己的工作流中生成分析。

### 12.2 整理一本书并结合当前项目

1. 用户在 Agent 中发起任务：“读完这本书，整理对当前项目有用的内容。”
2. Agent 通过 `reader.list_chapters` 获取章节结构。
3. Agent 按章节调用 `reader.search`，scope 为 `book` 或 `read_so_far`。
4. Agent 在外部项目上下文中分析代码、文档或 issue。
5. Agent 调用 `artifacts.create` 保存报告草稿。
6. 用户在 Lumen Activity Center 中查看成果和原文来源。
7. 用户选择导出 Markdown，或将指定内容转换为 NotebookCard。

### 12.3 Agent 请求写入笔记

1. Agent 提交 `annotations.create_note`。
2. Lumen 检查 Agent 是否拥有当前书籍的 write grant。
3. Lumen 验证 CFI 和 quotedText。
4. Lumen 展示引用、笔记内容和来源。
5. 用户确认。
6. Lumen 调用现有 `BookNote` 保存逻辑。
7. 现有同步和 annotation overlay 流程照常执行。
8. Bridge 返回 annotation ID 和最终 CFI。

## 13. 错误模型

首期固定错误码：

| 错误码 | 含义 | 可重试 |
| --- | --- | --- |
| `AUTH_REQUIRED` | 缺少 token | 否 |
| `AUTH_REVOKED` | Agent 已被撤销 | 否 |
| `PERMISSION_DENIED` | 没有资源或能力权限 | 否 |
| `BOOK_NOT_OPEN` | 当前没有打开书籍 | 否 |
| `BOOK_NOT_FOUND` | 书籍不存在或未授权 | 否 |
| `BOOK_NOT_INDEXED` | 书籍尚未建立 Reedy 索引 | 是 |
| `SELECTION_NOT_FOUND` | 当前没有选区 | 否 |
| `SOURCE_NOT_FOUND` | CFI 或 source 不存在 | 否 |
| `SOURCE_MISMATCH` | 引用文本与 CFI 不匹配 | 否 |
| `READER_NOT_READY` | Reader 尚未完成初始化 | 是 |
| `APPROVAL_REQUIRED` | 操作等待用户批准 | 否 |
| `APPROVAL_EXPIRED` | 审批已过期 | 否 |
| `ACTION_CANCELLED` | 用户取消或 Agent 取消 | 否 |
| `RATE_LIMITED` | 请求频率超限 | 是 |
| `PROTOCOL_UNSUPPORTED` | 协议版本不兼容 | 否 |
| `INTERNAL_ERROR` | 未分类内部错误 | 视 details 而定 |

错误不能把内部堆栈、绝对文件路径、API key 或书籍原始文件路径返回给外部 Agent。

## 14. 修改范围

### 14.1 新增文件

预计新增：

```text
apps/readest-app/src/services/agent-bridge/
  protocol.ts
  errors.ts
  auth.ts
  capabilities.ts
  server.ts
  eventBus.ts
  approvalService.ts
  actionService.ts
  readerFacade.ts
  adapters/contextAdapter.ts
  adapters/sourceAdapter.ts
  adapters/annotationAdapter.ts
  adapters/navigationAdapter.ts
  adapters/artifactAdapter.ts
  storage/AgentDb.ts
  storage/types.ts
  client/PairingService.ts

apps/readest-app/src/components/settings/AgentAccessPanel.tsx
apps/readest-app/src/components/agent/AgentActivityCenter.tsx
apps/readest-app/src/components/agent/AgentApprovalDialog.tsx
apps/readest-app/src/utils/agentProtocol.ts

apps/lumen-agent-cli/                 # Lumen CLI 包
  package.json
  src/index.mjs
  README.md

apps/readest-app/src-tauri/src/agent_bridge.rs
apps/readest-app/src/__tests__/agent-bridge/
```

`apps/lumen-agent-cli` 是独立的 Lumen CLI workspace app。其 `lumen mcp`
命令是 Codex 等 Agent 的 stdio MCP 入口；协议本身仍不依赖 CLI，其他 Agent
也可以直接实现同一 JSON-RPC 客户端。

### 14.2 修改现有文件

| 文件 | 修改内容 | 风险 |
| --- | --- | --- |
| `src/services/database/migrate.ts` | 保持 `SchemaType` 字符串能力，若不需要联合类型则不修改 | 低 |
| `src/services/database/migrations/index.ts` | 新增 `agent` schema migration | 低，新增独立数据库 |
| `src/services/nativeAppService.ts` | 初始化 Agent Bridge，失败时降级禁用 | 中 |
| `src-tauri/src/lib.rs` | 注册 Agent Bridge 启停相关 Tauri command 或状态管理 | 中 |
| `src-tauri/Cargo.toml` | 增加 loopback server 所需现有生态依赖 | 中，需平台构建验证 |
| `src-tauri/tauri.conf.json` | 仅在确有必要时增加桌面 capability，不修改现有权限 | 中 |
| `src/app/reader/hooks/useBooksManager.ts` | 向 ReaderFacade 提供当前书籍和导航适配 | 中 |
| `src/app/reader/hooks/useTextSelector.ts` | 向 ContextAdapter 提供当前选区订阅 | 中 |
| `src/store/readerStore.ts` | 仅增加只读 context 订阅接口，不改变现有状态字段语义 | 中 |
| `src/store/bookDataStore.ts` | 复用现有 annotation 保存能力，避免复制保存逻辑 | 中 |
| `src/services/reedy/retrieval/BookRetriever.ts` | 复用或增加外部 DTO 转换入口，不改变检索算法 | 低 |
| `src/services/reedy/db/ReedyDb.ts` | 只读查询适配，不修改既有表结构 | 低 |
| `src/types/system.ts` | 如果 AppService 需要暴露 Agent Bridge 生命周期，则增加可选接口 | 低 |
| `src/components/settings/SettingsDialog.tsx` | 增加 Agent Access 入口 | 低 |
| `src/components/settings/SettingsPanelType` 所在文件 | 增加 AgentAccess panel 类型 | 低 |
| `src/services/commandRegistry.ts` | 可选增加打开 Agent Access 的命令 | 低 |

### 14.3 明确不修改

- `src/types/book.ts` 中 `BookNote` 和 `NotebookCard` 的现有定义。
- `src/services/sync/` 下的同步协议和 provider。
- `src/services/ai/storage/aiStore.ts` 的 IndexedDB conversation schema。
- `src/services/reedy/store/reedyStore.ts` 的现有内置 Agent UI session 语义。
- `src/utils/deeplink.ts` 的既有 URL 格式。
- 现有 EPUB、PDF、MOBI、CBZ 解析和渲染流程。

## 15. 分阶段交付

### Phase 1：只读 Bridge

可独立发布，包含：

- loopback HTTP JSON-RPC server。
- pairing 和 token 校验。
- `system.health`、`system.capabilities`。
- `reader.get_context`。
- `reader.list_chapters`。
- `reader.search`。
- `reader.get_source`。
- `annotations.list`。
- Agent Access 页面。
- API 和存储单元测试。

Phase 1 不修改任何现有用户数据，不包含写入操作。

### Phase 2：导航和受控写入

可独立发布，包含：

- `reader.open`。
- `annotations.create_note`。
- `annotations.create_highlight`。
- approval 流程。
- Activity Center。
- action audit 和幂等键。

### Phase 3：成果和事件

可独立发布，包含：

- `artifacts.create`、`artifacts.list`。
- SSE events。
- Markdown 导出。
- 书籍删除后的 orphan artifact 管理。
- MCP adapter 和 CLI。

每个阶段发布后，Lumen 仍可独立运行，下一阶段未完成不会阻塞上一阶段。

## 16. 兼容性与破坏性变更

### 16.1 非破坏性变更

- 新增 `Data/agent.db`。
- 新增本地随机端口监听，默认只监听 `127.0.0.1`。
- 新增 Settings 页面和 Agent 活动状态。
- 新增只读 ReaderFacade。
- 新增独立 Agent API 和事件格式。

### 16.2 需要用户确认的变更

以下事项在实现前必须单独确认，当前设计不默认执行：

1. 是否允许 Agent 访问整本书，而不仅是当前书籍或已读范围。
2. 是否允许 Agent 进行批量笔记、高亮和书签写入。
3. 是否将 Agent 生成的 Artifact 自动转换为现有 NotebookCard。
4. 是否将 Agent 权限和 Artifact 纳入云同步。
5. 是否在应用重启后保留 Agent token，实现无需重新配对的后台自动化。
6. 是否支持 Web、iOS 和 Android 的远程或局域网 Agent 连接。
7. 是否把 Agent Bridge 端口暴露到 `0.0.0.0` 或局域网。

这些选择会改变隐私、安全、同步、平台能力或数据生命周期，不能在实现阶段静默决定。

### 16.3 不允许的破坏性变更

未经确认不得：

- 修改或删除已有 BookNote。
- 修改已有 NotebookCard 的持久化格式。
- 重建或清空 `reedy.db`。
- 改变既有 CFI 语义。
- 改变现有同步行为。
- 让 Agent Bridge 失败导致 Reader 启动失败。

## 17. 验证方案

### 17.1 API 测试

- 未配对请求返回 `AUTH_REQUIRED`。
- 已撤销 Agent 无法继续调用。
- 读取当前书籍成功。
- 未打开书籍返回 `BOOK_NOT_OPEN`。
- 未授权书籍返回 `PERMISSION_DENIED` 或 `BOOK_NOT_FOUND`，不泄露书籍存在性。
- scope 不能被 Agent 静默扩大。
- 搜索结果包含稳定 CFI 和章节信息。
- 未索引书籍返回 `BOOK_NOT_INDEXED`。
- CFI 与 quotedText 不匹配时不写入。
- 重复 idempotency key 不产生重复操作。
- 审批过期后不能执行写入。

### 17.2 数据库测试

- 新安装可以创建 `agent.db`。
- 现有 `reedy.db` 和书籍配置不受 agent migration 影响。
- migration 重复执行是幂等的。
- Agent 删除后级联删除 grant 和 action，但 artifact 按设计保留或阻止删除。
- 清理过期 action 不影响 artifact。

### 17.3 Reader 回归测试

- 打开书籍流程在 Bridge 关闭时完全不变。
- Bridge 启动失败时 Reader 仍可使用。
- Agent 导航不会改变现有手动翻页、进度保存和同步逻辑。
- Agent 创建的 Note 与手动创建的 Note 使用相同 overlay、保存和同步路径。
- 既有 deep link 和 annotation link 测试继续通过。

### 17.4 手工验收

1. 启动 Lumen，不连接任何 Agent，正常打开并阅读一本书。
2. 在 Settings 中生成 pairing code，并用测试客户端配对。
3. 获取当前上下文，检查书籍、章节、CFI、页码和选区。
4. 搜索一个关键词，点击返回 source 对应的章节位置。
5. 请求创建笔记，确认 Lumen 先展示预览而不是直接写入。
6. 取消审批，确认没有新增笔记。
7. 再次确认，确认新增笔记和现有同步行为一致。
8. 撤销 Agent，确认后续请求失败。
9. 关闭或禁用 Bridge，确认 Reader 其他功能不受影响。

## 18. 风险与降级

### Agent Bridge 启动失败

Lumen 记录错误并显示“Agent Access unavailable”，不阻塞主窗口和 Reader。

### Reader 尚未初始化

返回 `READER_NOT_READY`，Agent 可稍后重试。Bridge 不主动触发打开书籍流程。

### Reedy 索引不可用

返回 `BOOK_NOT_INDEXED` 或 `INDEX_FAILED`，不自动为 Agent 开启高成本全书索引。用户可以在 Lumen 内手动触发索引。

### 外部 Agent 中断

未完成 action 标记为 `cancelled` 或 `failed`。审批请求过期，不继续执行。

### 端口冲突

重新选择随机端口，并更新运行时文件。外部客户端通过 discovery 文件或 CLI 重新获取端口，不依赖固定端口。

### 进程异常退出

下次启动清理已过期 runtime 文件和 pending approval。不会恢复未完成写操作。

## 19. 设计结论

本方案把 Lumen 的产品边界固定为三个能力：

```text
Context   Agent 当前可以知道什么
Source    Agent 可以引用什么
Action    Agent 可以请求 Lumen 做什么
```

外部 Agent 负责复杂任务拆解、跨书分析、项目关联和其他工具调用。Lumen 负责提供可信原文、当前阅读上下文、CFI 定位、用户阅读痕迹和最终写回入口。

首期最小可行闭环是：

```text
配对 Agent
  → 获取当前上下文
  → 搜索带 CFI 的原文
  → Agent 在外部完成分析
  → 请求 Lumen 导航或写入
  → 用户确认
  → 结果回到 Lumen
```

这套设计不会替换现有 Reader、Notebook、Reedy AI 或同步系统，也不会要求用户迁移已有数据。任何扩大资源范围、写入范围、同步范围或网络暴露范围的决定，都必须在实现前单独确认。
