import { md5 } from '@/utils/md5';
import type { Book } from '@/types/book';
import type { ParsedFeed } from '@/types/rss';
import type { FileSystem } from '@/types/system';
import type { BookDoc } from '@/libs/document';
import { guardedFetchText } from '@/services/rss/feedGuardedFetch';
import { assertFetchAllowed } from '@/services/rss/feedGuardedFetch';
import { assignSlots, loadManifest, saveManifest } from '@/services/rss/feedManifest';
import {
  extractArticle,
  loadArticleCache,
  saveArticleCache,
} from '@/services/rss/feedArticleContent';
import { makeFeedBook } from '@/services/rss/makeFeedBook';
import { SITE_SCHEME, buildSiteBookUrl, parseSiteBookUrl } from './siteBookUrl';

export const MAX_CHAPTERS = 200;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES_PER_CHAPTER = 12;
const CACHEABLE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

async function inlineChapterImages(html: string, pageUrl: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const images = Array.from(doc.querySelectorAll('img[src]')).slice(0, MAX_IMAGES_PER_CHAPTER);
  for (const image of images) {
    try {
      const url = new URL(image.getAttribute('src')!, pageUrl);
      assertFetchAllowed(url.href);
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await tauriFetch(url.href, { signal: controller.signal });
        const mime =
          response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
        if (!response.ok || !CACHEABLE_IMAGE_TYPES.has(mime)) continue;
        const declaredSize = Number(response.headers.get('content-length'));
        if (declaredSize > MAX_IMAGE_BYTES) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > MAX_IMAGE_BYTES) continue;
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        image.setAttribute('src', `data:${mime};base64,${btoa(binary)}`);
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      /* retain the remote URL if an image cannot be cached */
    }
  }
  return doc.body.innerHTML;
}

export const siteBookHash = (url: string): string =>
  md5(SITE_SCHEME + new URL(url).origin + new URL(url).pathname);

export interface SiteToc {
  url: string;
  title: string;
  chapters: { title: string; url: string; group?: string }[];
  version?: string;
  currentPage?: { title: string; url: string };
  totalChapters?: number;
}

interface HuggingFaceSection {
  title?: string;
  url?: string;
  sections?: HuggingFaceSection[];
}

function parseHuggingFaceToc(doc: Document, url: URL): SiteToc | null {
  if (url.hostname !== 'huggingface.co' || !url.pathname.startsWith('/docs/')) return null;
  const project = url.pathname.split('/')[2];
  for (const element of doc.querySelectorAll('[data-props]')) {
    try {
      const props = JSON.parse(element.getAttribute('data-props') || '') as {
        library?: string;
        title?: string;
        version?: string;
        chapters?: HuggingFaceSection[];
      };
      if (props.library !== project || !Array.isArray(props.chapters)) continue;
      const chapters: SiteToc['chapters'] = [];
      const seen = new Set<string>();
      // Links supplied by the navigation carry the site's selected version and language.
      const segments = url.pathname.split('/').filter(Boolean);
      const prefix =
        segments.length >= 5 ? `/${segments.slice(0, 4).join('/')}/` : `/docs/${project}/`;
      const visit = (nodes: HuggingFaceSection[], groups: string[]) => {
        for (const node of nodes) {
          if (node.url && node.title) {
            const target = new URL(node.url, url);
            target.hash = '';
            target.search = '';
            if (
              target.origin === url.origin &&
              target.pathname.startsWith(prefix) &&
              !seen.has(target.href)
            ) {
              seen.add(target.href);
              chapters.push({
                title: node.title,
                url: target.href,
                ...(groups.length ? { group: groups.join(' / ') } : {}),
              });
            }
          }
          if (Array.isArray(node.sections))
            visit(node.sections, node.title ? [...groups, node.title] : groups);
        }
      };
      visit(props.chapters, []);
      if (!chapters.length) return null;
      const currentUrl = new URL(url.href);
      currentUrl.hash = '';
      currentUrl.search = '';
      const currentPage = chapters.find((chapter) => chapter.url === currentUrl.href) ?? {
        title:
          doc.querySelector('.prose-doc h1')?.textContent?.trim() ||
          doc.title ||
          project ||
          url.hostname,
        url: currentUrl.href,
      };
      return {
        url: currentUrl.href,
        title: props.title || project || url.hostname,
        version: props.version,
        currentPage,
        totalChapters: chapters.length,
        chapters: chapters.slice(0, MAX_CHAPTERS),
      };
    } catch {
      /* ignore unrelated or malformed component data */
    }
  }
  return null;
}

