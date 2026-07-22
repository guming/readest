# PDF to Text Implementation Plan

## 1. Summary

This feature provides reliable text extracted from a PDF's native text layer for
Readest's Notebook Assistant and note-taking workflows. It reuses the PDF.js
runtime that Readest already ships and does not introduce OCR, image analysis,
or another document-processing dependency.

The first release supports:

- extracting the current PDF page
- extracting the current PDF chapter when a usable PDF Outline is available
- aggregating an explicit PDF page range
- preserving page numbers and source anchors
- supplying text to Current Page Summary, Current Chapter Summary, Key Insights,
  Takeaways, and Quiz
- copying extracted text and saving generated results to Notebook
- local, disposable extraction caching

The first release does not support:

- OCR or scanned PDFs
- text contained in images
- image-based tables
- image or vector formulas converted to LaTeX
- image descriptions or other multimodal understanding
- rewriting the PDF text layer
- synchronizing extracted full-page text

For a mixed PDF, Readest extracts only native PDF text and ignores image content.
Pages without extractable native text are skipped with an explicit user-facing
status.

## 2. Goals And Non-Goals

### Goals

1. Give Notebook Assistant stable, readable PDF text instead of depending only
   on the rendered text-layer DOM.
2. Keep enough page and coordinate metadata to locate a saved Notebook Card in
   the source PDF.
3. Improve the reading order of common single-column and basic two-column PDFs.
4. Keep extraction local, on demand, cancellable, and independent of reading.
5. Preserve all existing PDF rendering, selection, CFI, TTS, search, and
   annotation behavior.

### Non-goals

1. Recover content from pages made entirely of pixels.
2. Guarantee semantic reconstruction of tables, formulas, footnotes, or complex
   magazine layouts.
3. Build a general-purpose PDF converter in the first release.
4. Extract an entire book automatically when the PDF is opened.
5. Send extracted full-document content to Readest Cloud or file sync.

## 3. Existing Readest Foundation

Readest already provides the required low-level capabilities:

- `packages/foliate-js/pdf.js` uses PDF.js and creates one section per PDF page.
- PDF pages already expose native text through `streamTextContent()` and
  `getTextContent()`.
- The existing PDF text layer supports rendering, selection, and CFI anchoring.
- Notebook Assistant already builds page and chapter contexts in
  `src/services/notebook-assistant/context.ts`.
- Notebook Cards already store page, chapter, provider, model, and generated
  content metadata.

The missing layer is a stable PDF-specific text model. The current generic
context path reads `Range.textContent` or rendered document `innerText`, which
is useful as a fallback but is not sufficient for consistent paragraph
reconstruction or multi-page aggregation.

## 4. Architecture

```text
PDF.js page.getTextContent()
             |
             v
       Raw text items
             |
             v
     PdfTextExtractor
       - normalize items
       - reconstruct lines
       - reconstruct paragraphs
       - determine reading order
             |
             v
       PdfPageText model
             |
             v
     PdfTextRangeBuilder
       - current page
       - Outline chapter
       - explicit page range
             |
             v
 Notebook Assistant / Copy / Save / Export
```

The extractor is a read-only consumer of PDF.js. It must not modify the rendered
document, text-layer spans, PDF sections, selection ranges, or CFI structure.

### Integration boundary

The generic Notebook Assistant context builder should dispatch by document
type:

```text
buildCurrentPageContext()
  - PDF       -> PdfTextExtractor
  - EPUB/MOBI -> existing context implementation

buildCurrentChapterContext()
  - PDF       -> PDF Outline range + PdfTextRangeBuilder
  - EPUB/MOBI -> existing section.loadText() implementation
```

The existing path remains the fallback if PDF extraction fails unexpectedly.
An extraction failure must never prevent the user from continuing to read.

## 5. Data Model

```ts
interface PdfTextBlock {
  id: string;
  text: string;
  type: 'heading' | 'paragraph' | 'list' | 'unknown';
  bbox: [number, number, number, number];
  readingOrder: number;
}

interface PdfPageText {
  version: number;
  pageIndex: number;
  pageNumber: number;
  width: number;
  height: number;
  plainText: string;
  blocks: PdfTextBlock[];
  characterCount: number;
  quality: 'good' | 'partial' | 'empty';
}

interface PdfTextRange {
  startPage: number;
  endPage: number;
  text: string;
  pages: PdfPageText[];
  skippedPages: number[];
}

interface PdfSourceAnchor {
  documentType: 'pdf';
  startPage: number;
  endPage: number;
  pageCfi?: string;
  chapterId?: string;
  chapterTitle?: string;
}
```

`plainText` is the direct Assistant input. Blocks and bounding boxes are retained
for source navigation and future quality improvements. They are not used to
alter the rendered PDF.

## 6. Extraction And Reconstruction

### 6.1 Raw extraction

