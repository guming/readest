import { describe, expect, it, vi } from 'vitest';
import { AudiobookController } from '@/services/audiobook/AudiobookController';
import type { AudiobookClock } from '@/services/audiobook/AudiobookClock';

class Clock extends EventTarget implements AudiobookClock {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  duration = 0;
  load = vi.fn(async (_url: string, start: number) => {
    this.currentTime = start;
  });
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  destroy() {}
}
const make = (clock: Clock, onEnd = vi.fn()) =>
  new AudiobookController(
    {
      itemId: 'show',
      episodeId: 'episode',
      title: 'Episode',
      author: 'Host',
      tracks: [
        {
          index: 0,
          startOffset: 0,
          duration: 0,
          contentUrl: 'https://example.com/a.mp3',
          mimeType: 'audio/mpeg',
        },
      ],
      chapters: [],
      resolveUrl: (url) => url,
      startAt: 42,
    },
    clock,
    { onEnd },
  );

describe('podcast media with unknown duration', () => {
  it('does not overwrite a resume point when an unopened session is replaced', async () => {
    const clock = new Clock();
    const onEnd = vi.fn();
    const controller = make(clock, onEnd);
    await controller.shutdown();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('does not start playing after a pending load was shut down', async () => {
    const clock = new Clock();
    let finishLoad: () => void = () => {};
    clock.load.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve;
        }),
    );
    const controller = make(clock);
    const starting = controller.start();
    await controller.shutdown();
    finishLoad();
    await starting;
    expect(clock.paused).toBe(true);
    expect(controller.terminated).toBe(true);
  });

  it('preserves the resume position and accepts seeking before metadata arrives', async () => {
    const clock = new Clock();
    const controller = make(clock);
    await controller.start();
    expect(clock.load).toHaveBeenCalledWith('https://example.com/a.mp3', 42);
    await controller.seekToTime(75);
    expect(clock.currentTime).toBe(75);
    clock.duration = 180;
    expect(controller.getPlaybackInfo()?.duration).toBe(180);
    await controller.seekToTime(500);
    expect(clock.currentTime).toBe(180);
    await controller.shutdown();
  });

  it('does not report an initial media failure as a completed episode', async () => {
    const clock = new Clock();
    clock.load.mockRejectedValue(new Error('Unavailable'));
    const onEnd = vi.fn();
    const controller = make(clock, onEnd);
    await controller.start();
    expect(onEnd).toHaveBeenCalledWith(0, 'error');
    await controller.shutdown();
  });

  it('distinguishes natural completion from stopping early', async () => {
    const clock = new Clock();
    const onEnd = vi.fn();
    const controller = make(clock, onEnd);
    await controller.start();
    clock.currentTime = 90;
    clock.dispatchEvent(new Event('ended'));
    expect(onEnd).toHaveBeenCalledWith(90, 'ended');
    await controller.shutdown();
  });
});
