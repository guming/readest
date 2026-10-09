import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useRef } from 'react';
const mocks = vi.hoisted(() => ({
  renderer: { pinchZoom: vi.fn(), pinchEnd: vi.fn(), setAttribute: vi.fn() },
  settings: { zoomLevel: 120 },
  setViewSettings: vi.fn(),
  fixed: true,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      getView: () => ({ renderer: mocks.renderer }),
      getViewSettings: () => mocks.settings,
      setViewSettings: mocks.setViewSettings,
    }),
  },
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({ getBookData: () => ({ isFixedLayout: mocks.fixed }) }),
  },
}));
import { useWebkitPinchZoom } from '@/app/reader/hooks/useWebkitPinchZoom';
function gesture(target: EventTarget, type: string, scale: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'scale', { value: scale });
  target.dispatchEvent(event);
  return event;
}
function setup() {
  function Wrapper() {
    const ref = useRef<HTMLDivElement>(null);
    useWebkitPinchZoom('pdf-1', ref);
    return <div ref={ref} data-testid='reader' />;
  }
  const { getByTestId } = render(<Wrapper />);
  return { target: getByTestId('reader') };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.fixed = true;
});
describe('WebKit trackpad pinch', () => {
  test('outer gestures preview and commit the ratio against starting zoom', () => {
    const { target } = setup();
    expect(gesture(target, 'gesturestart', 1).defaultPrevented).toBe(true);
    gesture(target, 'gesturechange', 1.25);
    gesture(target, 'gesturechange', 1.5);
    gesture(target, 'gestureend', 1.5);
    expect(mocks.renderer.pinchZoom).toHaveBeenLastCalledWith(1.5);
    expect(mocks.renderer.pinchEnd).toHaveBeenCalledOnce();
    expect(mocks.renderer.setAttribute).toHaveBeenCalledWith('scale-factor', '180');
    expect(mocks.setViewSettings).toHaveBeenCalledWith('pdf-1', { zoomLevel: 180 });
  });
  test('iframe gestures are forwarded through the window and clamp zoom out', () => {
    setup();
    for (const [type, scale] of [
      ['gesturestart', 1],
      ['gesturechange', 0.1],
      ['gestureend', 0.1],
    ] as const) {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'iframe-gesture', bookKey: 'pdf-1', phase: type, scale },
        }),
      );
    }
    expect(mocks.renderer.setAttribute).toHaveBeenCalledWith('scale-factor', '50');
  });
  test('reflowable books are left untouched', () => {
    mocks.fixed = false;
    const { target } = setup();
    expect(gesture(target, 'gesturestart', 1).defaultPrevented).toBe(false);
    gesture(target, 'gesturechange', 2);
    gesture(target, 'gestureend', 2);
    expect(mocks.renderer.pinchZoom).not.toHaveBeenCalled();
    expect(mocks.setViewSettings).not.toHaveBeenCalled();
  });
});
