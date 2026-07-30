import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PiCheck, PiCopy, PiFloppyDisk, PiSpinner, PiX } from 'react-icons/pi';
import ModalPortal from '@/components/ModalPortal';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { writeTextToClipboard } from '@/utils/clipboard';
import { uniqueId } from '@/utils/misc';
import { resolveAIConnection } from '@/services/ai/connections';
import {
  getImageReadingContext,
  createImageExplanationCard,
  ImageAssistantError,
  prepareImageForExplanation,
  streamImageExplanation,
  supportsImageUnderstanding,
  type PreparedImage,
} from '@/services/image-assistant';

interface Props {
  bookKey: string;
  imageElement: Element;
  chapterTitle: string;
  chapterId?: string;
  pageCfi?: string;
  onClose: () => void;
}

type RequestState = 'loading-image' | 'streaming' | 'complete' | 'error';

const ImageAssistantDialog: React.FC<Props> = ({
  bookKey,
  imageElement,
  chapterTitle,
  chapterId,
  pageCfi,
  onClose,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const setSettingsDialogOpen = useSettingsStore((state) => state.setSettingsDialogOpen);
  const setActiveSettingsItemId = useSettingsStore((state) => state.setActiveSettingsItemId);
  const [state, setState] = useState<RequestState>('loading-image');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preparedImage, setPreparedImage] = useState<PreparedImage | null>(null);
  const getConfig = useBookDataStore((state) => state.getConfig);
  const setConfig = useBookDataStore((state) => state.setConfig);
  const saveConfig = useBookDataStore((state) => state.saveConfig);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const connection = resolveAIConnection(settings.aiSettings);
  const visionSupported = settings.aiSettings.enabled && supportsImageUnderstanding(connection);

  const cancel = useCallback(() => {
    requestIdRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const run = useCallback(async () => {
    cancel();
    setResult('');
    setError('');
    setCopied(false);
    setSaved(false);
    setSaving(false);
    if (!visionSupported) {
      setState('error');
      setError(_('The current AI model does not support image understanding.'));
      return;
    }

    const requestId = requestIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    setState(preparedImage ? 'streaming' : 'loading-image');
    try {
      const image = preparedImage || (await prepareImageForExplanation(imageElement));
      if (requestId !== requestIdRef.current) return;
      if (!preparedImage) setPreparedImage(image);
      setState('streaming');
      const readingContext = getImageReadingContext(imageElement);
      for await (const chunk of streamImageExplanation({
        image,
        context: {
          ...readingContext,
          chapterTitle,
          targetLanguage: navigator.language || 'English',
        },
        settings: settings.aiSettings,
        signal: controller.signal,
      })) {
        if (requestId !== requestIdRef.current) return;
        setResult((current) => current + chunk);
      }
      if (requestId === requestIdRef.current) setState('complete');
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setState('error');
      setError(
        controller.signal.aborted
          ? _('The image explanation request was cancelled or timed out.')
          : requestError instanceof ImageAssistantError
            ? _(requestError.message)
            : _('Unable to explain this image.'),
      );
    } finally {
      window.clearTimeout(timeout);
      if (requestId === requestIdRef.current) controllerRef.current = null;
    }
  }, [cancel, chapterTitle, imageElement, preparedImage, settings.aiSettings, visionSupported, _]);

  useEffect(() => {
    void run();
    return cancel;
    // Start once for this selected image. Retry is explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageElement]);

  useEffect(
    () => () => {
      if (preparedImage?.previewUrl) URL.revokeObjectURL(preparedImage.previewUrl);
    },
    [preparedImage],
  );

  const openAISettings = () => {
    cancel();
    onClose();
    setActiveSettingsItemId('settings.ai.connections');
    setSettingsDialogOpen(true);
  };

  const cancelVisibleRequest = () => {
    cancel();
    if (result) {
      setState('complete');
    } else {
      setState('error');
      setError(_('The image explanation request was cancelled.'));
    }
  };

  const saveToNotes = async () => {
    if (!result || saved || saving || !connection) return;
    const config = getConfig(bookKey);
    if (!config) return;
    setSaving(true);
    try {
      const now = Date.now();
      const readingContext = getImageReadingContext(imageElement);
      const card = createImageExplanationCard({
        id: uniqueId(),
        now,
        bookId: bookKey.split('-')[0]!,
        title: _('Image Explanation'),
        chapterId,
        chapterTitle,
        pageCfi,
        caption: readingContext.caption,
        content: result,
        targetLanguage: navigator.language || 'English',
        provider: connection.provider,
        model: connection.model,
      });
      const next = {
        ...config,
        notebookCards: [...(config.notebookCards ?? []), card],
        updatedAt: now,
      };
      setConfig(bookKey, next);
      await saveConfig(envConfig, bookKey, next, settings);
      setSaved(true);
    } catch {
      setError(_('Failed to save the image explanation to Notes.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <section
        role='dialog'
        aria-modal='true'
        aria-label={_('Explain Image')}
        className='bg-base-100 text-base-content eink-bordered flex max-h-[80vh] w-[min(720px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl shadow-2xl'
      >
        <header className='border-base-300 flex items-center justify-between border-b px-4 py-3'>
          <div>
            <h2 className='font-semibold'>{_('Explain Image')}</h2>
            {chapterTitle && <p className='text-base-content/60 text-xs'>{chapterTitle}</p>}
          </div>
          <button
            type='button'
            className='btn btn-ghost btn-sm btn-square eink-bordered'
            onClick={() => {
              cancel();
              onClose();
            }}
            aria-label={_('Close')}
          >
            <PiX />
          </button>
        </header>

        <div className='min-h-0 flex-1 overflow-y-auto p-4'>
          {preparedImage?.previewUrl && (
            <img
              src={preparedImage.previewUrl}
              alt=''
              className='bg-base-200 mx-auto mb-4 max-h-56 max-w-full rounded object-contain'
            />
          )}
          {(state === 'loading-image' || state === 'streaming') && !result && (
            <div className='text-base-content/70 flex items-center gap-2 text-sm'>
              <PiSpinner className='animate-spin' />
              {state === 'loading-image' ? _('Preparing image…') : _('Explaining image…')}
            </div>
          )}
          {result && <div className='whitespace-pre-wrap text-sm leading-relaxed'>{result}</div>}
          {error && <p className='text-error text-sm'>{error}</p>}
        </div>

        <footer className='border-base-300 flex flex-wrap justify-end gap-2 border-t px-4 py-3'>
          {!visionSupported && (
            <button type='button' className='btn btn-primary btn-sm' onClick={openAISettings}>
              {_('Open AI Settings')}
            </button>
          )}
          {(state === 'loading-image' || state === 'streaming') && (
            <button
              type='button'
              className='btn btn-ghost btn-sm eink-bordered'
              onClick={cancelVisibleRequest}
            >
              {_('Cancel')}
            </button>
          )}
          {state === 'error' && visionSupported && (
            <button type='button' className='btn btn-primary btn-sm' onClick={() => void run()}>
              {_('Retry')}
            </button>
          )}
          {result && (
            <button
              type='button'
              className='btn btn-primary btn-sm'
              onClick={() => void saveToNotes()}
              disabled={saved || saving}
            >
              {saved ? (
                <PiCheck />
              ) : saving ? (
                <PiSpinner className='animate-spin' />
              ) : (
                <PiFloppyDisk />
              )}
              {saved ? _('Saved to Notes') : saving ? _('Saving…') : _('Save to Notes')}
            </button>
          )}
          {result && (
            <button
              type='button'
              className='btn btn-ghost btn-sm eink-bordered'
              onClick={async () => {
                const succeeded = await writeTextToClipboard(result);
                setCopied(succeeded);
              }}
            >
              <PiCopy />
              {copied ? _('Copied') : _('Copy')}
            </button>
          )}
        </footer>
      </section>
    </ModalPortal>
  );
};

export default ImageAssistantDialog;