For each requested page, read PDF.js text content and retain:

- string content
- transformation matrix and baseline coordinates
- width and height
- explicit end-of-line markers
- font information when available

Empty strings, control characters, and non-text items are discarded. Image
objects and drawing operations are never inspected.

### 6.2 Line reconstruction

1. Group text items whose baselines and font-height-adjusted vertical positions
   are within a conservative tolerance.
2. Sort items within a line by writing direction and horizontal coordinate.
3. Infer whether adjacent items require no separator, a space, or retained
   punctuation.
4. Apply language-aware spacing so fragmented CJK text does not receive
   artificial spaces while Latin words remain separated.

### 6.3 Paragraph reconstruction

A new paragraph may be created when one or more of these signals are present:

- a larger vertical gap between lines
- a first-line indent
- a material font-size or weight change
- an explicit end-of-line combined with sentence-ending punctuation
- a heading or list marker

Ordinary visual line wrapping is joined into the same paragraph.

### 6.4 Hyphenation

English line-end hyphenation is joined only when the previous line ends with a
hyphen, the next line begins with a lowercase letter, and both lines are in the
same inferred paragraph. List markers and intentional compound words must not be
changed without sufficient evidence.

### 6.5 Headers and footers

Header and footer removal is performed only during multi-page aggregation.
Repeated short text in a consistent top or bottom region can be filtered after
comparison across pages. Current-page extraction only removes unambiguous page
numbers, avoiding aggressive single-page heuristics.

### 6.6 Basic two-column pages

The first release supports conservative two-column detection:

1. detect two clearly separated horizontal clusters
2. retain full-width headings ahead of both columns
3. read the left column top-to-bottom, followed by the right column
4. fall back to normal top-to-bottom order when column confidence is low

Complex multi-column layouts, floating callouts, and semantic table recovery
remain out of scope.

## 7. Scope Resolution

### Current page

Current Page uses the active PDF page section and returns:

- page number
- page CFI when available
- containing Outline chapter metadata when available
- character count and token estimate
- extraction quality

The request is blocked before calling the AI provider when no native text is
available.

### Current chapter

For PDFs, a chapter is not equivalent to a page section. Chapter boundaries are
resolved from the PDF Outline:

1. start at the current Outline destination page
2. end immediately before the next entry at the same or a higher hierarchy
3. include nested Outline entries within that range
4. if no usable Outline entry exists, do not silently treat the current page or
   entire document as a chapter

When no chapter can be resolved, the UI directs the user to Current Page or an
explicit Page Range.

### Page range

An explicit range is inclusive and reports skipped pages. Extraction is
incremental and cancellable. It must not start all pages with an unbounded
`Promise.all()`.

## 8. Notebook Assistant Integration

The extracted range becomes the source input for:

- Current Page Summary
- Current Chapter Summary
- Key Insights
- Takeaways
- Quiz

Before a request, the UI shows:

- source scope and page range
- extracted character count
- estimated input and maximum output tokens
- provider and model
- skipped-page count, when applicable

Long ranges follow the existing cost-confirmation behavior. The implementation
must not silently truncate the end of a chapter. If the provider context window
is insufficient, the request is blocked with guidance to reduce the range. A
later phase may add hierarchical chunk-and-merge summarization.

Notebook Cards store the generated result plus `PdfSourceAnchor`; they do not
store provider response metadata or the entire extracted chapter unless that
text is explicitly part of the saved card. Source navigation uses CFI first and
falls back to `startPage`.

## 9. Empty And Partial Results

User-visible states must distinguish:

- no native text on the current page
- no native text in the requested range
- some pages skipped because they have no native text
- PDF text encoding produced unusable content
- encrypted PDF prohibits extraction
- page loading failed
- extraction was cancelled
- chapter Outline is unavailable

For an empty page:

> No extractable text was found on this page. Scanned PDFs are not supported.

For a partial range:

> Extracted text from {processed} pages. Skipped {skipped} pages without
> extractable text.

Failure messages must not claim that OCR is available and must not send an empty
request to the configured AI provider.

## 10. Performance And Caching

Extraction is lazy and starts only when a PDF text-dependent action is invoked.
Opening, rendering, scrolling, or searching a PDF must not automatically extract
the full document.

Cache key:

```text
bookHash + pageIndex + extractorVersion
```

Cache rules:

- keep a small in-memory LRU for active reading
- optionally persist a size-limited, disposable local cache
- invalidate cached entries when the extractor version changes
- do not add extracted page text to the book configuration or sync envelope
- do not sync caches through Readest Cloud, WebDAV, S3, or R2
- allow cache deletion without affecting books or Notebook Cards

Multi-page extraction uses bounded concurrency. The initial implementation
should process no more than one or two pages concurrently on mobile and expose
an `AbortSignal` or equivalent cancellation mechanism.

## 11. Regression Protection

