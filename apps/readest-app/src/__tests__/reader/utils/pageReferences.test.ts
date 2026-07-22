import { describe, expect, it } from 'vitest';

import {
  extractVisiblePageReferences,
  formatExternalReferencesAsMarkdown,
} from '@/app/reader/utils/pageReferences';

const rect = (left: number, top: number, right: number, bottom: number): DOMRect =>
  ({
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const makeContent = (html: string, frameRect = rect(10, 10, 410, 610), index = 0) => {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frame.getBoundingClientRect = () => frameRect;
  const doc = frame.contentDocument!;
  doc.head.innerHTML = '<base href="https://book.example/chapters/one.xhtml">';
  doc.body.innerHTML = html;
  for (const anchor of doc.querySelectorAll('a')) {
    anchor.getClientRects = () => [rect(10, 10, 110, 30)] as unknown as DOMRectList;
  }
  return { doc, index };
};

const makeView = (...contents: ReturnType<typeof makeContent>[]) => ({
  renderer: { getContents: () => contents },
  getCFI: (index: number) => `epubcfi(/6/${index + 2})`,
  book: {
    sections: contents.map(({ index }) => ({
      id: `section-${index}`,
      resolveHref: (href: string) => `section-${index}/${href}`,
    })),
  },
});

describe('extractVisiblePageReferences', () => {
  it('classifies external, footnote, and internal links and filters unsafe protocols', () => {
    const content = makeContent(`
      <p><a href="https://example.com/paper" title="Paper title">Paper</a></p>
      <p><a href="#note-1" role="doc-noteref">1</a></p>
      <p><a href="two.xhtml#section">Next chapter</a></p>
      <p><a href="javascript:alert(1)">Unsafe</a></p>
      <p><a href="data:text/plain,nope">Data</a></p>
    `);

    const references = extractVisiblePageReferences(makeView(content));

    expect(references.map(({ kind, title }) => [kind, title])).toEqual([
      ['external', 'Paper title'],
      ['footnote', '1'],
      ['internal', 'Next chapter'],
    ]);
    expect(references[0]?.absoluteUrl).toBe('https://example.com/paper');
  });

  it('does not classify a numeric external link as a footnote', () => {
    const content = makeContent('<a href="https://example.com/reference/1">1</a>');

    expect(extractVisiblePageReferences(makeView(content))[0]?.kind).toBe('external');
  });

  it('resolves an internal href against its rendered section', () => {
    const content = makeContent('<a href="#note-1">Note</a>', rect(0, 0, 400, 600), 0);

    expect(extractVisiblePageReferences(makeView(content))[0]?.href).toBe('section-0/#note-1');
  });

  it('extracts a readable preview from a same-document footnote target', () => {
    const content = makeContent(`
      <a href="#footnote-6-661" role="doc-noteref">6</a>
      <aside id="footnote-6-661">6. This is the readable footnote text. ↩</aside>
    `);

    expect(extractVisiblePageReferences(makeView(content))[0]).toMatchObject({
      kind: 'footnote',
      title: '6',
      description: 'This is the readable footnote text.',
      sourceCfi: 'epubcfi(/6/2)',
      targetCfi: 'epubcfi(/6/2)',
    });
  });

  it('includes partially visible links and excludes links outside the visible frame intersection', () => {
    const content = makeContent('<a href="https://example.com/visible">Visible</a>');
    const anchor = content.doc.querySelector('a')!;
    anchor.getClientRects = () => [rect(-20, 20, 20, 40)] as unknown as DOMRectList;
    expect(extractVisiblePageReferences(makeView(content))).toHaveLength(1);

    anchor.getClientRects = () => [rect(500, 20, 520, 40)] as unknown as DOMRectList;
    expect(extractVisiblePageReferences(makeView(content))).toHaveLength(0);
  });

  it('merges duplicate links across visible documents and counts occurrences', () => {
    const left = makeContent(
      '<a href="https://example.com/paper">Paper</a>',
      rect(0, 0, 400, 600),
      1,
    );
    const right = makeContent(
      '<a href="https://example.com/paper">A longer paper title</a>',
      rect(400, 0, 800, 600),
      2,
    );

    const references = extractVisiblePageReferences(makeView(left, right));

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ occurrences: 2, title: 'A longer paper title' });
  });

  it('ignores documents whose iframe is outside the host viewport', () => {
    const content = makeContent(
      '<a href="https://example.com/hidden">Hidden</a>',
      rect(0, 2000, 400, 2600),
    );
    expect(extractVisiblePageReferences(makeView(content))).toEqual([]);
  });
});

describe('formatExternalReferencesAsMarkdown', () => {
  it('formats only HTTP(S) references and escapes markdown labels', () => {
    const content = makeContent(`
      <a href="https://example.com/a">A [paper]</a>
      <a href="mailto:author@example.com">Email</a>
      <a href="#note">Note</a>
    `);
    const references = extractVisiblePageReferences(makeView(content));

    expect(formatExternalReferencesAsMarkdown(references)).toBe(
      '- [A \\[paper\\]](https://example.com/a)',
    );
  });
});
