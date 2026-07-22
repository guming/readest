import type { BookNote } from '@/types/book';

const escapeLabel = (value: string) => value.replace(/([\\[\]])/g, '\\$1');

export const formatBookReferencesMarkdown = (notes: BookNote[], heading: string) => {
  const references = notes.filter((note) => note.type === 'reference' && !note.deletedAt);
  if (references.length === 0) return '';
  const lines = [`## ${heading}`, ''];
  for (const reference of references) {
    const title = reference.text || 'Untitled';
    const url = reference.referenceData?.url;
    lines.push(url ? `- [${escapeLabel(title)}](${url})` : `- **${title}**`);
    if (reference.referenceData?.description)
      lines.push(`  ${reference.referenceData.description}`);
    if (reference.note) lines.push(`  ${reference.note}`);
  }
  return lines.join('\n');
};
