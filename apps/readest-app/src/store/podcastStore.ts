import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface PodcastProgress {
  positionSec: number;
  durationSec: number;
  finished: boolean;
  updatedAt: number;
}

interface PodcastState {
  progress: Record<string, Record<string, PodcastProgress>>;
  updateProgress: (
    feedId: string,
    episodeId: string,
    position: number,
    duration: number,
    finished?: boolean,
  ) => void;
  removeFeed: (feedId: string) => void;
}

// Separate from subscriptions: refreshes never overwrite listening history.
export const usePodcastStore = create<PodcastState>()(
  persist(
    (set) => ({
      progress: {},
      updateProgress: (feedId, episodeId, position, duration, finished = false) =>
        set((state) => ({
          progress: {
            ...state.progress,
            [feedId]: {
              ...state.progress[feedId],
              [episodeId]: {
                positionSec: Math.max(0, position),
                durationSec: Number.isFinite(duration) ? Math.max(0, duration) : 0,
                finished,
                updatedAt: Date.now(),
              },
            },
          },
        })),
      removeFeed: (feedId) =>
        set((state) => {
          const progress = { ...state.progress };
          delete progress[feedId];
          return { progress };
        }),
    }),
    {
      name: 'readest-podcast-progress',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ progress: state.progress }),
    },
  ),
);
