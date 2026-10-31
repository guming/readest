'use client';

import { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import LibraryViewTabs from '@/components/LibraryViewTabs';
import { Toast } from '@/components/Toast';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useLibrary } from '@/hooks/useLibrary';
import { useTranslation } from '@/hooks/useTranslation';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useThemeStore } from '@/store/themeStore';
import PodcastLibrary from './components/PodcastLibrary';
import NowPlayingBar from '@/app/library/components/NowPlayingBar';
import { navigateToLibrary } from '@/utils/nav';

function PodcastsContent() {
  const router = useAppRouter();
  const params = useSearchParams();
  const _ = useTranslation();
  useLibrary();
  const insets = useThemeStore((state) => state.safeAreaInsets);
  const setThemeScope = useThemeStore((state) => state.setThemeScope);
  const header = useRef<HTMLElement>(null);
  const { isTrafficLightVisible } = useTrafficLight(header);
  useEffect(() => setThemeScope('library'), [setThemeScope]);
  return (
    <main className='full-height bg-base-200 text-base-content flex flex-col overflow-hidden'>
      <header
        ref={header}
        className={`titlebar bg-base-100 flex shrink-0 items-center border-b border-base-300 py-3 pr-4 ${isTrafficLightVisible ? 'pl-24' : 'pl-4'}`}
        style={{ paddingTop: Math.max(12, insets?.top ?? 0) }}
      >
        <h1 className='text-lg font-semibold'>{_('Podcasts')}</h1>
      </header>
      <LibraryViewTabs
        active='podcasts'
        onBooks={() => navigateToLibrary(router, undefined, undefined, true)}
        onHighlights={() => router.push('/highlights')}
      />
      <div
        className='scroll-container min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-10 sm:py-10'
        style={{
          paddingBottom: `calc(24px + var(--now-playing-inset, 0px) + ${insets?.bottom ?? 0}px)`,
        }}
      >
        <div className='mx-auto max-w-5xl'>
          <PodcastLibrary feedId={params?.get('feed') ?? null} />
        </div>
      </div>
      <NowPlayingBar isSelectMode={false} />
      <Toast />
    </main>
  );
}

export default function PodcastsPage() {
  return (
    <Suspense fallback={<div className='full-height' />}>
      <PodcastsContent />
    </Suspense>
  );
}
