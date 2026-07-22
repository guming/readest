import { useMemo, useState } from 'react';
import { MdContentCopy, MdLibraryAdd, MdOpenInNew, MdSave } from 'react-icons/md';

import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { writeTextToClipboard } from '@/utils/clipboard';
import { eventDispatcher } from '@/utils/event';
import { openExternalUrl } from '@/utils/open';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { uniqueId } from '@/utils/misc';
import { getArxivPdfUrl, importArxivPaper } from '../utils/arxiv';
import {
  isPageReferenceSaved,
  type PageReferenceSaveType,
  upsertPageReferenceNote,
} from '../utils/pageReferenceNotes';
import {
  formatExternalReferencesAsMarkdown,
  type PageReference,
  type PageReferenceKind,
} from '../utils/pageReferences';

interface PageReferencesDialogProps {
  bookKey: string;
  isOpen: boolean;
  references: PageReference[];
  onClose: () => void;
}

const GROUPS: PageReferenceKind[] = ['external', 'footnote', 'internal'];

const PageReferencesDialog = ({
  bookKey,
  isOpen,
  references,
  onClose,
}: PageReferencesDialogProps) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getView } = useReaderStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { library, setLibrary } = useLibraryStore();
  const [editingReference, setEditingReference] = useState<PageReference | null>(null);
  const [saveType, setSaveType] = useState<PageReferenceSaveType>('reference');
  const [userNote, setUserNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [importingPaperId, setImportingPaperId] = useState<string | null>(null);
  const markdown = useMemo(() => formatExternalReferencesAsMarkdown(references), [references]);

  const groupTitle = (kind: PageReferenceKind) => {
    if (kind === 'external') return _('External references');
    if (kind === 'footnote') return _('Footnotes');
    return _('In-book links');
  };

  const itemTitle = (reference: PageReference) =>
    reference.kind === 'footnote'
      ? _('Footnote {{label}}', { label: reference.title })
      : reference.title;

  const itemDescription = (reference: PageReference) => {
    if (reference.description) return reference.description;
    if (reference.kind !== 'external' || !reference.absoluteUrl) return _('In-book link');
    try {
      const url = new URL(reference.absoluteUrl);
      return url.protocol === 'mailto:' ? reference.absoluteUrl : url.hostname;
    } catch {
      return reference.absoluteUrl;
    }
  };

  const copy = async (text: string) => {
    const copied = await writeTextToClipboard(text);
    await eventDispatcher.dispatch('toast', {
      type: copied ? 'success' : 'error',
      message: copied ? _('Copied to clipboard') : _('Failed to copy'),
    });
  };

  const navigate = async (reference: PageReference) => {
    const view = getView(bookKey);
    const target = reference.targetCfi ?? reference.href;
    let resolved;
    try {
      resolved = view?.resolveNavigation(target);
    } catch {
      resolved = undefined;
    }
    if (!resolved || typeof resolved.index !== 'number') {
      await eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Could not open link'),
      });
      return;
    }
    view?.goTo(target);
    onClose();
  };

  const beginSave = (reference: PageReference) => {
    setEditingReference(reference);
    setSaveType(reference.kind === 'external' ? 'reference' : 'annotation');
    setUserNote('');
  };

  const importPaper = async (reference: PageReference) => {
    if (!appService || !reference.absoluteUrl || importingPaperId) return;
    setImportingPaperId(reference.id);
    try {
      const book = await importArxivPaper(appService, library, reference.absoluteUrl);
      setLibrary([...library]);
      await eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Added “{{title}}” to your library', { title: book.title }),
      });
    } catch (error) {
      console.error('Failed to import arXiv paper', error);
      await eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to import paper'),
      });
    } finally {
      setImportingPaperId(null);
    }
  };

  const saveReference = async () => {
    if (!editingReference || saving) return;
    const config = getConfig(bookKey);
    if (!config) return;
    const style = settings.globalReadSettings.highlightStyle;
    const color = settings.globalReadSettings.highlightStyles[style];
    const result = upsertPageReferenceNote(
      config.booknotes ?? [],
      editingReference,
      saveType,
      userNote,
      { now: Date.now(), createId: uniqueId, style, color },
    );
    if (result.status === 'missing-location' || result.status === 'duplicate') {
      await eventDispatcher.dispatch('toast', {
        type: result.status === 'duplicate' ? 'info' : 'error',
        message:
          result.status === 'duplicate'
            ? _('This item is already saved')
            : _('Could not determine the source location'),
      });
      return;
    }
    setSaving(true);
    try {
      const updatedConfig = updateBooknotes(bookKey, result.notes);
      if (!updatedConfig) throw new Error('Book config unavailable');
      await saveConfig(envConfig, bookKey, updatedConfig, settings);
      if (saveType === 'annotation' && result.note) {
        getView(bookKey)?.addAnnotation(result.note);
      }
      await eventDispatcher.dispatch('toast', { type: 'success', message: _('Saved to Notebook') });
      setEditingReference(null);
      setUserNote('');
    } catch (error) {
      console.error('Failed to save page reference', error);
      await eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to save to Notebook'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      id={`page-references-${bookKey}`}
      isOpen={isOpen}
      title={_('References on this page')}
      snapHeight={0.72}
      boxClassName='sm:h-[65%] sm:max-w-[640px]'
      contentClassName='!px-4 sm:!px-6'
      onClose={onClose}
    >
      {editingReference ? (
        <div className='flex h-full flex-col gap-4 pb-4'>
          <div className='bg-base-200 eink-bordered rounded-lg p-3'>
            <p className='font-medium'>{itemTitle(editingReference)}</p>
            <p className='text-base-content/60 mt-1 text-sm'>{itemDescription(editingReference)}</p>
          </div>
          <fieldset>
            <legend className='mb-2 text-sm font-medium'>{_('Save as')}</legend>
            <div className='grid grid-cols-2 gap-2'>
              {(['annotation', 'reference'] as const).map((type) => (
                <label
                  key={type}
                  className='eink-bordered border-base-300 flex cursor-pointer items-center gap-2 rounded-lg border p-3'
                >
                  <input
                    type='radio'
                    name='page-reference-save-type'
                    value={type}
                    checked={saveType === type}
                    onChange={() => setSaveType(type)}
                  />
                  {type === 'annotation' ? _('Annotation') : _('Reference link')}
                </label>
              ))}
            </div>
          </fieldset>
          <label className='flex flex-1 flex-col gap-2 text-sm font-medium'>
            {_('Optional note')}
            <textarea
              className='textarea textarea-bordered eink-bordered min-h-28 w-full flex-1 resize-none'
              value={userNote}
              onChange={(event) => setUserNote(event.target.value)}
              placeholder={_('Add a note...')}
            />
          </label>
          <div className='flex justify-end gap-2'>
            <button
              type='button'
              className='btn btn-ghost'
              onClick={() => setEditingReference(null)}
            >
              {_('Cancel')}
            </button>
            <button
              type='button'
              className='btn btn-primary'
              disabled={saving}
              onClick={() => void saveReference()}
            >
              {saving ? _('Saving...') : _('Save to Notebook')}
            </button>
          </div>
        </div>
      ) : references.length === 0 ? (
        <div className='flex h-full items-center justify-center px-4 text-center'>
          <p className='text-base-content/60'>{_('No reference links found on this page')}</p>
        </div>
      ) : (
        <div className='flex flex-col gap-5 pb-4'>
          {GROUPS.map((kind) => {
            const items = references.filter((reference) => reference.kind === kind);
            if (items.length === 0) return null;
            return (
              <section key={kind} aria-labelledby={`page-references-${kind}-${bookKey}`}>
                <h2
                  id={`page-references-${kind}-${bookKey}`}
                  className='text-base-content/60 mb-2 text-xs font-semibold uppercase tracking-wide'
                >
                  {groupTitle(kind)} · {items.length}
                </h2>
                <ul className='divide-base-300 eink-bordered divide-y rounded-lg border'>
                  {items.map((reference) => (
                    <li key={reference.id} className='flex items-center gap-3 p-3'>
                      <div className='min-w-0 flex-1'>
                        <p className='line-clamp-2 break-words font-medium'>
                          {itemTitle(reference)}
                        </p>
                        <p className='text-base-content/60 mt-0.5 line-clamp-2 break-words text-xs'>
                          {itemDescription(reference)}
                          {reference.occurrences > 1
                            ? ` · ${_('{{count}} occurrences', { count: reference.occurrences })}`
                            : ''}
                        </p>
                      </div>
                      <div className='flex shrink-0 items-center gap-1'>
                        {getArxivPdfUrl(reference.absoluteUrl) && (
                          <button
                            type='button'
                            className='btn btn-ghost btn-sm btn-circle'
                            title={_('Import paper to library')}
                            aria-label={_('Import paper to library')}
                            disabled={!!importingPaperId}
                            onClick={() => void importPaper(reference)}
                          >
                            {importingPaperId === reference.id ? (
                              <span className='loading loading-spinner loading-xs' />
                            ) : (
                              <MdLibraryAdd />
                            )}
                          </button>
                        )}
                        <button
                          type='button'
                          className='btn btn-ghost btn-sm btn-circle'
                          title={_('Save to Notebook')}
                          aria-label={_('Save to Notebook')}
                          disabled={isPageReferenceSaved(
                            getConfig(bookKey)?.booknotes ?? [],
                            reference,
                          )}
                          onClick={() => beginSave(reference)}
                        >
                          <MdSave />
                        </button>
                        {reference.kind === 'external' && reference.absoluteUrl ? (
                          <>
                            <button
                              type='button'
                              className='btn btn-ghost btn-sm btn-circle'
                              title={_('Copy link')}
                              aria-label={_('Copy link')}
                              onClick={() => void copy(reference.absoluteUrl!)}
                            >
                              <MdContentCopy />
                            </button>
                            <button
                              type='button'
                              className='btn btn-ghost btn-sm btn-circle'
                              title={_('Open link')}
                              aria-label={_('Open link')}
                              onClick={() => openExternalUrl(reference.absoluteUrl!)}
                            >
                              <MdOpenInNew />
                            </button>
                          </>
                        ) : (
                          <button
                            type='button'
                            className='btn btn-ghost btn-sm'
                            onClick={() => void navigate(reference)}
                          >
                            {_('Go to')}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          <button
            type='button'
            className='btn btn-primary sticky bottom-0 w-full'
            disabled={!markdown}
            onClick={() => void copy(markdown)}
          >
            <MdContentCopy />
            {_('Copy all as Markdown')}
          </button>
        </div>
      )}
    </Dialog>
  );
};

export default PageReferencesDialog;
