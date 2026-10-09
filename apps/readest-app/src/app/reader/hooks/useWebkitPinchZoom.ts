import { RefObject, useCallback, useEffect, useRef } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL } from '@/services/constants';

// macOS WebKit reports trackpad pinches as GestureEvents rather than touch
// events or Ctrl+wheel. Both the iframe and outer scroller use this handler.
export const useWebkitPinchZoom = (
  bookKey: string,
  containerRef: RefObject<HTMLDivElement | null>,
) => {
  const initialZoom = useRef<number | null>(null);
  const lastZoom = useRef(100);
  const handleGesture = useCallback(
    (event: Event) => {
      const { getView, getViewSettings, setViewSettings } = useReaderStore.getState();
      if (!useBookDataStore.getState().getBookData(bookKey)?.isFixedLayout) return;
      const renderer = getView(bookKey)?.renderer;
      const settings = getViewSettings(bookKey);
      if (!renderer || !settings) return;
      if (event.type === 'gesturestart') {
        initialZoom.current = settings.zoomLevel ?? 100;
        lastZoom.current = initialZoom.current;
        event.preventDefault();
        return;
      }
      if (initialZoom.current === null) return;
      event.preventDefault();
      const scale = (event as Event & { scale?: number }).scale;
      if (scale != null && Number.isFinite(scale) && scale > 0) {
        lastZoom.current = Math.max(
          MIN_ZOOM_LEVEL,
          Math.min(MAX_ZOOM_LEVEL, Math.round(initialZoom.current * scale)),
        );
      }
      if (event.type === 'gesturechange') {
        renderer.pinchZoom?.(lastZoom.current / initialZoom.current);
      } else if (event.type === 'gestureend') {
        renderer.pinchEnd?.();
        renderer.setAttribute('scale-factor', String(lastZoom.current));
        setViewSettings(bookKey, { ...settings, zoomLevel: lastZoom.current });
        initialZoom.current = null;
      }
    },
    [bookKey],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const types = ['gesturestart', 'gesturechange', 'gestureend'];
    for (const type of types) container.addEventListener(type, handleGesture, { passive: false });
    return () => {
      for (const type of types) container.removeEventListener(type, handleGesture);
    };
  }, [containerRef, handleGesture]);

  useEffect(() => {
    const handleIframeGesture = (message: MessageEvent) => {
      if (message.data?.type !== 'iframe-gesture' || message.data.bookKey !== bookKey) return;
      const event = new Event(message.data.phase, { cancelable: true });
      Object.defineProperty(event, 'scale', { value: message.data.scale });
      handleGesture(event);
    };
    window.addEventListener('message', handleIframeGesture);
    return () => window.removeEventListener('message', handleIframeGesture);
  }, [bookKey, handleGesture]);
};
