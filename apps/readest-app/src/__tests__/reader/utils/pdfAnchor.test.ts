import { describe, expect, it } from 'vitest';

import { createPDFTextAnchor, resolvePDFTextAnchor } from '@/app/reader/utils/pdfAnchor';

describe('PDF text anchors', () => {
  it('resolves a selection after the PDF DOM is restructured', () => {
    const source = document.implementation.createHTMLDocument('source');
    source.body.innerHTML =
      '<section data-source-page="4"><p>Before selected words after.</p></section>';
    const text = source.querySelector('p')!.firstChild!;
    const range = source.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 21);

    const anchor = createPDFTextAnchor(range, 0)!;
    expect(anchor).toMatchObject({ pageIndex: 4, exact: 'selected words' });

    const target = document.implementation.createHTMLDocument('target');
    target.body.innerHTML =
      '<article data-source-page="4"><span>Before </span><strong>selected words</strong><span> after.</span></article>';
    const restored = resolvePDFTextAnchor(target, anchor);

    expect(restored?.toString()).toBe('selected words');
  });

  it('uses prefix and suffix to disambiguate repeated text', () => {
    const doc = document.implementation.createHTMLDocument('target');
    doc.body.innerHTML =
      '<main data-source-page="1">alpha repeated first; beta repeated second</main>';
    const anchor = {
      pageIndex: 1,
      exact: 'repeated',
      prefix: 'alpha ',
      suffix: ' first',
    };

    expect(resolvePDFTextAnchor(doc, anchor)?.toString()).toBe('repeated');
    const range = resolvePDFTextAnchor(doc, anchor)!;
    expect(range.startOffset).toBe(6);
  });
});
