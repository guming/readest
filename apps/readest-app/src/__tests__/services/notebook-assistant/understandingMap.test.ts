import { describe, expect, it } from 'vitest';
import {
  parseUnderstandingMap,
  toMermaidFlowchart,
} from '@/services/notebook-assistant/understandingMap';

const blocks = [
  {
    id: 'b1',
    text: 'The first proposal assumes every student can travel.',
    cfi: 'cfi-1',
    endCfi: 'cfi-2',
  },
  {
    id: 'b2',
    text: 'The cost excludes students with limited resources.',
    cfi: 'cfi-3',
    endCfi: 'cfi-4',
  },
];

const response = JSON.stringify({
  question: 'Who can participate?',
  nodes: [
    {
      id: 'n1',
      label: 'Travel for everyone?',
      explanation: 'The proposal starts from universal access.',
      evidenceQuote: 'every student can travel',
      sourceBlockId: 'b1',
    },
    {
      id: 'n2',
      label: 'Cost limits access',
      explanation: 'Cost narrows who can participate.',
      evidenceQuote: 'excludes students with limited resources',
      sourceBlockId: 'b2',
    },
  ],
  edges: [{ from: 'n1', to: 'n2', relation: 'limits' }],
});

describe('understanding map', () => {
  it('keeps only verified source anchors and builds safe Mermaid labels', () => {
    const map = parseUnderstandingMap(response, blocks);
    expect(map.nodes[1]?.sourceCfi).toBe('cfi-3');
    expect(toMermaidFlowchart(map)).toContain('n0["Travel for everyone?"]');
    expect(toMermaidFlowchart(map)).toContain('n0 -->|limits| n1');
  });

  it('rejects fabricated evidence', () => {
    expect(() =>
      parseUnderstandingMap(response.replace('limited resources', 'unlimited resources'), blocks),
    ).toThrow();
  });

  it('reports when the chapter cannot support a grounded map', () => {
    expect(() => parseUnderstandingMap('{"reason":"insufficient_content"}', blocks)).toThrow(
      'not contain enough material',
    );
  });

  it('escapes Mermaid syntax supplied by the model', () => {
    const unsafe = JSON.parse(response);
    unsafe.nodes[1].label = 'Cost <script>" limits';
    const map = parseUnderstandingMap(JSON.stringify(unsafe), blocks);
    const diagram = toMermaidFlowchart(map);
    expect(diagram).not.toContain('<script>');
    expect(diagram).not.toContain('" limits');
  });
});
