#!/usr/bin/env node

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const discoveryPath =
  process.env.LUMEN_BRIDGE_DISCOVERY ??
  join(tmpdir(), 'lumen-agent-bridge.json');
const pretty = process.argv.includes('--pretty');
const args = process.argv.slice(2).filter((arg) => arg !== '--pretty');

const configRoot =
  process.env.XDG_CONFIG_HOME ??
  (process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32'
      ? process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
      : join(homedir(), '.config'));
const credentialPath = process.env.LUMEN_CREDENTIALS ?? join(configRoot, 'lumen', 'credentials.json');

async function readCredentials() {
  try {
    return JSON.parse(await readFile(credentialPath, 'utf8'));
  } catch {
    return {};
  }
}

async function token() {
  return process.env.LUMEN_AGENT_TOKEN ?? (await readCredentials()).token ?? '';
}

async function saveCredentials(credentials) {
  const directory = dirname(credentialPath);
  const temporaryPath = `${credentialPath}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, credentialPath);
}

async function discovery() {
  return JSON.parse(await readFile(discoveryPath, 'utf8'));
}

async function rpc(method, params = {}) {
  const info = await discovery();
  const authToken = await token();
  const response = await fetch(`http://127.0.0.1:${info.port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message ?? `Bridge returned HTTP ${response.status}`);
    error.code = body.error?.code ?? 'BRIDGE_UNAVAILABLE';
    throw error;
  }
  return body.result;
}

function print(result) {
  process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : 0)}\n`);
}

async function cli() {
  const [command, subcommand, ...rest] = args;
  if (command === 'mcp') return mcp();
  if (command === 'connect') return connect(rest);
  if (command === 'disconnect') return disconnect();
  if (command === 'status') return print(await fetch(`http://127.0.0.1:${(await discovery()).port}/health`).then((r) => r.json()));
  if (command === 'capabilities') return print(await rpc('system.capabilities'));
  if (command === 'context') return print(await rpc('reader.get_context', { scope: subcommand ?? 'current_page' }));
  if (command === 'chapters') return print(await rpc('reader.list_chapters'));
  if (command === 'source') return print(await rpc('reader.get_source', { cfi: option(rest, '--cfi') }));
  if (command === 'search') return print(await rpc('reader.search', { query: option(rest, '--query'), scope: option(rest, '--scope') ?? 'current_page' }));
  if (command === 'annotations' && subcommand === 'list') return print(await rpc('annotations.list'));
  throw Object.assign(new Error('Usage: lumen connect|disconnect|status|capabilities|context|chapters|search|source|annotations list|mcp'), { code: 'INVALID_REQUEST' });
}

function option(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

async function mcp() {
  const tools = [
    ['lumen_system_health', 'Check Lumen Agent Bridge health', 'system.health'],
    ['lumen_system_capabilities', 'Discover Lumen read-only capabilities', 'system.capabilities'],
    ['lumen_reader_get_context', 'Get the current reader context', 'reader.get_context'],
    ['lumen_reader_list_chapters', 'List chapters in the authorized book', 'reader.list_chapters'],
    ['lumen_reader_search', 'Search authorized reader text and return citable sources', 'reader.search'],
    ['lumen_reader_get_source', 'Get source text for a CFI', 'reader.get_source'],
    ['lumen_annotations_list', 'List existing annotations', 'annotations.list'],
  ];
  const input = createInterface({ input: process.stdin });
  for await (const line of input) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    let result;
    if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'lumen', version: '1.0.0' } };
    else if (request.method === 'notifications/initialized') continue;
    else if (request.method === 'tools/list') result = { tools: tools.map(([name, description]) => ({ name, description, inputSchema: { type: 'object', additionalProperties: true } })) };
    else if (request.method === 'tools/call') {
      const item = tools.find(([name]) => name === request.params?.name);
      if (!item) throw new Error('Unknown MCP tool');
      let value;
      try {
        value = await rpc(item[2], request.params?.arguments ?? {});
      } catch (error) {
        if (error?.code !== 'AUTH_REQUIRED' && error?.code !== 'AUTH_REVOKED') throw error;
        const pairing = await rpcUnauthenticated('system.request_pairing', {
          displayName: process.env.LUMEN_AGENT_NAME ?? 'Codex',
          clientType: 'mcp',
        });
        await saveCredentials({
          token: pairing.token,
          agentId: pairing.agent.agentId,
          displayName: pairing.agent.displayName,
        });
        value = await rpc(item[2], request.params?.arguments ?? {});
      }
      result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
    } else result = {};
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
  }
}

async function connect(values) {
  const code = option(values, '--code') ?? (await prompt('Pairing code from Lumen: '));
  if (!/^\d{6}$/.test(code)) throw Object.assign(new Error('Pairing code must be a 6-digit number'), { code: 'INVALID_REQUEST' });
  const result = await rpcUnauthenticated('system.pair', {
    pairingCode: code,
    displayName: option(values, '--name') ?? 'lumen',
    clientType: 'mcp',
  });
  await saveCredentials({ token: result.token, agentId: result.agent.agentId, displayName: result.agent.displayName });
  print({ connected: true, agent: result.agent, grants: result.grants });
}

async function disconnect() {
  let disconnectError;
  try {
    if (await token()) await rpc('system.disconnect');
  } catch (error) {
    if (error?.code !== 'AUTH_REQUIRED' && error?.code !== 'AUTH_REVOKED') disconnectError = error;
  } finally {
    await saveCredentials({});
  }
  if (disconnectError) throw disconnectError;
  print({ disconnected: true });
}

async function rpcUnauthenticated(method, params = {}) {
  const info = await discovery();
  const response = await fetch(`http://127.0.0.1:${info.port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message ?? `Bridge returned HTTP ${response.status}`);
    error.code = body.error?.code ?? 'BRIDGE_UNAVAILABLE';
    throw error;
  }
  return body.result;
}

function prompt(message) {
  const input = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => input.question(message, (answer) => { input.close(); resolve(answer.trim()); }));
}

cli().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.code === 'AUTH_REQUIRED' || error.code === 'AUTH_REVOKED' ? 3 : error.code === 'INVALID_REQUEST' ? 2 : 4;
});
