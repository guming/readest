'use client';

import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import ModalPortal from '@/components/ModalPortal';
import { resolveAgentPairing } from '@/services/agent-bridge/AgentBridgeService';
import { isTauriAppPlatform } from '@/services/environment';

interface PairingRequest {
  requestId: string;
  displayName: string;
  clientType: string;
  permissions: string[];
  expiresAt: number;
}

export default function AgentPairingDialog() {
  const [request, setRequest] = useState<PairingRequest | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<PairingRequest>('agent-pairing-request', (event) => {
      if (active) {
        setBusy(false);
        setRequest(event.payload);
      }
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  if (!request) return null;

  const resolve = async (approved: boolean) => {
    setBusy(true);
    try {
      await resolveAgentPairing(request.requestId, approved);
      setRequest(null);
    } catch {
      setRequest(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalPortal>
      <dialog className='modal modal-open'>
        <div className='modal-box bg-base-100 w-[min(420px,calc(100vw-2rem))] rounded-2xl p-0'>
          <div className='border-base-content/10 border-b px-6 pb-5 pt-7'>
            <h3 className='text-base-content text-base font-semibold tracking-tight'>
              Agent access request
            </h3>
            <p className='text-base-content/65 mt-2 text-[13px] leading-relaxed'>
              {request.displayName} wants to connect to Lumen and read the current book.
            </p>
          </div>
          <div className='px-6 py-5'>
            <div className='rounded-xl border border-base-300 px-4 py-3 text-sm'>
              <div className='font-medium'>Requested permission</div>
              <div className='text-base-content/65 mt-1'>Read current book</div>
            </div>
            <p className='text-base-content/55 mt-3 text-xs'>
              The connection is local to this device. You can revoke it later in Agent Access.
            </p>
          </div>
          <div className='border-base-content/10 flex gap-2 border-t px-6 py-4'>
            <button
              type='button'
              className='eink-bordered text-base-content hover:bg-base-200 h-10 flex-1 rounded-xl border border-transparent text-sm font-medium transition-colors'
              disabled={busy}
              onClick={() => void resolve(false)}
            >
              Deny
            </button>
            <button
              type='button'
              className='btn btn-contrast h-10 min-h-0 flex-1 rounded-xl text-sm font-medium'
              disabled={busy}
              onClick={() => void resolve(true)}
            >
              Allow
            </button>
          </div>
        </div>
      </dialog>
    </ModalPortal>
  );
}
