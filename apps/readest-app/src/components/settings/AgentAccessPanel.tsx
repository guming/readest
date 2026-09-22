import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  PiArrowSquareOut,
  PiCheckCircleFill,
  PiDownloadSimple,
  PiKey,
  PiPulse,
  PiRobot,
  PiTerminalWindow,
  PiTrash,
  PiUsersThree,
  PiWarningCircle,
} from 'react-icons/pi';
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
import BoxedList from './primitives/BoxedList';

const IconChip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className='bg-base-200 text-base-content/65 flex h-8 w-8 shrink-0 items-center justify-center rounded-full'>
    {children}
  </span>
);

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
    <div className='flex flex-col gap-6 p-4 sm:p-5' data-setting-id='settings.agentAccess.main'>
      <div>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>Agent Access</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          Let local agents work with your current book. Chat stays in your agent app.
        </p>
      </div>

      <BoxedList title='Connection'>
        <div className='flex min-h-16 items-center gap-3 pe-4'>
          <IconChip>
            {bridgeInfo ? (
              <PiCheckCircleFill className='text-success h-4 w-4' aria-hidden='true' />
            ) : (
              <PiWarningCircle className='h-4 w-4' aria-hidden='true' />
            )}
          </IconChip>
          <div className='min-w-0 flex-1'>
            <div className='font-medium'>Local bridge</div>
            <div className='text-base-content/65 truncate text-[0.8em] leading-snug'>
              {bridgeInfo ? `Running on 127.0.0.1:${bridgeInfo.port}` : 'Not running'}
            </div>
          </div>
          <span className='bg-base-200 text-base-content/65 rounded-full px-2.5 py-1 text-[0.75em] font-medium'>
            {bridgeInfo ? 'Active' : 'Offline'}
          </span>
        </div>

        {isTauriAppPlatform() && (
          <div className='flex min-h-16 items-center gap-3 pe-3'>
            <IconChip>
              <PiTerminalWindow className='h-4 w-4' aria-hidden='true' />
            </IconChip>
            <div className='min-w-0 flex-1'>
              <div className='font-medium'>Lumen Agent CLI</div>
              <div className='text-base-content/65 truncate text-[0.8em] leading-snug'>
                {cliStatus?.installed ? cliStatus.path : 'Not installed on this device'}
              </div>
            </div>
            <button
              type='button'
              className='btn btn-ghost btn-sm shrink-0 gap-1.5'
              onClick={() => void (cliStatus?.installed ? connectCodex() : installCli())}
            >
              {cliStatus?.installed ? (
                <PiArrowSquareOut className='h-4 w-4' aria-hidden='true' />
              ) : (
                <PiDownloadSimple className='h-4 w-4' aria-hidden='true' />
              )}
              {cliStatus?.installed ? 'Connect' : 'Install'}
            </button>
          </div>
        )}

        <div className='flex min-h-16 items-center gap-3 pe-3'>
          <IconChip>
            <PiKey className='h-4 w-4' aria-hidden='true' />
          </IconChip>
          <div className='min-w-0 flex-1'>
            <div className='font-medium'>Pair another agent</div>
            <div className='text-base-content/65 text-[0.8em] leading-snug'>
              Create a short-lived code for this device
            </div>
          </div>
          <button
            type='button'
            className='btn btn-primary btn-sm shrink-0'
            onClick={() => void pair()}
          >
            Generate code
          </button>
        </div>
      </BoxedList>

      {pairing && (
        <div className='eink-bordered border-base-200 bg-base-100 rounded-lg border p-5 text-center'>
          <div className='text-base-content/65 text-[0.8em]'>
            Share this once with your local agent
          </div>
          <div className='my-2 font-mono text-3xl font-semibold tracking-[0.28em]'>
            {pairing.code}
          </div>
          <div className='text-base-content/55 text-[0.75em]'>
            Expires at {new Date(pairing.expiresAt).toLocaleTimeString()}
          </div>
        </div>
      )}
      {error && (
        <p className='text-error flex items-center gap-2 text-sm'>
          <PiWarningCircle className='h-4 w-4 shrink-0' aria-hidden='true' />
          {error}
        </p>
      )}
      {connectionMessage && (
        <p className='text-success flex items-center gap-2 text-sm'>
          <PiCheckCircleFill className='h-4 w-4 shrink-0' aria-hidden='true' />
          {connectionMessage}
        </p>
      )}
      {approvals.length > 0 && (
        <BoxedList title='Pending approvals'>
          {approvals.map((approval) => (
            <div key={approval.approvalId} className='py-3 pe-4'>
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
        </BoxedList>
      )}
      <BoxedList title='Activity'>
        {actions.length === 0 ? (
          <div className='text-base-content/60 flex min-h-16 items-center gap-3 pe-4'>
            <IconChip>
              <PiPulse className='h-4 w-4' aria-hidden='true' />
            </IconChip>
            <span>No agent activity yet</span>
          </div>
        ) : (
          actions.map((action) => (
            <div
              key={action.actionId}
              className='flex min-h-14 items-center justify-between gap-3 pe-4'
            >
              <span className='min-w-0 truncate'>
                {action.agentName} · {action.method}
              </span>
              <span className='text-base-content/60 shrink-0 text-[0.8em]'>{action.status}</span>
            </div>
          ))
        )}
      </BoxedList>
      {artifacts.length > 0 && (
        <BoxedList title='Artifacts'>
          {artifacts.map((artifact) => (
            <div
              key={artifact.artifactId}
              className='flex min-h-16 items-center justify-between gap-3 pe-2'
            >
              <div className='min-w-0 flex-1'>
                <div className='font-medium'>{artifact.title}</div>
                <div className='text-base-content/60 truncate text-[0.8em]'>
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
        </BoxedList>
      )}
      <BoxedList title='Paired agents'>
        {agents.length === 0 ? (
          <div className='text-base-content/60 flex min-h-16 items-center gap-3 pe-4'>
            <IconChip>
              <PiUsersThree className='h-4 w-4' aria-hidden='true' />
            </IconChip>
            <span>No agents paired</span>
          </div>
        ) : (
          agents.map((agent) => (
            <div key={agent.agentId} className='flex min-h-16 flex-wrap items-center gap-3 pe-2'>
              <IconChip>
                <PiRobot className='h-4 w-4' aria-hidden='true' />
              </IconChip>
              <div className='min-w-[9rem] flex-1'>
                <div className='font-medium'>{agent.displayName}</div>
                <div className='text-base-content/60 text-[0.8em]'>
                  {agent.clientType} · read-only by default
                </div>
              </div>
              {currentBookHash && (
                <label className='flex cursor-pointer items-center gap-2 text-[0.8em]'>
                  <input
                    type='checkbox'
                    className='toggle toggle-sm'
                    onChange={(event) =>
                      void updateCurrentBookGrant(agent.agentId, 'write', event.target.checked)
                    }
                  />
                  Write current book
                </label>
              )}
              <button
                type='button'
                className='btn btn-ghost btn-circle btn-sm text-error shrink-0'
                aria-label={`Revoke ${agent.displayName}`}
                title={`Revoke ${agent.displayName}`}
                onClick={() => void revoke(agent.agentId)}
              >
                <PiTrash className='h-4 w-4' aria-hidden='true' />
              </button>
            </div>
          ))
        )}
      </BoxedList>
    </div>
  );
};

export default AgentAccessPanel;
