import { shouldCheckAsFootnote } from './footnoteHeuristics';

export type PageReferenceKind = 'external' | 'footnote' | 'internal';

export interface PageReference {
  id: string;
  kind: PageReferenceKind;
  title: string;
  href: string;
  absoluteUrl?: string;
  description?: string;
  sourceCfi?: string;
  targetCfi?: string;
  sectionIndex?: number;
  occurrences: number;
}

interface RenderedContent {
  doc?: Document | null;
  index?: number;
}

interface ReferenceView {
  getCFI?: (index: number, range: Range) => string;
  renderer?: {
    getContents?: () => RenderedContent[];
  };
  book?: {
    sections?: Array<{
      id: string;
      resolveHref?: (href: string) => string | null | undefined;
    }>;
  };
}

const EXTERNAL_SCHEME_RE = /^(?:https?:|mailto:)/i;
const UNSAFE_SCHEME_RE = /^(?:javascript:|data:)/i;

const intersects = (
  a: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
  b: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>,
) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;

const normalizeTitle = (anchor: HTMLAnchorElement, absoluteUrl?: string) => {
  const explicit = anchor.getAttribute('title')?.trim();
  const text = anchor.textContent?.replace(/\s+/g, ' ').trim();
  if (explicit) return explicit;
  if (text) return text;
  if (absoluteUrl) {
    try {
      return new URL(absoluteUrl).hostname || absoluteUrl;
    } catch {
      return absoluteUrl;
    }
  }
  return anchor.getAttribute('href')?.trim() || 'Untitled link';
};

const isFootnote = (anchor: HTMLAnchorElement) => {
  const role = anchor.getAttribute('role')?.toLowerCase();
  const epubType = anchor.getAttribute('epub:type')?.toLowerCase();
  return (
    role === 'doc-noteref' ||
    epubType?.split(/\s+/).includes('noteref') ||
    shouldCheckAsFootnote(anchor)
  );
};

const isAnchorVisible = (anchor: HTMLAnchorElement, frameRect: DOMRect, visibleFrame: DOMRect) =>
  Array.from(anchor.getClientRects()).some((rect) =>
    intersects(
      {
        left: frameRect.left + rect.left,
        right: frameRect.left + rect.right,
        top: frameRect.top + rect.top,
        bottom: frameRect.top + rect.bottom,
      },
      visibleFrame,
    ),
  );

const resolveExternalUrl = (href: string, baseURI: string) => {
  try {
    const url = new URL(href, baseURI);
    return EXTERNAL_SCHEME_RE.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const findFragmentTarget = (doc: Document, href: string) => {
  const hashIndex = href.indexOf('#');
  if (hashIndex < 0) return undefined;
  let id = href.slice(hashIndex + 1);
  try {
    id = decodeURIComponent(id);
  } catch {
    // Keep the original fragment when a malformed escape sequence is present.
  }
  return doc.getElementById(id) ?? undefined;
};

const extractFootnoteDescription = (target: Element | undefined, marker: string) => {
  let text = target?.textContent
    ?.replace(/↩|↵|\uFE0E/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  const normalizedMarker = marker.replace(/\s+/g, ' ').trim();
  if (normalizedMarker) {
    const escapedMarker = normalizedMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^${escapedMarker}(?:[.．、):：\\]\\s-]+|$)`), '').trim();
  }
  if (!text) return undefined;
  return text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text;
};

export const extractVisiblePageReferences = (
  view: ReferenceView | null | undefined,
): PageReference[] => {
  let contents: RenderedContent[] = [];
  try {
    contents = view?.renderer?.getContents?.() ?? [];
  } catch {
    return [];
  }

  const viewport = {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
  const merged = new Map<string, PageReference>();

  for (const { doc, index } of contents) {
    const frame = doc?.defaultView?.frameElement;
    if (!doc || !(frame instanceof Element)) continue;
    const frameRect = frame.getBoundingClientRect();
    if (!intersects(frameRect, viewport)) continue;
    const visibleFrame = DOMRect.fromRect({
      x: Math.max(frameRect.left, viewport.left),
      y: Math.max(frameRect.top, viewport.top),
      width: Math.max(
        0,
        Math.min(frameRect.right, viewport.right) - Math.max(frameRect.left, viewport.left),
      ),
      height: Math.max(
        0,
        Math.min(frameRect.bottom, viewport.bottom) - Math.max(frameRect.top, viewport.top),
      ),
    });

    for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      const href = anchor.getAttribute('href')?.trim() ?? '';
      if (!href || UNSAFE_SCHEME_RE.test(href) || !isAnchorVisible(anchor, frameRect, visibleFrame))
        continue;

      const external = EXTERNAL_SCHEME_RE.test(href) || href.startsWith('//');
      const footnote = !external && isFootnote(anchor);
      const absoluteUrl = external ? resolveExternalUrl(href, doc.baseURI) : undefined;
      if (external && !absoluteUrl) continue;
      const kind: PageReferenceKind = footnote ? 'footnote' : external ? 'external' : 'internal';
      let navigationHref = href;
      if (!external && typeof index === 'number') {
        try {
          navigationHref = view?.book?.sections?.[index]?.resolveHref?.(href) ?? href;
        } catch {
          navigationHref = href;
        }
      }
      const key = `${kind}:${absoluteUrl ?? navigationHref}`;
      const title = normalizeTitle(anchor, absoluteUrl);
      const fragmentTarget = footnote ? findFragmentTarget(doc, href) : undefined;
      const description = footnote ? extractFootnoteDescription(fragmentTarget, title) : undefined;
      let sourceCfi: string | undefined;
      if (typeof index === 'number' && view?.getCFI) {
        try {
          const range = doc.createRange();
          range.selectNodeContents(anchor);
          sourceCfi = view.getCFI(index, range);
        } catch {
          sourceCfi = undefined;
        }
      }
      let targetCfi: string | undefined;
      if (fragmentTarget && typeof index === 'number' && view?.getCFI) {
        try {
          const range = doc.createRange();
          range.selectNodeContents(fragmentTarget);
          targetCfi = view.getCFI(index, range);
        } catch {
          targetCfi = undefined;
        }
      }
      const existing = merged.get(key);
      if (existing) {
        existing.occurrences += 1;
        if (title.length > existing.title.length) existing.title = title;
        if ((description?.length ?? 0) > (existing.description?.length ?? 0)) {
          existing.description = description;
        }
        existing.sourceCfi ??= sourceCfi;
        existing.targetCfi ??= targetCfi;
        continue;
      }
      merged.set(key, {
        id: key,
        kind,
        title,
        href: navigationHref,
        absoluteUrl,
        description,
        sourceCfi,
        targetCfi,
        sectionIndex: index,
        occurrences: 1,
      });
    }
  }

  return Array.from(merged.values());
};

const escapeMarkdownLabel = (label: string) => label.replace(/([\\[\]])/g, '\\$1');

export const formatExternalReferencesAsMarkdown = (items: PageReference[]) =>
  items
    .filter(
      (item): item is PageReference & { absoluteUrl: string } =>
        item.kind === 'external' && !!item.absoluteUrl && /^https?:/i.test(item.absoluteUrl),
    )
    .map((item) => `- [${escapeMarkdownLabel(item.title)}](${item.absoluteUrl})`)
    .join('\n');
