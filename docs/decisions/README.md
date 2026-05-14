# Architecture Decision Records (ADRs)

ADRs document non-obvious architectural choices. See [process.md](../process.md) for when to write one and what counts as "non-obvious."

## Index

| #     | Title                                              | Status     |
|-------|----------------------------------------------------|------------|
| [0001](0001-greenfield-canvas.md)     | Greenfield canvas, not a tldraw / excalidraw fork   | Accepted |
| [0002](0002-bun-runtime.md)           | Bun as the server runtime                           | Accepted |
| [0003](0003-yjs-collaboration.md)     | Y.js for collaboration                              | Accepted (implementation deferred per [0012](0012-sharing-deferred.md)) |
| [0004](0004-input-pipeline-tuning.md) | Input pipeline tuned for indirect-input pen tablets | Accepted |
| [0005](0005-tool-abstraction.md)      | Tool abstraction (pointer router + Tool interface)  | Accepted |
| [0006](0006-op-based-undo.md)         | Operation-based undo + soft-delete strokes          | Accepted |
| [0007](0007-tool-surface.md)          | Tool surface — cursor + contextual menu owned by tools | Accepted |
| [0008](0008-segment-eraser.md)        | Segment-level eraser (per-sample mask)              | Superseded by [0009](0009-pixel-mask-eraser.md) |
| [0009](0009-pixel-mask-eraser.md)     | Pixel-mask eraser (cursor-disk stamps)              | Accepted |
| [0010](0010-settings-data-model.md)   | Settings data model — versioned, sparse, sync-ready | Accepted |
| [0011](0011-toolbar-deferred.md)      | Floating toolbar deferred from v1                   | Accepted |
| [0012](0012-sharing-deferred.md)      | Sharing / live collaboration deferred from v1       | Accepted |
| [0013](0013-text-contenteditable-overlay.md) | Text editing via DOM contenteditable overlay | Accepted |
| [0014](0014-select-tool-selection-union.md)  | Select tool: discriminated-union Selection (vs polymorphism) | Accepted |
| [0015](0015-text-wrap-width-per-object.md)   | Text wrap-width as a per-object field        | Accepted |
| [0016](0016-lasso-into-select-absorption.md) | Lasso tool absorbed into the Select tool     | Accepted |

## Format

ADRs follow the [Michael Nygard template](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions):

- **Title**
- **Status** (Proposed / Accepted / Superseded by NNNN / Deprecated)
- **Context** — what is the situation, what forces are at play
- **Decision** — what we are doing
- **Consequences** — what becomes easier / harder, what risks we are taking on

ADRs are numbered sequentially starting at `0001`. They are immutable once accepted: errors are corrected by superseding (a new ADR that references the old one as Superseded).

## Template

```markdown
# NNNN. Short title in title case

Date: YYYY-MM-DD

## Status

Accepted

## Context

What is the situation? What forces are at play? What constraints are we operating under?

## Decision

What did we decide to do? Be specific.

## Consequences

What becomes easier as a result? What becomes harder? What risks are we taking on?
```
