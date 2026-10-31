'use client';

import { useEffect, useState } from 'react';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { discoverSiteToc, MAX_CHAPTERS, type SiteToc } from '@/services/site/siteBook';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (
    toc: SiteToc,
    onProgress: (done: number, total: number) => void,
  ) => Promise<{ failed: { title: string; url: string }[] }>;
}

export default function ImportSiteDialog({ isOpen, onClose, onImport }: Props) {
  const _ = useTranslation();
  const [url, setUrl] = useState('');
  const [toc, setToc] = useState<SiteToc | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<'all' | 'current'>('all');
  const [failed, setFailed] = useState<{ title: string; url: string }[] | null>(null);
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
    setScope('all');
    setFailed(null);
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
      const selected = scope === 'current' && toc.currentPage ? [toc.currentPage] : toc.chapters;
      const result = await onImport({ ...toc, chapters: selected }, (done, total) =>
        setProgress(`${done} / ${total}`),
      );
      setBusy(false);
      if (result.failed.length) setFailed(result.failed);
      else close();
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
          <div className='space-y-3 text-sm'>
            <div>
              <strong>{toc.title}</strong>
              {toc.version && ` · ${toc.version}`}
            </div>
            <div className='break-all text-base-content/65'>{toc.url}</div>
            {toc.currentPage && (
              <div className='flex flex-wrap gap-4'>
                <label>
                  <input
                    type='radio'
                    name='site-scope'
                    checked={scope === 'all'}
                    disabled={busy || !!failed}
                    onChange={() => setScope('all')}
                  />{' '}
                  {_('All chapters')}
                </label>
                <label>
                  <input
                    type='radio'
                    name='site-scope'
                    checked={scope === 'current'}
                    disabled={busy || !!failed}
                    onChange={() => setScope('current')}
                  />{' '}
                  {_('Current page only')}
                </label>
              </div>
            )}
            {scope === 'all' && (toc.totalChapters ?? 0) > MAX_CHAPTERS && (
              <p className='text-warning'>
                {_('Only the first 200 chapters will be imported.')} ({toc.totalChapters})
              </p>
            )}
            <div className='eink-bordered max-h-64 overflow-y-auto rounded border border-base-300 p-3'>
              <strong>
                {scope === 'current' ? 1 : toc.chapters.length} {_('Chapters')}
              </strong>
              <ol className='mt-2 space-y-1'>
                {(scope === 'current' && toc.currentPage ? [toc.currentPage] : toc.chapters).map(
                  (chapter) => (
                    <li key={chapter.url} className='break-words'>
                      {'group' in chapter && chapter.group ? `${chapter.group} / ` : ''}
                      {chapter.title}
                    </li>
                  ),
                )}
              </ol>
            </div>
            {failed && (
              <div className='text-error'>
                {_('Some chapters could not be downloaded:')}
                <ul>
                  {failed.map((chapter) => (
                    <li key={chapter.url}>{chapter.title}</li>
                  ))}
                </ul>
              </div>
            )}
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
            {failed ? _('Retry') : toc ? _('Confirm Import') : _('Preview')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
