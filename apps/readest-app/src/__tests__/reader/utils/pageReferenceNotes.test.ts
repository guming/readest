import { describe, expect, it } from 'vitest';

import { upsertPageReferenceNote } from '@/app/reader/utils/pageReferenceNotes';
import type { PageReference } from '@/app/reader/utils/pageReferences';
import type { BookNote } from '@/types/book';

const reference: PageReference = {
  id: 'external:https://example.com/paper',
  kind: 'external',
  title: 'Paper',
  href: 'https://example.com/paper',
  absoluteUrl: 'https://example.com/paper',
  description: 'A useful paper',
  sourceCfi: 'epubcfi(/6/2!/4/2)',
  occurrences: 1,
};

const options = { now: 100, createId: () => 'ref-1' };

describe('upsertPageReferenceNote', () => {
  it('creates a native reference note with structured reference data', () => {
    const result = upsertPageReferenceNote([], reference, 'reference', '', options);

    expect(result.status).toBe('created');
    expect(result.note).toMatchObject({
      id: 'ref-1',
      type: 'reference',
      cfi: reference.sourceCfi,
      text: 'Paper',
      note: '',
      referenceData: {
        kind: 'external',
        href: 'https://example.com/paper',
        url: 'https://example.com/paper',
        description: 'A useful paper',
      },
    });
  });

  it('creates an annotation and falls back to the reference description for an empty note', () => {
    const result = upsertPageReferenceNote([], reference, 'annotation', '', options);
    expect(result.note).toMatchObject({
      type: 'annotation',
      note: 'A useful paper',
      cfi: reference.sourceCfi,
    });
  });

  it('rejects an active duplicate of the same type and source', () => {
    const first = upsertPageReferenceNote([], reference, 'reference', '', options).note!;
    const result = upsertPageReferenceNote([first], reference, 'reference', 'new note', options);
    expect(result.status).toBe('duplicate');
    expect(result.notes).toEqual([first]);
  });

  it('restores a soft-deleted duplicate instead of creating another record', () => {
    const deleted: BookNote = {
      ...upsertPageReferenceNote([], reference, 'reference', '', options).note!,
      deletedAt: 90,
    };
    const result = upsertPageReferenceNote([deleted], reference, 'reference', 'restored', {
      now: 120,
      createId: () => 'unused',
    });
    expect(result.status).toBe('restored');
    expect(result.note).toMatchObject({
      id: 'ref-1',
      note: 'restored',
      deletedAt: null,
      updatedAt: 120,
    });
  });

  it('fails without a source CFI', () => {
    const result = upsertPageReferenceNote(
      [],
      { ...reference, sourceCfi: undefined },
      'reference',
      '',
      options,
    );
    expect(result.status).toBe('missing-location');
  });
});
