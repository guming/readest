import { describe, expect, it, vi } from 'vitest';
vi.mock('@/services/rss/feedGuardedFetch', () => ({ guardedFetchText: vi.fn() }));
vi.mock('@/services/rss/feedManifest', () => ({
  assignSlots: vi.fn(),
  loadManifest: vi.fn(),
  saveManifest: vi.fn(),
}));
vi.mock('@/services/rss/feedArticleContent', () => ({
  extractArticle: vi.fn(),
  loadArticleCache: vi.fn(),
  saveArticleCache: vi.fn(),
}));
vi.mock('@/services/rss/makeFeedBook', () => ({ makeFeedBook: vi.fn() }));
import { createSiteBook, discoverSiteToc, parseSiteToc } from '@/services/site/siteBook';
import { buildSiteBookUrl, parseSiteBookUrl } from '@/services/site/siteBookUrl';
import { guardedFetchText } from '@/services/rss/feedGuardedFetch';

describe('website book', () => {
  it('discovers ordered same-origin chapters from a table of contents', () => {
    const toc = parseSiteToc(
      '<html><body><ol><li><a href="/01.html">1. Introduction</a></li><li><a href="/02.html#top">2. Data Sources</a></li><li><a href="https://other.example/x">Other</a></li></ol></body></html>',
      'https://example.com/toc.html',
    );
    expect(toc.chapters).toEqual([
      { title: 'Introduction', url: 'https://example.com/01.html' },
      { title: 'Data Sources', url: 'https://example.com/02.html' },
    ]);
  });

  it('keeps a stable book identity and restores the source URL', () => {
    const url = 'https://example.com/toc.html';
    const toc = { url, title: 'Example', chapters: [] };
    const book = createSiteBook(toc);
    expect(book.hash).toBe(createSiteBook(toc).hash);
    expect(parseSiteBookUrl(buildSiteBookUrl(url))).toBe(url);
    expect(book.metadata?.siteUrl).toBe(url);
  });

  it('follows an embedded table of contents and keeps the book title', async () => {
    vi.mocked(guardedFetchText).mockImplementation(async (url) => {
      if (url === 'https://example.com/') {
        return '<html><head><title>Example Book</title></head><body><iframe src="toc.html"></iframe></body></html>';
      }
      return '<html><body><ol><li><a href="01.html">1. First</a></li><li><a href="02.html">2. Second</a></li></ol></body></html>';
    });
    const toc = await discoverSiteToc('https://example.com/');
    expect(toc.title).toBe('Example Book');
    expect(toc.url).toBe('https://example.com/toc.html');
    expect(toc.chapters).toHaveLength(2);
  });
});
