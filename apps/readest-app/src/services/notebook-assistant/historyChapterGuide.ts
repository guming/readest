import type { OneQuestionSourceBlock } from './types';

export interface HistoryEvidence {
  point: string;
  evidenceQuote: string;
  sourceBlockId?: string;
  sourceCfi?: string;
}

export interface HistoryChapterGuide {
  schemaVersion: 1;
  overview: string;
  keyPoints: HistoryEvidence[];
  reasoning: Array<HistoryEvidence & { premise: string; conclusion: string }>;
  limits: HistoryEvidence[];
  takeaways: string[];
}

const required = (value: unknown, max = 600, field = 'required text field'): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`The provider response has a missing or invalid ${field}.`);
  }
  return value.trim();
};

const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();

export function findEvidenceRange(doc: Document, quote: string): Range | null {
  const target = normalized(quote);
  if (!target) return null;
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  const positions: Array<{ node: Text; offset: number }> = [];
  let flattened = '';
  let pendingSpace: { node: Text; offset: number } | null = null;
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const parent = node.parentElement;
    if (!parent?.closest('script, style, noscript, template, .cfi-inert')) {
      const value = node.nodeValue ?? '';
      for (let offset = 0; offset < value.length; offset += 1) {
        const char = value[offset]!;
        if (/\s/.test(char)) {
          pendingSpace ??= { node, offset };
          continue;
        }
        if (pendingSpace && flattened.length > 0) {
          flattened += ' ';
          positions.push(pendingSpace);
        }
        pendingSpace = null;
        flattened += char;
        positions.push({ node, offset });
      }
    }
    current = walker.nextNode();
  }
  const matchIndex = flattened.indexOf(target);
  if (matchIndex < 0) return null;
  const start = positions[matchIndex];
  const last = positions[matchIndex + target.length - 1];
  if (!start || !last) return null;
  try {
    const range = doc.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(last.node, last.offset + 1);
    return range;
  } catch {
    return null;
  }
}

export function parseHistoryChapterGuide(
  content: string,
  blocks: OneQuestionSourceBlock[],
): HistoryChapterGuide {
  let raw: Record<string, unknown>;
  try {
    const match = content.match(/\{[\s\S]*\}/);
    raw = JSON.parse(match?.[0] ?? content) as Record<string, unknown>;
  } catch {
    throw new Error('The provider returned an invalid chapter guide.');
  }
  if (!raw || typeof raw !== 'object')
    throw new Error('The provider returned an invalid chapter guide.');
  if (raw['reason'] === 'insufficient_content') {
    const sourceLength = blocks.reduce((sum, block) => sum + block.text.trim().length, 0);
    throw new Error(
      sourceLength < 300
        ? 'This chapter does not contain enough text for a grounded guide.'
        : 'The AI could not analyze this chapter. Please try again.',
    );
  }
  const evidence = (value: unknown): HistoryEvidence[] => {
    if (!Array.isArray(value))
      throw new Error('The provider response is missing the keyPoints array.');
    return value.slice(0, 6).flatMap((item: unknown) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const entry = item as Record<string, unknown>;
      try {
        const block = blocks.find((candidate) => candidate.id === entry['sourceBlockId']);
        const quote = required(entry['evidenceQuote'], 280, 'evidenceQuote');
        const point = required(entry['point'], 600, 'point');
        if (!block || !normalized(block.text).includes(normalized(quote))) return [];
        return [
          {
            point,
            evidenceQuote: quote,
            sourceBlockId: block.id,
            sourceCfi: block.cfi,
          },
        ];
      } catch {
        return [];
      }
    });
  };
  const keyPoints = evidence(raw['keyPoints']);
  const limits = evidence(raw['limits'] ?? []);
  if (keyPoints.length === 0) throw new Error('The chapter guide has no grounded findings.');
  if (raw['reasoning'] != null && !Array.isArray(raw['reasoning'])) {
    throw new Error('The provider response has an invalid reasoning array.');
  }
  const reasoning = ((raw['reasoning'] ?? []) as unknown[]).slice(0, 5).flatMap((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const entry = item as Record<string, unknown>;
    try {
      const [verified] = evidence([item]);
      if (!verified) return [];
      return [
        {
          ...verified,
          premise: required(entry['premise'], 600, 'reasoning premise'),
          conclusion: required(entry['conclusion'], 600, 'reasoning conclusion'),
        },
      ];
    } catch {
      return [];
    }
  });
  if (raw['takeaways'] != null && !Array.isArray(raw['takeaways'])) {
    throw new Error('The provider response has an invalid takeaways array.');
  }
  const takeaways = ((raw['takeaways'] ?? []) as unknown[]).slice(0, 5).flatMap((item: unknown) => {
    if (typeof item !== 'string' || !item.trim() || item.length > 400) return [];
    return [item.trim()];
  });
  return {
    schemaVersion: 1,
    overview:
      typeof raw['overview'] === 'string' && raw['overview'].trim()
        ? required(raw['overview'], 1_500)
        : keyPoints.map((item) => item.point).join(' '),
    keyPoints,
    reasoning,
    limits,
    takeaways,
  };
}
