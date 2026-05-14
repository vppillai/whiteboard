# 0016. Lasso tool absorbed into the Select tool

Date: 2026-05-13

## Status

Accepted.

## Context

Through v1.2.0, the Select tool and the Lasso tool coexisted with overlapping but disjoint responsibilities:

- **Select tool (`V`)** owned single-object manipulation of floating objects (images, texts) and — in the v1.2 post-release iteration — click-to-select single strokes. Handle UI, rotation, resize, contextual menu.
- **Lasso tool (`S`)** owned multi-stroke selection via polygon-or-tap, drag-to-move-multiple, multi-delete, and the `Cmd+A` "select all strokes" path. No handles; no rotation; no resize. Strokes-only.

Two separate tools meant:

- Two selection states (`select.selected` + `lasso.selectedIds`) drifting in their own modules.
- Two `Cmd+A` routings — `batchSelection` marked images + texts for delete, Lasso selected strokes for move/delete.
- Two answers to the user-facing question "how do I select / move / delete N things at once?" — `V` for one thing, `S` for many strokes, neither for many images.
- A "third selection module" (`batchSelection.ts`) bridging the gap for Cmd+A → Delete of floating objects.
- The user-facing prompt that triggered this re-examination: **"does Lasso still make sense?"**

Multi-object demand was already growing. Users wanted to marquee-drag across images + texts to delete a region; they wanted to copy a mixed group as a PNG; they wanted one selection model that didn't care whether they hit a stroke, an image, or a text first. The Select tool's discriminated-union `Selection` (image | text | stroke) was already the right primitive — it just wasn't an array yet.

This is one of those "iterate on architecture, not arithmetic" moments. Two failed incremental tweaks (extending `batchSelection` to cover strokes; teaching Lasso to select images) would have produced a worse total — three modules half-doing each other's jobs. The abstraction was wrong: there shouldn't be two selection tools.

## Decision

**Absorb the Lasso tool into the Select tool. Select becomes the universal selection surface for every kind of board object, single or multi.**

Concretely:

1. **Selection type → array.** `Selection[]` replaces the previous single nullable. Single-selection (`length === 1`) drives the existing handle UI; multi-selection (`length > 1`) is move + delete only with a dashed group halo. Empty (`length === 0`) is "nothing selected."
2. **Marquee drag** becomes the gestural multi-select entry. Pointer-down on empty canvas + drag draws a rectangle; release picks every non-deleted object (strokes via sample-in-rect, floating objects via AABB intersection). `Shift+drag` extends the existing selection rather than replacing it.
3. **`Shift+click`** toggles a single object in/out of the current selection.
4. **`Cmd/Ctrl+A`** activates the Select tool (if not already active) and selects every non-deleted object across all three kinds — strokes, images, texts.
5. **Group drag** — pointer-down on any selected object (single or part of a multi) initiates a drag that moves the whole selection together. `commitDrag` walks the selection and emits one op per displaced item (a single `move` op for all displaced strokes; one `transform-image` per displaced image; one `transform-text` per displaced text). Undo restores all in one step because the ops queue commits in batch.
6. **Group delete** — `Delete` / `Backspace` walks the selection and dispatches the per-kind delete op for each item.
7. **PNG clipboard for multi-selection.** `Cmd/Ctrl+C` / `Cmd/Ctrl+X` writes a transparent-background PNG of the selection's bbox to the system clipboard (via the existing `writePngBlobToClipboard` path; same renderer as the export pipeline, `transparentBg=true`). The single-image-selection fast path still writes raw image bytes (preserves the original encoding for round-trip fidelity).
8. **Lasso tool deleted.** `apps/web/src/tools/lasso.ts` is removed. The `L` key, which had never been bound to Lasso (it was always Laser), is unchanged. The `S` key is rebound from Lasso to Select as an alias (keymap.ts: `if (k === 'v' || k === 's')` activates Select). This preserves the muscle memory of users who reached for `S` to select.
9. **`batchSelection` module deleted.** Its role (the Cmd+A → Delete mark for images + texts) is subsumed by `Select.selected: Selection[]` covering all three kinds in one state.
10. **`Esc` with a Select-tool selection** clears the selection (in addition to its existing cancel-pending-action role).
11. **Single-object Select callers preserved.** `selectStrokeById` / `selectImageById` / `selectTextById` helpers (used by the paste-and-auto-select-image path and the lasso → Select handoff that pre-dated this absorption) now write `[{ kind, id }]` to the new array. No call site outside `select.ts` changed shape.

## Consequences

**Acceptable:**

