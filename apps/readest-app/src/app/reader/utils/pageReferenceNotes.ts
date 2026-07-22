import type { BookNote, BookNoteType, HighlightColor, HighlightStyle } from '@/types/book';
import type { PageReference } from './pageReferences';

export type PageReferenceSaveType = Extract<BookNoteType, 'annotation' | 'reference'>;
export type PageReferenceSaveStatus = 'created' | 'restored' | 'duplicate' | 'missing-location';

interface SaveOptions {
  now: number;
  createId: () => string;
  style?: HighlightStyle;
  color?: HighlightColor;
}

interface SaveResult {
  status: PageReferenceSaveStatus;
  notes: BookNote[];
  note?: BookNote;
}

const sameReference = (note: BookNote, reference: PageReference, type: PageReferenceSaveType) => {
  if (note.type !== type || note.cfi !== reference.sourceCfi) return false;
  if (type === 'annotation') return true;
  const target = reference.absoluteUrl ?? reference.targetCfi ?? reference.href;
  const existingTarget =
    note.referenceData?.url ?? note.referenceData?.targetCfi ?? note.referenceData?.href;
  return target === existingTarget;
};

export const isPageReferenceSaved = (
  notes: BookNote[],
  reference: PageReference,
  type?: PageReferenceSaveType,
) =>
  notes.some(
    (note) =>
      !note.deletedAt &&
      (type
        ? sameReference(note, reference, type)
        : sameReference(note, reference, 'annotation') ||
          sameReference(note, reference, 'reference')),
  );

const buildNote = (
  reference: PageReference,
  type: PageReferenceSaveType,
  userNote: string,
  options: SaveOptions,
  id: string,
): BookNote => {
  const trimmedNote = userNote.trim();
  return {
    id,
    type,
    cfi: reference.sourceCfi!,
    text: reference.title,
    note:
      type === 'annotation' ? trimmedNote || reference.description || reference.title : trimmedNote,
    ...(type === 'annotation' ? { style: options.style, color: options.color } : {}),
    ...(type === 'reference'
      ? {
          referenceData: {
            kind: reference.kind,
            href: reference.href,
            url: reference.absoluteUrl,
            targetCfi: reference.targetCfi,
            description: reference.description,
          },
        }
      : {}),
    createdAt: options.now,
    updatedAt: options.now,
  };
};

export const upsertPageReferenceNote = (
  notes: BookNote[],
  reference: PageReference,
  type: PageReferenceSaveType,
  userNote: string,
  options: SaveOptions,
): SaveResult => {
  if (!reference.sourceCfi) return { status: 'missing-location', notes };
  const index = notes.findIndex((note) => sameReference(note, reference, type));
  if (index >= 0) {
    const existing = notes[index]!;
    if (!existing.deletedAt) return { status: 'duplicate', notes, note: existing };
    const restored = {
      ...buildNote(reference, type, userNote, options, existing.id),
      createdAt: existing.createdAt,
      deletedAt: null,
    };
    const updated = [...notes];
    updated[index] = restored;
    return { status: 'restored', notes: updated, note: restored };
  }
  const note = buildNote(reference, type, userNote, options, options.createId());
  return { status: 'created', notes: [...notes, note], note };
};
