# 0014. Select tool: discriminated-union `Selection` instead of per-kind tool

Date: 2026-05-13

## Status

Accepted. Ships as part of v1.2 with the Select tool's extension to handle text objects alongside images. **Updated 2026-05-13 (post-v1.2)** — the Select tool absorbs the Lasso tool's role; the Selection type becomes an *array* (`Selection[]`) carrying single-object handle-driven selection AND multi-object move/delete selection in the same data model. See also [ADR 0016](0016-lasso-into-select-absorption.md) for the cross-cutting design decision.

## Context

v1.1 had a Select tool that was strictly image-focused: a `selectedImageId: string | null` field, an `imageAt` hit-test that walked the images array, handle math that read `img.transform` directly, and op emission that hard-coded `transform-image` / `delete-image` / `rotate-image`.

v1.2 introduced TextObject as a first-class non-stroke object. The user expectation (per the Figma / Excalidraw convention) is that the Select tool — the arrow / pointer tool — handles ALL board objects uniformly when manipulation is needed: move, resize, rotate, delete. Two implementation strategies were considered for extending the Select tool:

1. **Discriminated union + uniform view abstraction** — `Selection = { kind: 'image'; id } | { kind: 'text'; id } | { kind: 'stroke'; id }`; an `ObjectView` interface that exposes `{ transform, rotation }` for whatever's selected; per-kind branching for kind-specific behavior (image resize math vs text font-size scaling vs stroke move-only, op-kind emission, delete dispatch).
2. **Per-kind behavior objects (polymorphism)** — an `ObjectBehavior<T>` interface (applyMove, applyResize, applyRotate, makeTransformOp, makeRotateOp, makeDeleteOp, save); the Select tool looks up the behavior at selection-time and dispatches without ever branching on kind.

Both are well-understood patterns. Approach 1 is the conventional choice for two-or-three-variant unions in TypeScript codebases; approach 2 generalizes better as the number of variants grows but adds indirection.

Post-v1.2, the Lasso tool was absorbed into Select (see [ADR 0016](0016-lasso-into-select-absorption.md)). The same selection data model that handled image + text + single-stroke selection needed to grow to cover multi-object selection (multi-stroke, but also multi-image and multi-text and *mixed* kinds in one selection), marquee-drag entry, and the Cmd+A "select all non-deleted objects" entry. The question: extend the existing discriminated-union shape, or rebuild?

## Decision

**Adopt the discriminated-union + uniform view pattern, in array form.** Concretely (post-v1.2 state):

1. `Selection = { kind: 'image'; id: string } | { kind: 'text'; id: string } | { kind: 'stroke'; id: string }`. The Select tool's selection state is `Selection[]` — an array, not a single nullable. Single-selection is `selected.length === 1`; multi-selection is `> 1`; nothing selected is `[]`. The stroke variant was added in v1.2 post-release as a small extension; the array form was added immediately after as part of the Lasso absorption.
2. **Single vs multi semantics differ** at the per-kind sites:
   - **Single-selection** drives the full handle UI — image resize handles, text font-size + wrap-width handles, rotation handle, contextual menus on right-click. Same code path as before the array.
   - **Multi-selection** is move + delete only. A dashed bbox encloses the group (union of per-object AABBs); pointer-down inside any selected object initiates a group drag; `Delete` removes every selected object across kinds; handles are not drawn (no shared "resize a heterogeneous group" semantic).
