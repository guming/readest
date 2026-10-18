// Minimal clock surface shared by HTMLAudioElement and native narration.
export interface NarrationClock {
  currentTime: number;
  playbackRate: number;
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
  seek?(seconds: number): Promise<void>;
  setRate?(rate: number): Promise<void>;
  destroy?(): void;
  addEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void;
  removeEventListener(type: 'ended' | 'error' | 'timeupdate', fn: () => void): void;
}
