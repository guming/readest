import { describe, expect, it, vi } from 'vitest';

import {
  buildReflowPage,
  getImageRegions,
  makeReflowPDF,
  renderReflowSection,
} from 'foliate-js/pdf-reflow.js';

const item = (
  str: string,
  x: number,
  y: number,
  width: number,
  height = 12,
  fontName = 'body',
) => ({
  str,
  width,
  height,
  fontName,
  transform: [height, 0, 0, height, x, y],
  hasEOL: false,
});

describe('PDF reflow layout', () => {
  it('merges adjacent text runs into lines and lines into paragraphs', () => {
    const page = buildReflowPage(0, { width: 600, height: 800 }, [
      item('A practical', 60, 720, 70),
      item(' introduction', 132, 720, 82),
      item('to reflowed PDF reading.', 60, 700, 160),
      item('A separate paragraph.', 60, 660, 130),
    ]);

    expect(page.blocks).toHaveLength(2);
    expect(page.blocks[0]).toMatchObject({
      type: 'paragraph',
      text: 'A practical introduction to reflowed PDF reading.',
    });
    expect(page.blocks[1]).toMatchObject({
      type: 'paragraph',
      text: 'A separate paragraph.',
    });
  });

  it('orders a two-column page column by column', () => {
    const page = buildReflowPage(2, { width: 600, height: 800 }, [
      item('Right first.', 330, 720, 90),
      item('Left first.', 40, 720, 80),
      item('Right second.', 330, 680, 100),
      item('Left second.', 40, 680, 90),
    ]);

    expect(page.columnCount).toBe(2);
    expect(page.blocks.map((block: { text?: string }) => block.text)).toEqual([
      'Left first.',
      'Left second.',
      'Right first.',
      'Right second.',
    ]);
  });

  it('renders semantic, escaped HTML with stable source identifiers', () => {
    const html = renderReflowSection({
      id: 'pdf-reflow-section-0',
      pageStart: 0,
      pageEnd: 0,
      blocks: [
        {
          id: 'pdf-p0-b0',
          type: 'heading',
          level: 1,
          text: 'A <Title>',
          pageIndex: 0,
          bbox: [0.1, 0.1, 0.8, 0.2],
          spans: [],
        },
        {
          id: 'pdf-p0-b1',
          type: 'paragraph',
          text: 'Text & notes',
          pageIndex: 0,
          bbox: [0.1, 0.2, 0.8, 0.3],
          spans: [],
        },
      ],
    });

    expect(html).toContain('<h1');
    expect(html).toContain('data-reflow-block="pdf-p0-b0"');
    expect(html).toContain('A &lt;Title&gt;');
    expect(html).toContain('Text &amp; notes');
    expect(html).not.toContain('<Title>');
  });

  it('locates embedded image paint operations in normalized page coordinates', async () => {
    const previous = (globalThis as Record<string, unknown>)['pdfjsLib'];
    (globalThis as Record<string, unknown>)['pdfjsLib'] = {
      OPS: { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintInlineImageXObject: 5 },
    };
    const regions = await getImageRegions(
      {
        getOperatorList: async () => ({
          fnArray: [1, 3, 4, 2],
          argsArray: [[], [200, 0, 0, 160, 100, 300], ['img'], []],
        }),
      },
      {
        width: 600,
        height: 800,
        convertToViewportRectangle: ([x0, y0, x1, y1]: [number, number, number, number]) => [
          x0,
          800 - y0,
          x1,
          800 - y1,
        ],
      },
    );
    (globalThis as Record<string, unknown>)['pdfjsLib'] = previous;

    expect(regions).toHaveLength(1);
    expect(regions[0]![0]).toBeCloseTo(1 / 6);
    expect(regions[0]![2]).toBeCloseTo(1 / 2);
    expect(regions[0]![1]).toBeCloseTo(0.425);
    expect(regions[0]![3]).toBeCloseTo(0.625);
  });

  it('limits page work, maps nested TOC entries, and releases unloaded section resources', async () => {
    const previous = (globalThis as Record<string, unknown>)['pdfjsLib'];
    (globalThis as Record<string, unknown>)['pdfjsLib'] = { OPS: {} };
    let active = 0;
    let maxActive = 0;
    const cleanup = vi.fn();
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:section');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const pdf = {
      numPages: 7,
      getPage: async (pageNumber: number) => ({
        getViewport: () => ({
          width: 600,
          height: 800,
          convertToViewportRectangle: (rect: number[]) => rect,
        }),
        getTextContent: async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
          return { items: [item(`Page ${pageNumber}`, 50, 700, 80)] };
        },
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
        cleanup,
      }),
    };
    const book = makeReflowPDF({
      pdf,
      metadata: { title: 'Test' },
      getCover: async () => null,
      destroy: vi.fn(),
      toc: [
        {
          label: 'Part',
          href: 'pdf-page:0',
          index: 0,
          subitems: [{ label: 'Chapter', href: 'pdf-page:6', index: 6 }],
        },
      ],
    });

    await book.sections[0]!.load();
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(cleanup).toHaveBeenCalledTimes(6);
    expect(book.toc[0]!.subitems![0]!.index).toBe(1);
    expect(book.splitTOCHref('pdf-page:6')).toEqual(['pdf-reflow-section-1', 6]);

    book.sections[0]!.unload();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:section');
    book.destroy();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    (globalThis as Record<string, unknown>)['pdfjsLib'] = previous;
  });

  it('keeps the section readable when one PDF page cannot be extracted or rendered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => null);
    const cleanup = vi.fn();
    const book = makeReflowPDF({
      pdf: {
        numPages: 1,
        getPage: async () => ({
          getViewport: () => ({ width: 600, height: 800 }),
          getTextContent: async () => {
            throw new Error('broken text stream');
          },
          render: () => ({ promise: Promise.reject(new Error('broken page stream')) }),
          cleanup,
        }),
      },
      metadata: { title: 'Broken page' },
      getCover: async () => null,
      destroy: vi.fn(),
    });

    const doc = await book.sections[0]!.createDocument();
    expect(doc.body.textContent).toContain('Page 1 could not be reflowed.');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    getContext.mockRestore();
    warn.mockRestore();
  });
});