3. **Marquee drag** is the gestural multi-select entry. Pointer-down on empty canvas → `marqueeState` tracks the rect; `pointermove` updates and re-renders; `pointerup` walks every non-deleted object (strokes via sample-in-rect, floating objects via AABB intersection) and replaces (or — with `Shift` held — extends) the selection. `Shift+click` on an individual object toggles it in/out of the current selection.
4. **`Cmd/Ctrl+A`** activates the Select tool (if not already active) and selects every non-deleted object across all three kinds. The previous `Cmd+A` paths — `batchSelection` for images + texts, Lasso for strokes — collapse into a single Select-tool `selectAll()`.
5. `ObjectView { selection, obj, transform, rotation }` is the live view used by handle math, hover-cursor decisions, render, and drag-state initialization. A `getView()` helper resolves a single `Selection` to the live underlying object (`ImageObject | TextObject` — and a synthetic transform-derived view for strokes) with `transform` and `rotation ?? 0` exposed uniformly. Soft-deleted objects return null so stale selections fail closed.
6. Hit-test (`objectAt`) walks texts first, then images (texts render above images per the per-frame render passes), then strokes (fallback when no floating object is hit). Reverse-z within each kind so paste-time-latest wins. Returns a `Selection`.
7. Handle-position math (`handlePositions`, `rotationHandlePos`, `handleAt`) takes `(transform, rotation)` directly — not an `ImageObject`. Same code path serves the kinds that have handles. Only runs for single-selection.
8. Per-kind specifics branch in three sites (unchanged in shape from the v1.2 design — just iterated over the array for multi-selection):
   - **Resize semantics**: image gets the existing anchor-preserving rect math (`applyResize`); text corner-drag scales font.size (`applyTextResize` + `resizeToFit`); text E/W edge-drag adjusts `wrapWidth`. Strokes contribute nothing here — no resize. Resize is single-selection only.
   - **Op emission** (`commitDrag`): per-kind helpers — `commitImageDrag` / `commitTextDrag` / `commitStrokeDrag` — push `transform-image` / `transform-text` / `move` respectively (plus `rotate-*` for the two rotatable kinds). For group drag, `commitDrag` walks the selection and dispatches per-kind.
   - **Delete** (`deleteSelected`): walks the selection and dispatches `delete-image` / `delete-text` / `delete` (stroke soft-delete) + the matching save callback per item.
9. Handle availability differs by kind: images expose all 8 (4 corners + 4 edges); texts expose 4 corners (font-size scale) + 2 horizontal edges (`e`, `w`) for wrap-width adjustment; strokes expose none (move-only via body drag, plus a dashed bbox for affordance). The N/S edges are hidden for text because vertical edge drags don't have a sensible content-derived-height semantic.
10. **`batchSelection` module deleted.** Its Cmd+A → Delete mark for images + texts is no longer needed — the Select tool's multi-selection state covers that role, plus strokes.

## Consequences

**Acceptable:**

- The Select tool stays a single file (~2030 LOC as of the post-v1.2 absorption — see `wc -l apps/web/src/tools/select.ts`). Same person can read move + rotate + resize + delete + multi-select + marquee + contextual-menu logic without jumping between behavior modules. The v1.2 review pass and the post-v1.2 Lasso absorption both intentionally lengthened the file by extracting per-kind dispatch helpers (`commitImageDrag` / `commitStrokeDrag` / `commitTextDrag`; `drawStrokeSelection` / `drawFloatingObjectSelection`) — each gets its own docblock, which adds line count, but reduces the *density* of `switch (selection.kind)` at the call sites and gives each kind a named home for its commit / render logic.
- Adding a third object type (the stroke variant added in v1.2 post-release) followed exactly that pattern: one extra branch arm in `objectAt`, one stroke-specific commit helper, one stroke-specific render helper, one branch arm in `deleteSelected`. Mechanical, grep-able, no surprises. Going from a single-Selection to a `Selection[]` was a similarly local edit — the array iteration happens at the same dispatch sites.
- TypeScript's exhaustiveness check on `selection.kind` switches gives strong compile-time pressure to handle every kind in every site. Forgotten branches surface as type errors, not runtime bugs.
- The per-kind branching is concentrated in `commitDrag` (a 3-way dispatcher to per-kind helpers, iterated over the array for groups), `deleteSelected`, the `onPointerMove` resize branch, and `onPointerDown`. Total kind-aware code remains the dominant share of the file's growth, but the *dispatch-helper pattern* is the chosen incremental migration step before any full vtable refactor — see *Migration trigger* below.
- One selection state across the app. The previous `lasso.selectedIds` + `batchSelection.marked` + `select.selected` triad collapses to a single `select.selected: Selection[]`.

**Costs:**

