import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useEnv } from '@/context/EnvContext';
import { AgentDb, AgentClient, AgentActionRecord } from '@/services/agent-bridge/AgentDb';
import type { AgentApproval, ReadingArtifact } from '@/services/agent-bridge/protocol';
import {
  createAgentPairingCode,
  getAgentBridgeInfo,
  resolveAgentApproval,
  startAgentBridge,
  subscribeAgentBridge,
} from '@/services/agent-bridge/AgentBridgeService';
import { useSidebarStore } from '@/store/sidebarStore';
import { useReaderStore } from '@/store/readerStore';
import { isTauriAppPlatform } from '@/services/environment';

interface AgentCliStatus {
  installed: boolean;
  path: string;
}

const AgentAccessPanel: React.FC = () => {
  const { appService } = useEnv();
  const [agents, setAgents] = useState<AgentClient[]>([]);
  const [approvals, setApprovals] = useState<Array<AgentApproval & { agentId: string }>>([]);
  const [actions, setActions] = useState<Array<AgentActionRecord & { agentName: string }>>([]);
  const [artifacts, setArtifacts] = useState<ReadingArtifact[]>([]);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [bridgeInfo, setBridgeInfo] = useState(getAgentBridgeInfo());
  const [cliStatus, setCliStatus] = useState<AgentCliStatus | null>(null);
  const currentBookKey = useSidebarStore((state) => state.sideBarBookKey);
  const currentBookHash = currentBookKey?.split('-')[0];

  const refresh = async () => {
    if (!appService) return;
    try {
      const db = await AgentDb.open(appService);
      const clients = await db.listClients();
      setAgents(clients);
      const allApprovals = await Promise.all(
        clients.map(async (agent) =>
          (await db.listApprovals(agent.agentId)).map((approval) => ({
            ...approval,
            agentId: agent.agentId,
          })),
        ),
      );
      setApprovals(allApprovals.flat().filter((approval) => approval.status === 'pending'));
      const allActions = await Promise.all(
        clients.map(async (agent) =>
          (await db.listActions(agent.agentId, 20)).map((action) => ({
            ...action,
            agentName: agent.displayName,
          })),
        ),
      );
      setActions(
        allActions
          .flat()
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 50),
      );
      const allArtifacts = await Promise.all(
        clients.map((agent) => db.listArtifacts(agent.agentId)),
      );
      setArtifacts(
        allArtifacts
          .flat()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 20),
      );
      await db.close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open Agent access');
    }
  };

  useEffect(() => {
    void refresh();
    if (isTauriAppPlatform()) {
      void invoke<AgentCliStatus>('agent_cli_status')
        .then(setCliStatus)
        .catch(() => undefined);
    }
  }, [appService]);

  useEffect(() => subscribeAgentBridge(setBridgeInfo), []);

  const pair = async () => {
    setError(null);
    try {
      if (!appService) throw new Error('Agent Bridge is still starting');
      if (!bridgeInfo) await startAgentBridge(appService);
      const code = await createAgentPairingCode();
      if (!code) throw new Error('Agent Bridge is not running');
      setPairing(code);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to generate pairing code');
    }
  };

  const installCli = async () => {
    setError(null);
    setConnectionMessage(null);
    try {
      const status = await invoke<AgentCliStatus>('agent_cli_install');
      setCliStatus(status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to install Lumen CLI');
    }
  };

  const connectCodex = async () => {
    setError(null);
    setConnectionMessage(null);
    try {
      await invoke('agent_cli_connect_codex');
      setConnectionMessage('Codex is connected to Lumen. Restart Codex if it is already running.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to connect Codex');
    }
  };

  const revoke = async (agentId: string) => {
    if (!appService) return;
    const db = await AgentDb.open(appService);
    await db.revokeClient(agentId);
    await db.close();
    await refresh();
  };

  const exportArtifact = (artifact: ReadingArtifact) => {
    const blob = new Blob([`# ${artifact.title}\n\n${artifact.contentMarkdown}`], {
      type: 'text/markdown',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${artifact.title.replace(/[^a-z0-9\-_]+/gi, '-').toLowerCase() || 'lumen-artifact'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const updateCurrentBookGrant = async (
    agentId: string,
    permission: 'read' | 'write',
    enabled: boolean,
  ) => {
    if (!appService || !currentBookHash) return;
    const db = await AgentDb.open(appService);
    if (enabled) {
      await db.upsertGrant({
        id: crypto.randomUUID(),
        agentId,
        resourceType: 'book',
        resourceKey: currentBookHash,
        permission,
      });
    } else {
      await db.revokeGrant(agentId, 'book', currentBookHash, permission);
    }
    await db.close();
    await refresh();
  };

  const openArtifactSource = (artifact: ReadingArtifact) => {
    const source = artifact.sourceSnapshot[0];
    if (!source) return;
    const viewKey = useReaderStore
      .getState()
      .bookKeys.find((key) => key.split('-')[0] === artifact.bookHash);
    void useReaderStore
      .getState()
      .getView(viewKey ?? artifact.bookHash)
      ?.goTo(source.startCfi);
  };

  return (
    <div className='flex flex-col gap-5 p-4' data-setting-id='settings.agentAccess.main'>
      <div>
        <h2 className='text-lg font-semibold'>Agent Access</h2>
        <p className='text-base-content/70 text-sm'>
          Connect local agents to read Lumen’s current book. This panel does not provide chat.
        </p>
      </div>
      <div className='rounded-box border border-base-300 p-3 text-sm'>
        <div className='font-medium'>Bridge status</div>
        <div className='text-base-content/70 mt-1'>
          {bridgeInfo ? `Running on 127.0.0.1:${bridgeInfo.port}` : 'Not running'}
        </div>
      </div>
      {isTauriAppPlatform() && (
        <div className='rounded-box border border-base-300 p-3 text-sm'>
          <div className='font-medium'>Lumen Agent CLI</div>
          <div className='text-base-content/70 mt-1'>
            {cliStatus?.installed ? `Installed at ${cliStatus.path}` : 'Not installed'}
          </div>
          <div className='mt-3 flex flex-wrap gap-2'>
            {!cliStatus?.installed && (
              <button
                type='button'
                className='btn btn-primary btn-sm'
                onClick={() => void installCli()}
              >
                Install CLI
              </button>
            )}
            {cliStatus?.installed && (
              <button
                type='button'
                className='btn btn-primary btn-sm'
                onClick={() => void connectCodex()}
              >
                Connect Codex
              </button>
            )}
          </div>
          <p className='text-base-content/55 mt-2 text-xs'>
            Install the local command used by Codex to access Lumen’s Reader tools.
          </p>
        </div>
      )}
      <button type='button' className='btn btn-primary' onClick={() => void pair()}>
        Generate pairing code
      </button>
      {pairing && (
        <div className='rounded-box border border-base-300 p-4 text-center'>
          <div className='text-base-content/70 text-sm'>Show this once to your local Agent</div>
          <div className='my-2 text-3xl font-mono tracking-[0.35em]'>{pairing.code}</div>
          <div className='text-base-content/60 text-xs'>
            Expires at {new Date(pairing.expiresAt).toLocaleTimeString()}
          </div>
        </div>
      )}
      {error && <p className='text-error text-sm'>{error}</p>}
      {connectionMessage && <p className='text-success text-sm'>{connectionMessage}</p>}
      {approvals.length > 0 && (
        <div>
          <h3 className='font-medium'>Pending approvals</h3>
          {approvals.map((approval) => (
            <div key={approval.approvalId} className='border-b border-base-300 py-3'>
              <pre className='max-h-24 overflow-auto whitespace-pre-wrap text-xs'>
                {JSON.stringify(approval.preview, null, 2)}
              </pre>
              <div className='mt-2 flex gap-2'>
                <button
                  type='button'
                  className='btn btn-primary btn-sm'
                  onClick={() =>
                    void resolveAgentApproval(approval.agentId, approval.approvalId, true).then(
                      refresh,
                    )
                  }
                >
                  Approve
                </button>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm'
                  onClick={() =>
                    void resolveAgentApproval(approval.agentId, approval.approvalId, false).then(
                      refresh,
                    )
                  }
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div>
        <h3 className='font-medium'>Activity Center</h3>
        {actions.length === 0 ? (
          <p className='text-base-content/60 mt-2 text-sm'>No Agent activity yet.</p>
        ) : (
          actions.map((action) => (
            <div
              key={action.actionId}
              className='flex justify-between border-b border-base-300 py-2 text-sm'
            >
              <span>
                {action.agentName} · {action.method}
              </span>
              <span className='text-base-content/60'>{action.status}</span>
            </div>
          ))
        )}
      </div>
      {artifacts.length > 0 && (
        <div>
          <h3 className='font-medium'>Artifacts</h3>
          {artifacts.map((artifact) => (
            <div
              key={artifact.artifactId}
              className='flex items-center justify-between border-b border-base-300 py-2 text-sm'
            >
              <div>
                <div className='font-medium'>{artifact.title}</div>
                <div className='text-base-content/60'>
                  {artifact.type} · {new Date(artifact.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className='flex gap-1'>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm'
                  onClick={() => openArtifactSource(artifact)}
                  disabled={artifact.sourceSnapshot.length === 0}
                >
                  Open source
                </button>
                <button
                  type='button'
                  className='btn btn-ghost btn-sm'
                  onClick={() => exportArtifact(artifact)}
                >
                  Export Markdown
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div>
        <h3 className='font-medium'>Paired agents</h3>
        {agents.length === 0 ? (
          <p className='text-base-content/60 mt-2 text-sm'>No agents paired.</p>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.agentId}
              className='flex items-center justify-between border-b border-base-300 py-3'
            >
              <div>
                <div className='font-medium'>{agent.displayName}</div>
                <div className='text-base-content/60 text-xs'>
                  {agent.clientType} · read-only by default
                </div>
              </div>
              {currentBookHash && (
                <label className='flex items-center gap-1 text-xs'>
                  <input
                    type='checkbox'
                    className='checkbox checkbox-sm'
                    onChange={(event) =>
                      void updateCurrentBookGrant(agent.agentId, 'write', event.target.checked)
                    }
                  />
                  write current book
                </label>
              )}
              <button
                type='button'
                className='btn btn-ghost btn-sm'
                onClick={() => void revoke(agent.agentId)}
              >
                Revoke
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AgentAccessPanel;
