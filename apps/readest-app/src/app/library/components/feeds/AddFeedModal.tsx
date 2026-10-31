'use client';

import React, { useEffect, useState } from 'react';
import type { ParsedFeed, RssFeed } from '@/types/rss';
import { fetchAndParseFeed } from '@/services/rss/feedClient';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { useFeedStore } from '@/store/feedStore';
import { eventDispatcher } from '@/utils/event';

interface AddFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  podcastOnly?: boolean;
  onAdded?: (feed: RssFeed) => void;
  /** Optional override: if provided, called instead of the default feedStore.addFeed path. */
  onSubmit?: (url: string) => Promise<void>;
}

const AddFeedModal: React.FC<AddFeedModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onAdded,
  podcastOnly = false,
}) => {
  const _ = useTranslation();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<ParsedFeed | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setUrl('');
    setPreview(null);
    setSubmitting(false);
    setError(null);
  }, [isOpen]);

  const submit = async () => {
    const target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      setError(_('Enter a URL starting with http:// or https://'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (onSubmit) {
        await onSubmit(target);
      } else {
        if (!preview) {
          const parsed = await fetchAndParseFeed(target);
          if (podcastOnly && !parsed.items.some((item) => item.audio)) {
            throw new Error(_('This feed has no podcast audio. Check the RSS link.'));
          }
          setPreview(parsed);
          setSubmitting(false);
          return;
        }
        const feed = await useFeedStore.getState().addFeed(target, async () => preview);
        onAdded?.(feed);
        eventDispatcher.dispatch('toast', {
          type: 'success',
          message: _('Feed added successfully'),
          timeout: 2500,
        });
      }
      onClose();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : typeof e === 'string' ? e : _('Could not add this feed');
      setError(message);
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={podcastOnly ? _('Add podcast') : _('Add Feed')}
      boxClassName='sm:!w-[480px] sm:!max-w-[480px] sm:!h-auto sm:!max-h-[80vh]'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        <p className='text-base-content/60 text-sm leading-relaxed'>
          {podcastOnly
            ? _('Paste the RSS link of a podcast you love.')
            : _('Paste a blog or podcast RSS URL to subscribe.')}
        </p>
        <input
          type='url'
          autoFocus
          className='input input-bordered eink-bordered placeholder:text-base-content/35 w-full'
          placeholder='https://example.com/feed.xml'
          value={url}
          disabled={submitting}
          onChange={(e) => {
            setUrl(e.target.value);
            setPreview(null);
          }}
          aria-label={_('Feed URL')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        {preview && (
          <div className='eink-bordered bg-base-200 flex items-start gap-3 rounded-lg p-3'>
            {preview.iconUrl && (
              <img
                src={preview.iconUrl}
                alt=''
                className='h-16 w-16 shrink-0 rounded object-cover'
              />
            )}
            <div className='min-w-0'>
              <p className='font-semibold'>{preview.title}</p>
              {preview.author && <p className='text-base-content/70 text-sm'>{preview.author}</p>}
              <p className='text-base-content/60 text-sm'>
                {preview.kind === 'podcast' ? _('Podcast') : _('Articles')} · {preview.items.length}
              </p>
              {preview.description && (
                <p className='text-base-content/60 mt-1 line-clamp-3 text-xs'>
                  {preview.description}
                </p>
              )}
            </div>
          </div>
        )}
        {error && <p className='text-error text-sm leading-relaxed'>{error}</p>}
        <div className='flex justify-end gap-2 pt-1'>
          <button
            type='button'
            className='btn btn-ghost btn-sm eink-bordered'
            onClick={onClose}
            disabled={submitting}
          >
            {_('Cancel')}
          </button>
          <button
            type='button'
            className='btn btn-primary btn-sm'
            onClick={() => void submit()}
            disabled={submitting || !url.trim()}
          >
            {submitting && <span className='loading loading-spinner loading-xs' />}
            {onSubmit || preview ? _('Subscribe') : _('Preview')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default AddFeedModal;
