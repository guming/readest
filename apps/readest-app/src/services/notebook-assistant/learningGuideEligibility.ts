import type { BookFormat } from '@/types/book';
import type { BookMetadata } from '@/libs/document';
import type {
  BookLearningEligibility,
  NonFictionCategory,
} from '@/services/notebook-assistant/types';

export interface LearningGuideMetadataInput {
  title?: string;
  author?: string;
  description?: string;
  subject?: BookMetadata['subject'];
  calibreColumns?: BookMetadata['calibreColumns'];
  format?: BookFormat;
}

const FICTION_TERMS = [
  'fiction',
  'novel',
  '小说',
  '诗歌',
  'poetry',
  '戏剧',
  'drama',
  '漫画',
  'comic',
];

const CATEGORY_TERMS: Array<[NonFictionCategory, string[]]> = [
  [
    'social_science',
    ['psychology', 'sociology', 'economics', '心理学', '社会学', '经济学', '认知'],
  ],
  ['business', ['business', 'management', 'leadership', '商业', '管理', '领导力']],
  ['history', ['history', 'historical', '历史']],
  ['philosophy', ['philosophy', 'ethics', '哲学', '伦理']],
  ['science', ['science', 'physics', 'biology', 'chemistry', '科学', '物理', '生物', '化学']],
  ['technology', ['technology', 'software', 'programming', 'computer', '技术', '编程', '计算机']],
  ['textbook', ['textbook', 'handbook', 'course', '教材', '教科书', '教程']],
  ['biography', ['biography', 'memoir', '传记', '回忆录']],
  ['essay', ['essay', 'essays', '随笔', '评论']],
];

const normalizeValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(normalizeValue).join(' ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
};

export function evaluateLearningGuideEligibility(
  input: LearningGuideMetadataInput,
): BookLearningEligibility {
  const evidenceText = [
    normalizeValue(input.subject),
    normalizeValue(input.description),
    normalizeValue(input.calibreColumns),
  ]
    .join(' ')
    .toLowerCase();
  const fictionHits = FICTION_TERMS.filter((term) => evidenceText.includes(term));
  const categoryHits = CATEGORY_TERMS.map(([category, terms]) => ({
    category,
    hits: terms.filter((term) => evidenceText.includes(term)),
  })).filter((entry) => entry.hits.length > 0);

  if (fictionHits.length > 0 && categoryHits.length > 0) {
    return {
      status: 'uncertain',
      confidence: 0.5,
      evidence: [...fictionHits, ...categoryHits.flatMap((entry) => entry.hits)],
    };
  }
  if (fictionHits.length > 0) {
    return { status: 'unsupported_fiction', confidence: 0.9, evidence: fictionHits };
  }
  if (categoryHits.length > 0) {
    const best = categoryHits.sort((a, b) => b.hits.length - a.hits.length)[0]!;
    return {
      status: 'supported',
      category: best.category,
      confidence: Math.min(0.95, 0.72 + best.hits.length * 0.06),
      evidence: best.hits,
    };
  }
  return { status: 'uncertain', confidence: 0, evidence: [] };
}
