import { describe, expect, it } from 'vitest';
import { formatBookReferencesMarkdown } from '@/app/reader/utils/referenceExport';
import type { BookNote } from '@/types/book';

describe('formatBookReferencesMarkdown', () => {
  it('exports external and internal references without EPUB hrefs', () => {
    const base = { cfi: 'cfi', createdAt: 1, updatedAt: 1, note: '' };
    const notes: BookNote[] = [
      {
        ...base,
        id: 'external',
        type: 'reference',
        text: 'Paper',
        note: 'Read later',
        referenceData: {
          kind: 'external',
          href: 'https://example.com/paper',
          url: 'https://example.com/paper',
        },
      },
      {
        ...base,
        id: 'footnote',
        type: 'reference',
        text: 'Footnote 6',
        referenceData: {
          kind: 'footnote',
          href: 'EPUB/chapter.xhtml#footnote-6',
          description: 'Readable footnote',
        },
      },
    ];
    const markdown = formatBookReferencesMarkdown(notes, 'References');
    expect(markdown).toContain('[Paper](https://example.com/paper)');
    expect(markdown).toContain('Readable footnote');
    expect(markdown).not.toContain('EPUB/chapter.xhtml');
  });
});
