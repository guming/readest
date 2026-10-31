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
  it('previews Hugging Face navigation including collapsed groups without fetching chapters', async () => {
    const props = {
      library: 'trl',
      version: 'v1.2.0',
      lang: 'en',
      title: 'TRL',
      chapters: [
        {
          title: 'Trainers',
          sections: [
            { title: 'SFT', url: '/docs/trl/v1.2.0/en/sft_trainer' },
            { title: 'Other', url: '/docs/transformers/main/en/index' },
          ],
        },
        {
          title: 'Experimental',
          sections: [
            {
              title: 'Nested',
              sections: [{ title: 'Example', url: '/docs/trl/v1.2.0/en/example' }],
            },
          ],
        },
      ],
    };
    vi.mocked(guardedFetchText)
      .mockReset()
      .mockResolvedValue(`<div data-props='${JSON.stringify(props)}'></div>`);
    const toc = await discoverSiteToc('https://huggingface.co/docs/trl/v1.2.0/en/sft_trainer');
    expect(guardedFetchText).toHaveBeenCalledTimes(1);
    expect(toc.version).toBe('v1.2.0');
    expect(toc.chapters).toEqual([
      {
        title: 'SFT',
        url: 'https://huggingface.co/docs/trl/v1.2.0/en/sft_trainer',
        group: 'Trainers',
      },
      {
        title: 'Example',
        url: 'https://huggingface.co/docs/trl/v1.2.0/en/example',
        group: 'Experimental / Nested',
      },
    ]);
  });
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
