import { describe, expect, it, vi } from 'vitest';
import { wrappedFoliateView, type FoliateView } from '@/types/view';

function makeFakeView(goToImpl: (href: string) => Promise<void>) {
  const el = document.createElement('div') as unknown as FoliateView;
  el.addAnnotation = vi.fn() as unknown as FoliateView['addAnnotation'];
  el.goTo = goToImpl as unknown as FoliateView['goTo'];
  return el;
}

describe('wrappedFoliateView goTo events', () => {
  it('dispatches navigate-start before and navigate-end after goTo resolves', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const view = makeFakeView(() => gate);
    view.addEventListener('navigate-start', () => order.push('start'));
    view.addEventListener('navigate-end', () => order.push('end'));
    const wrapped = wrappedFoliateView(view);
    const nav = wrapped.goTo('5');
    expect(order).toEqual(['start']); // start fired synchronously, end pending
    release();
    await nav;
    expect(order).toEqual(['start', 'end']);
  });

  it('dispatches navigate-end even when goTo rejects', async () => {
    const order: string[] = [];
    const view = makeFakeView(() => Promise.reject(new Error('nav failed')));
    view.addEventListener('navigate-start', () => order.push('start'));
    view.addEventListener('navigate-end', () => order.push('end'));
    const wrapped = wrappedFoliateView(view);
    await expect(wrapped.goTo('5')).rejects.toThrow('nav failed');
    expect(order).toEqual(['start', 'end']);
  });

  it('reanchors a PDF annotation into the currently rendered reflow section', async () => {
    const view = makeFakeView(() => Promise.resolve());
    const originalAddAnnotation = vi.fn().mockResolvedValue({ index: 0, label: '' });
    const doc = document.implementation.createHTMLDocument('reflow');
    doc.body.innerHTML =
      '<article data-source-page="4"><span>Before </span><strong>selected words</strong></article>';
    view.addAnnotation = originalAddAnnotation;
    view.book = {
      metadata: { title: 'PDF' },
      sections: [],
      isPDFReflow: true,
      reflowSectionPageCount: 6,
    } as unknown as FoliateView['book'];
    view.renderer = {
      getContents: () => [{ doc, index: 0 }],
    } as unknown as FoliateView['renderer'];
    view.getCFI = vi.fn().mockReturnValue('epubcfi(/6/2!/4/2:0)');

    const wrapped = wrappedFoliateView(view);
    await wrapped.addAnnotation({
      id: 'pdf-note',
      type: 'annotation',
      cfi: 'epubcfi(/6/10!/4/2:0)',
      text: 'selected words',
      note: '',
      pdfAnchor: { pageIndex: 4, exact: 'selected words', prefix: 'Before ' },
      createdAt: 1,
      updatedAt: 1,
    });

    expect(view.getCFI).toHaveBeenCalledWith(0, expect.any(Range));
    expect(originalAddAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'epubcfi(/6/2!/4/2:0)' }),
      false,
    );
  });
});