export function parseSiteToc(html: string, tocUrl: string): SiteToc {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = new URL(tocUrl);
  const title = doc.querySelector('h1')?.textContent?.trim() || doc.title || base.hostname;
  const explicit = doc.querySelector('nav[role="doc-toc"], nav.toc, #toc, .toc');
  if (!explicit && !/toc|contents|chapters/i.test(base.pathname)) {
    throw new Error('No chapter list found on this page.');
  }
  const container = explicit ?? doc.querySelector('main, body');
  const seen = new Set<string>();
  const chapters: SiteToc['chapters'] = [];
  for (const link of container?.querySelectorAll('a[href]') ?? []) {
    const label = link.textContent?.trim();
    if (!label) continue;
    let resolved: URL;
    try {
      resolved = new URL(link.getAttribute('href')!, tocUrl);
    } catch {
      continue;
    }
    resolved.hash = '';
    if (resolved.origin !== base.origin || !/^https?:$/.test(resolved.protocol)) continue;
    if (resolved.href === tocUrl || seen.has(resolved.href)) continue;
    seen.add(resolved.href);
    chapters.push({ title: label.replace(/^\d+[.、]\s*/, ''), url: resolved.href });
    if (chapters.length >= MAX_CHAPTERS) break;
  }
  if (chapters.length < 2) throw new Error('No chapter list found on this page.');
  return { url: tocUrl, title, chapters };
}

export async function discoverSiteToc(url: string): Promise<SiteToc> {
  const base = new URL(url);
  const html = await guardedFetchText(base.href);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const huggingFace = parseHuggingFaceToc(doc, base);
  if (huggingFace) return huggingFace;
  const candidates = [
    ...Array.from(doc.querySelectorAll('iframe[src], a[href]'))
      .filter(
        (el) =>
          /toc|contents|chapters/i.test(el.getAttribute('src') || el.getAttribute('href') || '') ||
          /contents|chapters/i.test(el.textContent || ''),
      )
      .map((el) => el.getAttribute('src') || el.getAttribute('href') || ''),
    '/toc.html',
  ];
  for (const path of candidates) {
    try {
      const tocUrl = new URL(path, base);
      if (tocUrl.origin !== base.origin) continue;
      const toc = parseSiteToc(await guardedFetchText(tocUrl.href), tocUrl.href);
      if (toc.chapters.length >= 2) {
        return {
          ...toc,
          title: doc.querySelector('h1')?.textContent?.trim() || doc.title || toc.title,
        };
      }
    } catch {
      /* try next candidate */
    }
  }
  return parseSiteToc(html, base.href);
}

export function createSiteBook(toc: SiteToc): Book {
  const now = Date.now();
  return {
    hash: siteBookHash(toc.url),
    url: buildSiteBookUrl(toc.url),
    format: 'EPUB',
    title: toc.title,
    author: '',
    metadata: { title: toc.title, author: '', language: '', siteUrl: toc.url },
    createdAt: now,
    updatedAt: now,
    downloadedAt: now,
  };
}

export async function refreshSiteBook(
  fs: FileSystem,
  book: Book,
  toc: SiteToc,
  onProgress?: (done: number, total: number) => void,
): Promise<{ failed: { title: string; url: string }[] }> {
  const previous = await loadManifest(fs, book.hash, toc.url, toc.title);
  const parsed: ParsedFeed = {
    title: toc.title,
    items: toc.chapters.map((chapter) => ({
      id: chapter.url,
      title: chapter.title,
      link: chapter.url,
      read: false,
    })),
  };
  const next = assignSlots(previous, parsed);
  const selected = new Set(toc.chapters.map((chapter) => chapter.url));
  const entries = next.entries.filter((entry) => selected.has(entry.id));
  let done = 0;
  let cached = 0;
  const failed: { title: string; url: string }[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++]!;
      try {
        if ((await loadArticleCache(fs, book.hash, entry.id)) === null) {
          const html = await guardedFetchText(entry.link);
          const article = extractArticle(html, entry.link);
          await saveArticleCache(
            fs,
            book.hash,
            entry.id,
            await inlineChapterImages(article, entry.link),
          );
        }
        cached++;
      } catch {
        failed.push({ title: entry.title, url: entry.link });
      }
      onProgress?.(++done, entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, worker));
  if (cached === 0) throw new Error('No chapters could be downloaded.');
  await saveManifest(fs, book.hash, { ...next, lastFetchedAt: Date.now() });
  return { failed };
}

export async function openSiteBookDoc(fs: FileSystem, book: Book): Promise<BookDoc> {
  const tocUrl = parseSiteBookUrl(book.url!);
  const previous = await loadManifest(fs, book.hash, tocUrl, book.title);
  return makeFeedBook(
    previous,
    async (entry) =>
      (await loadArticleCache(fs, book.hash, entry.id)) ??
      '<p>Chapter content unavailable offline.</p>',
  );
}
