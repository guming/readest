// src/services/rss/feedParser.ts
import { feedAudio, feedHttpUrl, itunesImage, itunesText, podcastDuration } from './feedMedia';
import type { ParsedFeed, RssFeedItem } from '@/types/rss';

const text = (el: Element | null | undefined): string => el?.textContent?.trim() ?? '';

// Reduce an HTML string to a plain-text preview. Feed summaries (RSS
// <description>, Atom <summary>) are frequently HTML; rendered verbatim in a
// list row they show raw tags, so strip to text for the preview.
const stripHtml = (html: string): string => {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const toIso = (raw: string): string | undefined => {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

/** Atom links can repeat with different `rel`; prefer rel="alternate", else
 *  the first link that has an href. */
const atomAlternateHref = (entry: Element): string => {
  const links = Array.from(entry.getElementsByTagName('link'));
  const alt = links.find((l) => (l.getAttribute('rel') ?? 'alternate') === 'alternate');
  return (alt ?? links[0])?.getAttribute('href')?.trim() ?? '';
};

const parseRss = (doc: Document, base: string): ParsedFeed => {
  const channel = doc.querySelector('channel');
  if (!channel) throw new Error('Unrecognized feed format');
  const items: RssFeedItem[] = Array.from(channel.querySelectorAll('item')).map((item) => {
    const link = text(item.querySelector('link'));
    const guid = text(item.querySelector('guid'));
    // content:encoded — querySelector cannot match the namespaced tag reliably
    // across parsers, so fall back to getElementsByTagName on the local name.
    const encoded =
      item.getElementsByTagName('content:encoded')[0]?.textContent?.trim() || undefined;
    const descriptionHtml = text(item.querySelector('description')) || undefined;
    const enclosure = item.querySelector('enclosure[type^="image"]');
    const media = Array.from(item.querySelectorAll('enclosure')).find((el) =>
      el.getAttribute('type')?.toLowerCase().startsWith('audio/'),
    );
    const audio = feedAudio(
      media?.getAttribute('url'),
      media?.getAttribute('type'),
      media?.getAttribute('length'),
      base,
    );
    return {
      id: guid || audio?.url || link,
      title: text(item.querySelector('title')),
      link,
      author: itunesText(item, 'author') || text(item.querySelector('author')) || undefined,
      publishedAt: toIso(text(item.querySelector('pubDate'))),
      // Preview is always plain text; <description> is frequently HTML.
      summary: descriptionHtml ? stripHtml(descriptionHtml) || undefined : undefined,
      // Prefer content:encoded; otherwise many feeds (and self-hosted blogs)
      // ship the full article body in <description>. Using it lets the reader
      // open from the feed with no page re-fetch — which also avoids Android's
      // cleartext-HTTP block on http:// article links. resolveArticleInput's
      // length gate still routes genuinely short summaries to a page fetch.
      contentHtml: encoded ?? descriptionHtml,
      imageUrl: itunesImage(item, base) ?? feedHttpUrl(enclosure?.getAttribute('url'), base),
      audio,
      duration: podcastDuration(itunesText(item, 'duration')),
      read: false,
    };
  });
  return {
    kind: items.some((item) => item.audio) ? 'podcast' : 'article',
    author: itunesText(channel, 'author') || undefined,
    iconUrl:
      itunesImage(channel, base) ?? feedHttpUrl(text(channel.querySelector('image > url')), base),
    title: text(channel.querySelector('title')) || 'Untitled feed',
    siteUrl: text(channel.querySelector('link')) || undefined,
    description: text(channel.querySelector('description')) || undefined,
    items,
  };
};

const parseAtom = (doc: Document, base: string): ParsedFeed => {
  const feed = doc.querySelector('feed');
  if (!feed) throw new Error('Unrecognized feed format');
  const items: RssFeedItem[] = Array.from(feed.querySelectorAll('entry')).map((entry) => {
    const link = atomAlternateHref(entry);
    const media = entry.querySelector('link[rel="enclosure"][type^="audio/"]');
    const audio = feedAudio(
      media?.getAttribute('href'),
      media?.getAttribute('type'),
      media?.getAttribute('length'),
      base,
    );
    return {
      id: text(entry.querySelector('id')) || audio?.url || link,
      audio,
      title: text(entry.querySelector('title')),
      link,
      author: text(entry.querySelector('author > name')) || undefined,
      publishedAt: toIso(
        text(entry.querySelector('updated')) || text(entry.querySelector('published')),
      ),
      summary: stripHtml(text(entry.querySelector('summary'))) || undefined,
      contentHtml: text(entry.querySelector('content')) || undefined,
      read: false,
    };
  });
  return {
    kind: items.some((item) => item.audio) ? 'podcast' : 'article',
    title: text(feed.querySelector('title')) || 'Untitled feed',
    siteUrl: atomAlternateHref(feed) || undefined,
    items,
  };
};

interface JsonFeedItem {
  id?: string;
  url?: string;
  title?: string;
  author?: { name?: string };
  authors?: Array<{ name?: string }>;
  date_published?: string;
  summary?: string;
  content_html?: string;
  content_text?: string;
  image?: string;
  attachments?: Array<{
    url?: string;
    mime_type?: string;
    size_in_bytes?: number;
    duration_in_seconds?: number;
  }>;
}
interface JsonFeedDoc {
  title?: string;
  home_page_url?: string;
  description?: string;
  favicon?: string;
  items?: JsonFeedItem[];
}

const parseJsonFeed = (raw: string, base: string): ParsedFeed => {
  const doc = JSON.parse(raw) as JsonFeedDoc;
  if (!Array.isArray(doc.items)) throw new Error('Unrecognized feed format');
  const items: RssFeedItem[] = doc.items.map((it) => {
    const link = it.url ?? '';
    const media = it.attachments?.find((a) => a.mime_type?.startsWith('audio/'));
    const audio = feedAudio(media?.url, media?.mime_type, media?.size_in_bytes, base);
    return {
      id: it.id || audio?.url || link,
      audio,
      duration: podcastDuration(String(media?.duration_in_seconds ?? '')),
      title: it.title ?? '',
      link,
      author: it.author?.name ?? it.authors?.[0]?.name,
      publishedAt: toIso(it.date_published ?? ''),
      summary: it.summary ?? it.content_text ?? undefined,
      contentHtml: it.content_html ?? undefined,
      imageUrl: it.image,
      read: false,
    };
  });
  return {
    kind: items.some((item) => item.audio) ? 'podcast' : 'article',
    title: doc.title ?? 'Untitled feed',
    siteUrl: doc.home_page_url,
    description: doc.description,
    iconUrl: doc.favicon,
    items,
  };
};

export function parseFeed(raw: string, feedUrl: string): ParsedFeed {
  const trimmed = raw.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('{')) return parseJsonFeed(trimmed, feedUrl);
  const doc = new DOMParser().parseFromString(trimmed, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Unrecognized feed format');
  if (doc.querySelector('feed')) return parseAtom(doc, feedUrl);
  if (doc.querySelector('rss, rdf\\:RDF, channel')) return parseRss(doc, feedUrl);
  throw new Error('Unrecognized feed format');
}
