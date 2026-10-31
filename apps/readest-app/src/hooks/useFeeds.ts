import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { ensureFeedsLoaded } from '@/services/rss/feedLibrary';

export function useFeeds() {
  const { appService } = useEnv();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    setLoaded(false);
    setError(false);
    ensureFeedsLoaded(appService)
      .then(() => {
        if (!cancelled) setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [appService, attempt]);
  return { loaded, error, retry: () => setAttempt((value) => value + 1) };
}
