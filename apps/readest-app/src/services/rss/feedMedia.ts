import type { RssFeedItem } from '@/types/rss';

export const feedHttpUrl = (raw: string | null | undefined, base: string): string | undefined => {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.trim(), base);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

export const podcastDuration = (raw: string): number | undefined => {
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(raw)) return undefined;
  const parts = raw.split(':').map(Number);
  if (parts.slice(1).some((part) => part >= 60)) return undefined;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
};

export function feedAudio(
  raw: string | null | undefined,
  mimeType: string | null | undefined,
  length: string | number | null | undefined,
  base: string,
): RssFeedItem['audio'] {
  const url = feedHttpUrl(raw, base);
  if (!url || !mimeType?.toLowerCase().startsWith('audio/')) return undefined;
  const byteLength = Number(length);
  return { url, mimeType, byteLength: byteLength > 0 ? byteLength : undefined };
}

export const itunesText = (el: Element, name: string): string =>
  el
    .getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', name)[0]
    ?.textContent?.trim() ?? '';

export const itunesImage = (el: Element, base: string): string | undefined =>
  feedHttpUrl(
    el
      .getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', 'image')[0]
      ?.getAttribute('href'),
    base,
  );
