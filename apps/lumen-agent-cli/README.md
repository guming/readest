# Lumen Agent CLI

Lumen's CLI is the Agent-side MCP and CLI adapter. Lumen remains the Reader and owns the local Agent Bridge; the CLI owns the stdio MCP connection used by Codex, Hermes, and other local agents.

## Codex

The desktop app installs the native `lumen` command from **Settings → Agent Access**.
No Node.js or npm installation is required.

Register Lumen once:

```bash
codex mcp add lumen -- lumen mcp
```

With Lumen Desktop open, use any Lumen tool in Codex. On the first call, Lumen shows a local access request. Click **Allow** once; the CLI stores the resulting credential locally and retries the request automatically.

```bash
lumen status
```

The pairing-code flow remains available for recovery or manual setup:

```bash
lumen connect --code 123456
```

Useful checks:

```bash
lumen status
lumen capabilities
lumen context --scope current-chapter
lumen search --query "..." --scope read-so-far
```

`LUMEN_AGENT_TOKEN` overrides the local credential file for CI and debugging.
