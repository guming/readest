'use client';

import { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { discoverSiteToc, type SiteToc } from '@/services/site/siteBook';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (toc: SiteToc, onProgress: (done: number, total: number) => void) => Promise<void>;
}

export default function ImportSiteDialog({ isOpen, onClose, onImport }: Props) {
  const _ = useTranslation();
  const [url, setUrl] = useState('');
  const [toc, setToc] = useState<SiteToc | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setProgress('');
      setError('');
    }
  }, [isOpen]);

  const close = () => {
    if (busy) return;
    setToc(null);
    setUrl('');
    setError('');
    onClose();
  };

  const discover = async () => {
    setBusy(true);
    setError('');
    try {
      setToc(await discoverSiteToc(url.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importSite = async () => {
    if (!toc) return;
    setBusy(true);
    setError('');
    try {
      await onImport(toc, (done, total) => setProgress(`${done} / ${total}`));
      setBusy(false);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={close}
      title={_('Import Website')}
      boxClassName='sm:!w-[560px] sm:!max-w-[560px]'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        <p className='text-base-content/65 text-sm'>
          {_('Enter a website with a table of contents. Review the chapters before importing.')}
        </p>
        <input
          type='url'
          className='input input-bordered eink-bordered w-full'
          placeholder='https://example.com/'
          value={url}
          disabled={busy || !!toc}
          onChange={(event) => setUrl(event.target.value)}
        />
        {toc && (
          <div className='eink-bordered max-h-64 overflow-y-auto rounded border border-base-300 p-3 text-sm'>
            <strong>
              {toc.title} · {toc.chapters.length} {_('Chapters')}
            </strong>
            <ol className='mt-2 list-inside list-decimal space-y-1'>
              {toc.chapters.map((chapter) => (
                <li key={chapter.url} className='truncate'>
                  {chapter.title}
                </li>
              ))}
            </ol>
          </div>
        )}
        {progress && <p className='text-base-content/60 text-sm'>{progress}</p>}
        {error && <p className='text-error text-sm'>{error}</p>}
        <div className='flex justify-end gap-2'>
          <button type='button' className='btn btn-ghost btn-sm' onClick={close} disabled={busy}>
            {_('Cancel')}
          </button>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            disabled={busy || (!toc && !url.trim())}
            onClick={() => void (toc ? importSite() : discover())}
          >
            {busy && <span className='loading loading-spinner loading-xs' />}
            {toc ? _('Import') : _('Preview')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
