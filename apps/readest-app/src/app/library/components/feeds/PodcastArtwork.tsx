import { useState } from 'react';
import { MdPodcasts } from 'react-icons/md';

/** One artwork treatment across the shelf, episode header and player. */
export function PodcastArtwork({
  src,
  title,
  className = '',
}: {
  src?: string | null;
  title: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <div
      className={`eink-bordered bg-base-200 relative isolate aspect-square overflow-hidden rounded-2xl ${className}`}
    >
      {src && failedUrl !== src ? (
        <img
          src={src}
          alt=''
          loading='lazy'
          className='absolute inset-0 h-full w-full object-cover'
          onError={() => setFailedUrl(src)}
        />
      ) : (
        <div className='text-base-content flex h-full w-full flex-col justify-between p-[14%]'>
          <MdPodcasts className='h-[28%] w-[28%] opacity-50' />
          <span className='line-clamp-3 break-words text-lg font-semibold leading-tight sm:text-xl'>
            {title}
          </span>
        </div>
      )}
    </div>
  );
}
