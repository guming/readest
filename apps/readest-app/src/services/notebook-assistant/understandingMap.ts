import type { OneQuestionSourceBlock } from './types';

export interface UnderstandingMapNode {
  id: string;
  label: string;
  explanation: string;
  evidenceQuote: string;
  sourceCfi?: string;
}

export interface UnderstandingMap {
  schemaVersion: 1;
  question: string;
  nodes: UnderstandingMapNode[];
  edges: {
    from: string;
    to: string;
    relation: 'supports' | 'challenges' | 'limits' | 'precedes' | 'explains';
  }[];
}

const relations = new Set(['supports', 'challenges', 'limits', 'precedes', 'explains']);
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const required = (value: unknown, max: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error('The provider returned an invalid understanding map.');
  }
  return value.trim();
};

export function parseUnderstandingMap(
  content: string,
  blocks: OneQuestionSourceBlock[],
): UnderstandingMap {
  let raw: unknown;
  try {
    const match = content.match(/\{[\s\S]*\}/);
    raw = JSON.parse(match?.[0] ?? content);
  } catch {
    throw new Error('The provider returned an invalid understanding map.');
  }
  if (!raw || typeof raw !== 'object')
    throw new Error('The provider returned an invalid understanding map.');
  const value = raw as Record<string, unknown>;
  if (value['reason'] === 'insufficient_content') {
    throw new Error('This chapter does not contain enough material for a grounded map.');
  }
  if (
    !Array.isArray(value['nodes']) ||
    value['nodes'].length < 2 ||
    value['nodes'].length > 9 ||
    !Array.isArray(value['edges'])
  ) {
    throw new Error('The provider returned an invalid understanding map.');
  }
  const nodes = value['nodes'].map((item) => {
    if (!item || typeof item !== 'object')
      throw new Error('The provider returned an invalid understanding map.');
    const node = item as Record<string, unknown>;
    const id = required(node['id'], 30);
    const blockId = required(node['sourceBlockId'], 100);
    const block = blocks.find((source) => source.id === blockId);
    if (!block) throw new Error('A map node has no matching source passage.');
    const evidenceQuote = required(node['evidenceQuote'], 280);
    if (!normalize(block.text).includes(normalize(evidenceQuote))) {
      throw new Error('A map node cites text that is not in the chapter.');
    }
    return {
      id,
      label: required(node['label'], 90),
      explanation: required(node['explanation'], 420),
      evidenceQuote,
      sourceCfi: block.cfi,
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length || value['edges'].length < 1 || value['edges'].length > 12) {
    throw new Error('The provider returned an invalid understanding map.');
  }
  const edges = value['edges'].map((item) => {
    if (!item || typeof item !== 'object')
      throw new Error('The provider returned an invalid understanding map.');
    const edge = item as Record<string, unknown>;
    const from = required(edge['from'], 30);
    const to = required(edge['to'], 30);
    const relation = required(edge['relation'], 20);
    if (!ids.has(from) || !ids.has(to) || from === to || !relations.has(relation)) {
      throw new Error('The provider returned an invalid map relationship.');
    }
    return { from, to, relation: relation as UnderstandingMap['edges'][number]['relation'] };
  });
  return { schemaVersion: 1, question: required(value['question'], 180), nodes, edges };
}

const escapeMermaid = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\r\n|]/g, ' ');

export function toMermaidFlowchart(
  map: UnderstandingMap,
  relationLabels?: Partial<Record<UnderstandingMap['edges'][number]['relation'], string>>,
): string {
  const ids = new Map(map.nodes.map((node, index) => [node.id, `n${index}`]));
  return [
    'flowchart TD',
    ...map.nodes.map((node) => `  ${ids.get(node.id)}["${escapeMermaid(node.label)}"]`),
    ...map.edges.map(
      (edge) =>
        `  ${ids.get(edge.from)} -->|${escapeMermaid(relationLabels?.[edge.relation] ?? edge.relation)}| ${ids.get(edge.to)}`,
    ),
  ].join('\n');
}
