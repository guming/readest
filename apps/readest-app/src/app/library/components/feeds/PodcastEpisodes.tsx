import { useState } from 'react';
import { MdPlayArrow } from 'react-icons/md';
import { PodcastArtwork } from './PodcastArtwork';
import Dialog from '@/components/Dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { usePodcastStore } from '@/store/podcastStore';
import type { RssFeed, RssFeedItem } from '@/types/rss';
import { formatPlaybackTime } from '@/utils/time';
import { formatDate } from '@/utils/book';
import { sanitizeHtml } from '@/utils/sanitize';
import { feedHttpUrl } from '@/services/rss/feedMedia';

export function PodcastEpisodes({
  feed,
  onPlay,
  pendingId,
}: {
  feed: RssFeed;
  onPlay: (item: RssFeedItem) => void;
  pendingId: string | null;
}) {
  const _ = useTranslation();
  const progress = usePodcastStore((state) => state.progress[feed.id]);
  const [details, setDetails] = useState<RssFeedItem | null>(null);
  const items = [...feed.items].sort(
    (a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0),
  );
  const continuing = items
    .filter(
      (item) =>
        item.audio &&
        progress?.[item.id] &&
        !progress[item.id]!.finished &&
        progress[item.id]!.positionSec > 0,
    )
    .sort((a, b) => (progress?.[b.id]?.updatedAt ?? 0) - (progress?.[a.id]?.updatedAt ?? 0))[0];
  const originalUrl = details ? feedHttpUrl(details.link, feed.url) : undefined;
  return (
    <div>
      <div className='mb-8 flex items-start gap-5 sm:items-center sm:gap-8'>
        <PodcastArtwork src={feed.iconUrl} title={feed.title} className='w-28 shrink-0 sm:w-48' />
        <div className='min-w-0 flex-1'>
          <p className='text-base-content/45 mb-2 text-xs font-medium uppercase tracking-widest'>
            {_('Podcast')}
          </p>
          <h2 className='text-2xl font-semibold leading-tight tracking-tight sm:text-3xl'>
            {feed.title}
          </h2>
          {feed.author && <p className='text-base-content/65 mt-2 text-sm'>{feed.author}</p>}
          {feed.description && (
            <p className='text-base-content/55 mt-3 line-clamp-3 max-w-xl text-sm leading-relaxed'>
              {feed.description}
            </p>
          )}
          {continuing && (
            <button
              type='button'
              className='btn btn-contrast eink-bordered mt-5 h-10 min-h-10 max-w-full flex-nowrap gap-2 rounded-full px-5'
              aria-label={`${_('Continue listening')}: ${continuing.title}`}
              disabled={!!pendingId}
              onClick={() => onPlay(continuing)}
            >
              <MdPlayArrow size={20} className='shrink-0' />
              <span className='min-w-0 truncate'>{_('Continue listening')}</span>
            </button>
          )}
        </div>
      </div>
      <div className='mb-2 flex items-baseline justify-between gap-4 border-b border-base-300 pb-4'>
        <h3 className='text-lg font-semibold'>{_('Episodes')}</h3>
        <span className='text-base-content/45 text-xs'>{_('Newest first')}</span>
      </div>
      {items.length === 0 && (
        <p className='text-base-content/60 py-8 text-center'>{_('No episodes found')}</p>
      )}
      <ul className='divide-base-300 divide-y'>
        {items.map((item) => {
          const saved = progress?.[item.id];
          const duration = saved?.durationSec || item.duration;
          return (
            <li key={item.id} className='flex items-center gap-5 py-5 sm:gap-8'>
              <button
                type='button'
                className='min-w-0 flex-1 text-start'
                onClick={() => setDetails(item)}
              >
                <span className='line-clamp-2 text-base font-semibold leading-snug'>
                  {item.title}
                </span>
                <span className='text-base-content/45 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs'>
                  {item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
                  {duration ? <span>{formatPlaybackTime(duration)}</span> : null}
                  {saved?.finished ? (
                    <span>{_('Played')}</span>
                  ) : saved && saved.positionSec > 0 ? (
                    <span>
                      {_('Progress')}: {formatPlaybackTime(saved.positionSec)}
                    </span>
                  ) : (
                    <span>{_('Unplayed')}</span>
                  )}
                </span>
                {item.summary && (
                  <span className='text-base-content/55 mt-2 line-clamp-2 text-sm leading-relaxed'>
                    {item.summary}
                  </span>
                )}
              </button>
              <button
                type='button'
                className='btn btn-contrast btn-circle eink-bordered h-10 min-h-10 w-10 shrink-0'
                disabled={!item.audio || !!pendingId}
                aria-label={`${saved?.finished ? _('Replay') : _('Play')}: ${item.title}`}
                onClick={() => onPlay(item)}
              >
                {pendingId === item.id ? (
                  <span className='loading loading-spinner loading-sm' />
                ) : (
                  <MdPlayArrow size={24} />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Dialog isOpen={!!details} title={details?.title ?? ''} onClose={() => setDetails(null)}>
        {details && (
          <div className='flex flex-col gap-4 pb-6'>
            <div
              className='prose prose-sm max-w-none break-words'
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(details.contentHtml ?? details.summary ?? ''),
              }}
            />
            {details.audio && (
              <button
                type='button'
                className='btn btn-primary'
                disabled={!!pendingId}
                onClick={() => onPlay(details)}
              >
                {_('Play')}
              </button>
            )}
            {originalUrl && (
              <a
                href={originalUrl}
                target='_blank'
                rel='noopener noreferrer'
                className='link text-sm'
              >
                {_('Open original page')}
              </a>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
