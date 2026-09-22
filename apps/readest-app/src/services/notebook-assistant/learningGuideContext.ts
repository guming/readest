import type { BookDoc, BookMetadata, SectionItem, TOCItem } from '@/libs/document';
import type { NotebookAssistantCostMode } from './types';
import type { LearningGuideSourceKind } from './types';

export const LEARNING_GUIDE_PROMPT_VERSION = 2;

export interface LearningGuideContext {
  sourceText: string;
  sourceKinds: LearningGuideSourceKind[];
  sourceFingerprint: string;
  status: 'preliminary' | 'grounded';
  tocTitles: string[];
}

const tokenLimits: Record<NotebookAssistantCostMode, number> = {
  conservative: 8_000,
  balanced: 16_000,
  full_context: 32_000,
};

const plainText = (value: string): string =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const flattenToc = (items: TOCItem[] = []): string[] =>
  items.flatMap((item) => [plainText(item.label), ...flattenToc(item.subitems)]).filter(Boolean);

const stringifyMetadata = (metadata: BookMetadata): string => {
  const subject = Array.isArray(metadata.subject) ? metadata.subject.join(', ') : metadata.subject;
  return [
    `Title: ${typeof metadata.title === 'string' ? metadata.title : JSON.stringify(metadata.title)}`,
    `Author: ${typeof metadata.author === 'string' ? metadata.author : JSON.stringify(metadata.author)}`,
    metadata.description ? `Description: ${plainText(metadata.description)}` : '',
    subject ? `Subjects: ${typeof subject === 'string' ? subject : JSON.stringify(subject)}` : '',
    `Language: ${Array.isArray(metadata.language) ? metadata.language.join(', ') : metadata.language}`,
  ]
    .filter(Boolean)
    .join('\n');
};

const sectionLabel = (section: SectionItem, index: number): string =>
  plainText(section.href || section.id || `Section ${index + 1}`);

const isPreface = (label: string): boolean =>
  /preface|foreword|introduction|prologue|序言|前言|导论|引言/i.test(label);

async function readSection(section: SectionItem): Promise<string> {
  try {
    if (section.loadText) return plainText((await section.loadText()) || '');
    const doc = await section.createDocument();
    return plainText(doc.body?.innerText || doc.body?.textContent || '');
  } catch {
    return '';
  }
}

const hashText = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export async function buildLearningGuideContext({
  bookKey,
  metadata,
  bookDoc,
  costMode,
}: {
  bookKey: string;
  metadata: BookMetadata;
  bookDoc?: BookDoc | null;
  costMode: NotebookAssistantCostMode;
}): Promise<LearningGuideContext> {
  const sourceKinds: LearningGuideSourceKind[] = ['metadata'];
  const parts = [stringifyMetadata(metadata)];
  // PDF.js uses `null` for PDFs without an outline, whereas BookDoc's
  // application-facing contract treats a missing TOC as an empty list.
  // Keep the context builder tolerant of either representation so a document
  // with no outline can still contribute metadata and page text.
  const tocTitles = flattenToc(bookDoc?.toc ?? []);
  if (tocTitles.length > 0) {
    sourceKinds.push('toc');
    parts.push(`Table of contents:\n${tocTitles.join('\n')}`);
  }

  const sections = bookDoc?.sections ?? [];
  const candidates = sections.map((section, index) => ({
    section,
    index,
    label: sectionLabel(section, index),
  }));
  const preface = candidates.find((item) => isPreface(item.label));
  const firstChapter = candidates.find((item) => item.section.linear !== 'no' && item !== preface);
  if (preface) {
    const text = await readSection(preface.section);
    if (text) {
      sourceKinds.push('preface');
      parts.push(`Preface or introduction:\n${text}`);
    }
  }
  if (firstChapter) {
    const text = await readSection(firstChapter.section);
    if (text) {
      sourceKinds.push('chapter');
      parts.push(`Opening chapter:\n${text}`);
    }
  }

  const maxChars = tokenLimits[costMode] * 3;
  const sourceText = parts.join('\n\n').slice(0, maxChars);
  const grounded = sourceKinds.some((kind) => kind !== 'metadata');
  return {
    sourceText,
    sourceKinds,
    sourceFingerprint: hashText(
      `${bookKey}|${LEARNING_GUIDE_PROMPT_VERSION}|${sourceKinds.join(',')}|${sourceText}`,
    ),
    status: grounded ? 'grounded' : 'preliminary',
    tocTitles,
  };
}
