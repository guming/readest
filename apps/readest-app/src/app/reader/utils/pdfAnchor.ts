import type { PDFTextAnchor } from '@/types/book';

const CONTEXT_LENGTH = 48;

const getTextNodes = (root: Node): Text[] => {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
};

const pointOffset = (nodes: Text[], container: Node, offset: number): number | null => {
  let total = 0;
  for (const node of nodes) {
    if (node === container) return total + offset;
    if (node.parentNode === container) {
      const children = Array.from(container.childNodes);
      const childIndex = children.indexOf(node);
      if (childIndex >= offset) return total;
    }
    total += node.data.length;
  }
  return null;
};

const pointAt = (nodes: Text[], offset: number): [Text, number] | null => {
  let total = 0;
  for (const node of nodes) {
    const end = total + node.data.length;
    if (offset <= end) return [node, Math.max(0, offset - total)];
    total = end;
  }
  const last = nodes.at(-1);
  return last ? [last, last.data.length] : null;
};

export const createPDFTextAnchor = (
  range: Range | null | undefined,
  fallbackPageIndex: number,
): PDFTextAnchor | undefined => {
  if (!range || range.collapsed) return undefined;
  const startElement =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  const pageElement = startElement?.closest<HTMLElement>('[data-source-page]');
  const root = pageElement ?? range.commonAncestorContainer.ownerDocument?.body;
  if (!root) return undefined;
  const nodes = getTextNodes(root);
  const start = pointOffset(nodes, range.startContainer, range.startOffset);
  const end = pointOffset(nodes, range.endContainer, range.endOffset);
  const exact = range.toString();
  if (start == null || end == null || !exact) return undefined;
  const content = nodes.map((node) => node.data).join('');
  const pageIndex = Number(pageElement?.dataset['sourcePage'] ?? fallbackPageIndex);
  return {
    pageIndex: Number.isFinite(pageIndex) ? pageIndex : fallbackPageIndex,
    exact,
    prefix: content.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: content.slice(end, end + CONTEXT_LENGTH),
  };
};

const findBestMatch = (content: string, anchor: PDFTextAnchor): number => {
  let best = -1;
  let bestScore = -1;
  for (
    let index = content.indexOf(anchor.exact);
    index >= 0;
    index = content.indexOf(anchor.exact, index + 1)
  ) {
    let score = 0;
    if (
      anchor.prefix &&
      content.slice(Math.max(0, index - anchor.prefix.length), index) === anchor.prefix
    )
      score += 2;
    const end = index + anchor.exact.length;
    if (anchor.suffix && content.slice(end, end + anchor.suffix.length) === anchor.suffix)
      score += 2;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  return best;
};

export const resolvePDFTextAnchor = (doc: Document, anchor: PDFTextAnchor): Range | null => {
  const pageRoot = doc.querySelector<HTMLElement>(`[data-source-page="${anchor.pageIndex}"]`);
  const root = pageRoot ?? doc.body;
  const nodes = getTextNodes(root);
  const content = nodes.map((node) => node.data).join('');
  const startOffset = findBestMatch(content, anchor);
  if (startOffset < 0) return null;
  const start = pointAt(nodes, startOffset);
  const end = pointAt(nodes, startOffset + anchor.exact.length);
  if (!start || !end) return null;
  const range = doc.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  return range;
};