The implementation must preserve these boundaries:

- do not change `createDocument()` text-layer DOM structure
- do not merge, reorder, insert, or remove rendered text-layer spans
- do not change PDF canvas rendering or annotation layers
- do not change selection Range or PDF CFI generation
- do not change PDF pagination, zoom, rotation, or spread behavior
- do not replace existing PDF search or TTS inputs in the first release
- do not route EPUB or MOBI content through the PDF extractor
- do not make extraction a requirement for opening or reading a PDF

A feature flag, `pdfTextExtractionV1`, should isolate the new Assistant context
path during rollout. When disabled, the existing context behavior remains
available. When enabled, an unexpected extraction error falls back to the
existing visible-DOM context where that fallback is valid.

## 12. Implementation Phases

### Phase A: Extraction core

- define the structured page and range types
- expose a read-only PDF.js text-content accessor without changing rendering
- implement text-item normalization and line ordering
- implement CJK/Latin spacing, paragraph reconstruction, and conservative
  hyphenation
- implement empty and partial quality states
- add page-level in-memory caching and cancellation

Exit criteria: representative single-column PDF pages produce stable readable
text without affecting rendering, selection, CFI, or TTS.

### Phase B: Assistant integration

- dispatch PDF page context through the new extractor
- resolve PDF chapter ranges from Outline destinations
- implement bounded multi-page aggregation
- connect page and chapter text to Summary, Insights, Takeaways, and Quiz
- display page range, skipped pages, character count, and token estimate
- save PDF source anchors on Notebook Cards
- add feature-flagged fallback to the current context implementation

Exit criteria: page and Outline chapter actions use the correct source pages,
empty text never reaches the AI provider, and saved cards navigate back to the
correct PDF page.

### Phase C: Quality and export

- add conservative two-column reading order
- add repeated header and footer filtering
- improve headings and list reconstruction
- add explicit page-range selection
- add TXT and Markdown export if product scope still requires it
- add cache inspection and clear-cache controls if persistent caching is enabled

Exit criteria: the agreed PDF quality corpus passes reading-order and output
quality thresholds without a material mobile performance regression.

## 13. Test Plan

### Unit tests

- line grouping under small baseline differences
- correct CJK joining and Latin spacing
- punctuation handling
- paragraph-boundary inference
- conservative English hyphen joining
- reading-order behavior for single and basic two-column pages
- empty, partial, encrypted, and malformed text states
- Outline chapter range resolution, including nested entries
- cache versioning and cancellation

### Integration tests

- Current Page contains only the active PDF page
- Current Chapter matches the resolved Outline page range
- pages without native text are skipped and reported
- no empty request reaches the AI transport
- Notebook Cards record start page, end page, CFI, and chapter metadata
- card navigation falls back from CFI to page number
- EPUB and MOBI contexts remain unchanged

### Existing behavior regression tests

- open, render, turn, zoom, rotate, and change PDF spread mode
- select, copy, highlight, and annotate PDF text
- save and restore PDF CFI
- use PDF search and TTS
- rapidly navigate while cancelling a multi-page extraction
- close Assistant during extraction
- read a PDF successfully after extraction failure or cache deletion

### Visual and device verification

- desktop and iOS layouts for empty, partial, loading, cancellation, and error
  states
- narrow-screen wrapping for page ranges and token estimates
- VoiceOver labels and keyboard focus order
- E-ink mode boundaries and action hierarchy
- iOS memory, scrolling responsiveness, and device temperature during a long
  chapter extraction

## 14. Acceptance Criteria

1. A native-text PDF page can be extracted locally and used by all planned
   Notebook Assistant actions.
2. A PDF Outline chapter resolves to the correct inclusive page range.
3. A scanned or image-only page produces an explicit unsupported message and no
   AI request.
4. Mixed PDFs extract native text and clearly report skipped pages.
5. Generated Notebook Cards retain page and chapter source anchors.
6. Extracted full-page or full-chapter caches never enter sync data.
7. Extraction is cancellable and uses bounded concurrency.
8. Existing PDF rendering, selection, CFI, TTS, search, and annotations behave
   unchanged.
9. EPUB and MOBI Assistant behavior remains unchanged.
10. Disabling `pdfTextExtractionV1` restores the existing PDF Assistant context
    path without a data migration.

## 15. Product Decisions

- PDF.js remains the only extraction dependency in this phase.
- OCR is intentionally excluded, not deferred implicitly within this feature.
- Image content is ignored even when it contains visually readable text.
- PDF Outline is the authoritative source for chapter boundaries.
- No Outline means no automatic Current Chapter operation.
- Extracted text is local, disposable derived data; generated Notebook Cards are
  durable user data and continue to follow the existing sync behavior.
- The feature is initially scoped to Notebook Assistant reliability. A broader
  PDF-to-TXT/Markdown converter remains optional Phase C work.