- Adding a fourth or fifth object type with non-trivial behavior would push the kind-aware code past the 300 LOC threshold, at which point the polymorphism alternative (approach 2) becomes more attractive. See *Migration trigger* below.
- The `getView()` helper allocates a new object on every call (currently called from `onPointerMove`, `redraw`, `commitDrag`, `updateHoverCursor`). For a 60Hz drag this is ~5 allocations per frame per single-selection; multi-selection adds linear overhead. Negligible at v1.3 selection sizes but worth watching if profiling flags it.
- `DragState` carries `beforeFontSize: number | null` and `beforeTextSnapshot: {...} | null` fields that are populated only for text-resize drags. Image and stroke drags carry the null payloads. The nulls are an explicit "this field is text-only" signal but require null-checks at use sites.
- Multi-selection on `Cmd+A` for a board with thousands of objects allocates one `Selection` record per object. Linear cost; not measured to be hot.

## Considered alternatives

### ObjectBehavior polymorphism

Rejected for v1.2 and again for the post-v1.2 Lasso absorption. The Select tool's flat single-file readability is a project tenet (matches the "prefer flat over clever" preference reflected in the rest of the codebase). Behavior-object polymorphism would split the resize math, op emission, and delete dispatch into per-kind modules linked through an interface table. That's a better fit at 4+ kinds; it's premature optimization at 3.

### Image-tool + Text-tool, no unified Select

Rejected as a worse UX. Forcing users to remember "to manipulate an image, press V; to manipulate text, also press V but the tool is different" violates the "snappy, sleek, user-friendly" tenet. The Select tool is the universal "arrow / pointer" surface.

### Keep Lasso as a separate tool for strokes

Rejected during the Lasso absorption. Maintaining two selection tools — Select for floating objects, Lasso for strokes — meant two selection states, two Cmd+A behaviors, two delete paths, and two answers to the user-facing question "how do I move this thing?". One tool, one selection state, one mental model. See [ADR 0016](0016-lasso-into-select-absorption.md) for the full Lasso-absorption rationale.

## Migration trigger

Re-open this decision and adopt the `ObjectBehavior<T>` polymorphism pattern when one of these is true:

- A FOURTH object type (e.g. shapes — rectangle / ellipse) is being added, AND the kind-aware code in `select.ts` exceeds 300 LOC. The stroke variant added in v1.2 post-release does NOT satisfy this trigger: strokes contribute minimal kind-aware code (no handles, no rotation, no resize — only one commit helper and one render helper), so the per-kind-dispatch shape still scales.
- Static analysis flags `getView()` allocation as a hot-path concern.
- A code-review pass identifies a bug caused by a missed branch in one of the three kind-aware sites (i.e., the exhaustiveness checks aren't catching everything).

**Note on the Lasso absorption.** The post-v1.2 Lasso → Select absorption was a DIFFERENT trigger entirely — not the "LOC threshold + 4th kind" migration trigger above. The triggers there were: a single selection model across the app (user-facing question "does Lasso still make sense?"), the multi-select demand that fell out of marquee + Shift+click + Cmd+A unification, and the Path B decision recorded in [ADR 0016](0016-lasso-into-select-absorption.md). The per-kind dispatch helpers (no vtable) handled the absorption cleanly. The LOC trigger above is still not met — the file is at ~2030 LOC but kind-aware code is well under 300, and the stroke variant adds minimal density.

The per-kind dispatch helpers (`commitImageDrag` / `commitStrokeDrag` / `commitTextDrag`, `drawStrokeSelection` / `drawFloatingObjectSelection`) extracted in the v1.2 review pass are the intermediate step — they keep the discriminated union but localize the per-kind logic into named functions. If the migration trigger above is hit, those helpers are the obvious unit to lift into an `ObjectBehavior<T>` interface table.

## Related ADRs

- **0005 Tool abstraction**: the Tool interface that Select implements
- **0006 Op-based undo**: the op pipeline that Select emits into
- **0007 Tool surface**: contextual menu pattern that Select's text-format menu uses
- **0010 Settings data model**: where sticky text-tool defaults live (textFont, textSize, etc.)
- **0016 Lasso → Select absorption**: the post-v1.2 cross-cutting design decision that drove `Selection[]` + marquee + Shift+click in this file
