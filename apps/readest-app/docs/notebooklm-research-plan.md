# Readest AI Research Plan

## Product Positioning

Readest should not copy NotebookLM as a generic research workspace. Its advantage is that every AI answer can stay anchored to a local reading position: book, chapter, paragraph, highlight, note, and CFI. The product goal is to turn the reader notebook into a source-grounded research layer for long-form reading.

## P0 Scope

### 1. Source Selector

Reader asks AI with an explicit source set before each request.

- Entry: Notebook Assistant header and prompt composer.
- Selectable sources: current book, current chapter, selected chapters, highlights, notes/cards, current page/selection.
- Default state: current book + current chapter selected when inside reader.
- Required behavior: every submitted prompt stores a source snapshot so the answer can be audited later.
- Key UI: compact source chips above the prompt, with a source drawer for detailed selection.
- Success metric: users can tell exactly which reading material will be sent before tapping Ask.

### 2. Inline Citations

AI answers must cite source anchors at paragraph level and support jumping back to the original reading location.

- Citation unit: answer paragraph, table row, bullet, and artifact block.
- Anchor fields: book id, chapter id, CFI/range, quote snippet, page/progress, source confidence.
- Interaction: tap citation badge to open preview; tap preview to jump reader to that anchor.
- Required behavior: unsupported claims are visually marked as "no source" or moved into a clearly labeled inference section.
- Success metric: citations are useful as navigation, not just decorative footnotes.

### 3. Source Guide

Every book gets an automatically generated entry map for study and retrieval.

- Sections: structure, major themes, people, terms, timeline/events, questions worth asking.
- Generation trigger: on-demand first open, with cached local artifact and stale-state refresh.
- Source grounding: each guide item stores multiple anchors and can start a filtered AI question.
- Key UI: Guide tab in Notebook or book details, with sections that open anchored cards.
- Success metric: a user can understand what to ask before they know the book well.

### 4. Studio Artifacts

AI output should be saved as reusable structured artifacts instead of disappearing in chat.

- P0 artifact types: Summary, Report, Table.
- Save targets: notebook project, current book, or selected source group.
- Editable fields: title, description, tags, source set, generated content.
- Citation requirement: artifacts preserve citations and jump-back behavior.
- Export baseline: Markdown first; later PDF/HTML export can follow.
- Success metric: users can turn a chat answer into a durable study/research object in one tap.

## P1 Scope: Mind Map

Mind Map is a local concept graph generated from selected sources. It is not just a diagram: every node must be traceable to source anchors and can become a new AI question.

### Core Jobs

- See the conceptual structure of a book, chapter, or source set.
- Inspect where a concept comes from.
- Continue asking from a node or edge with source context preselected.
- Save the graph as a study artifact.

### Data Model

- Node: id, label, type, summary, confidence, source anchors, related artifact ids.
- Edge: source node, target node, relation label, evidence anchors, confidence.
- View state: layout, pinned nodes, collapsed clusters, active source filter.

### Interaction Model

- Source first: generation starts from selected book/chapter/highlights/cards.
- Overview first: graph opens with clusters for themes, people, concepts, events.
- Traceability: selecting a node opens an evidence rail with citations and jump-back links.
- Continue question: node actions prefill prompts such as "explain this concept", "compare with", and "find contradictions".
- Local persistence: saved maps appear under Studio Artifacts and can be regenerated when sources change.

### Prototype

Open `apps/readest-app/docs/notebooklm-mindmap-prototype.html` in a browser to inspect the proposed UI.