- One selection state across the app. One mental model for users ("how do I select things?" → "the Select tool, click or marquee or Shift+click or Cmd+A").
- One Cmd+A path. One delete path. One PNG-clipboard path. The triplicate state in `lasso` + `batchSelection` + `select` collapses to a single source of truth.
- The Lasso polygon-select gesture goes away. The marquee drag replaces it. Marquee is more conventional (Figma / Excalidraw / OS file pickers / etc.), simpler to implement, and easier to learn. Power users who liked the polygon gesture lose it; the project tenet ("snappy, sleek, user-friendly is paramount") favors the conventional gesture.
- Mixed-kind selections become natural — select two strokes + an image + a text in one marquee, drag the group, copy it as PNG, delete it. Previously impossible because the selection state was kind-partitioned across two modules.
- Architectural debt cleared: the `batchSelection` module was always a "this should really live in Select" workaround; deleting it removes a layer.

**Costs (BREAKING):**

- The `L` key was never lasso (it was always laser), so the keybinding semantics for users are unchanged at `L`. But muscle memory at `S` survives only because we explicitly aliased it; that needs to be communicated in release notes.
- The polygon-select gesture is gone. Users who used Lasso for non-rectangular regions can't reproduce that exact shape with a marquee. The tradeoff: marquee covers ~95% of selection cases more snappily; the niche polygon-select case is not worth a second tool.
- One file is now larger (~2030 LOC for `select.ts`). The per-kind dispatch-helper pattern (committed in [ADR 0014](0014-select-tool-selection-union.md)) keeps density low — `switch (selection.kind)` is concentrated in three dispatchers, each calling out to named helpers per kind.

## Considered alternatives

### A. Quick patch only — keep Lasso, rewire `Cmd+A` to Select

The minimal-touch option. Leave Lasso alone, change only the `Cmd+A` handler so it activates Select and marks images + texts via `batchSelection`. Rejected: this is the "iterate on arithmetic" path — it solves one user complaint (mixed-kind Cmd+A) but leaves the underlying duplication (two selection tools, two states, two delete paths) intact. The next user request (marquee-drag across kinds; multi-stroke move + image move in one gesture; PNG-copy a mixed group) would need another patch on top.

### B. Full absorption — Lasso deleted, Select becomes universal [CHOSEN]

The architectural option. Recognized that the underlying abstraction was wrong: there shouldn't be two selection tools. The `Selection[]` array is the right primitive; once it exists, Lasso has no remaining responsibility. Implemented in four small commits (`6dd4b92`, `4b6aa51`, `4df89dc`, `bed0519`), each scoped to one concern (data model → multi-move → marquee → clipboard + deletion).

### C. Keep Lasso, just rewire `Cmd+A` and add marquee to Select separately

The "both tools coexist, both gain features" option. Rejected: this is the worst of both — users now have two tools with overlapping capabilities, the question "which do I use?" gets harder, and we'd be doubling the surface area of selection logic indefinitely. The architectural smell (two selection tools) gets worse, not better.

### D. Keep Lasso for strokes only, document the split

Rejected on tenet grounds. Forcing users to remember "Lasso for strokes, Select for floating objects" is exactly the "snappy, sleek, user-friendly" violation we caught when extending Select to texts in [ADR 0014](0014-select-tool-selection-union.md). The selection tool is the *one* arrow / pointer surface.

## Migration

User-facing:

- `S` continues to activate the Select tool (preserved alias from Lasso muscle memory).
- `V` continues to activate the Select tool.
- `Cmd/Ctrl+A` now selects every non-deleted object across kinds via the Select tool. Behavior is a strict superset of the previous Cmd+A (which had marked images + texts and lasso-selected strokes separately).
- Multi-selection move / delete / copy is now possible across mixed kinds via marquee + `Shift+click` + `Cmd+A`. Single-object operations are unchanged.
- The polygon-select gesture is gone. Workaround: marquee + `Shift+click` to refine.

Code-facing:

- `apps/web/src/tools/lasso.ts` deleted.
- `apps/web/src/batchselection.ts` deleted (folded into `select.selected: Selection[]`).
- Single-object `selectXById` callers (paste-auto-select; legacy lasso → Select handoff) work unchanged — they now write `[{ kind, id }]` to the array.
- `main.ts` no longer routes `Cmd+A` through `batchSelection` or Lasso; it calls `select.selectAll()` which walks every kind and populates `selected[]`.
- `keymap.ts`: `S` activation routes to Select (was Lasso).

## Related ADRs

- **0014 Select tool: Selection discriminated union** — the foundation; updated in lockstep with this absorption to describe the array form and the multi-selection semantics.
- **0005 Tool abstraction** — the Tool interface that Select continues to implement; Lasso's slot is now vacant.
- **0006 Op-based undo** — the op pipeline that group drag + multi-delete emit into.
- **0011 Toolbar deferred** — the broader "less chrome, less cognitive load" tenet that this absorption serves at the tool-surface layer.
