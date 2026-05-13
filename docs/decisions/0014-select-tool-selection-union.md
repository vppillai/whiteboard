# 0014. Select tool: discriminated-union `Selection` instead of per-kind tool

Date: 2026-05-13

## Status

Accepted. Ships as part of v1.2 with the Select tool's extension to handle text objects alongside images.

## Context

v1.1 had a Select tool that was strictly image-focused: a `selectedImageId: string | null` field, an `imageAt` hit-test that walked the images array, handle math that read `img.transform` directly, and op emission that hard-coded `transform-image` / `delete-image` / `rotate-image`.

v1.2 introduces TextObject as a first-class non-stroke object. The user expectation (per the Figma / Excalidraw convention) is that the Select tool — the arrow / pointer tool — handles ALL non-stroke objects uniformly: move, resize, rotate, delete. Two implementation strategies were considered for extending the Select tool:

1. **Discriminated union + uniform view abstraction** — `Selection = { kind: 'image'; id } | { kind: 'text'; id }`; an `ObjectView` interface that exposes `{ transform, rotation }` for whatever's selected; per-kind branching for kind-specific behavior (image resize math vs text font-size scaling, op-kind emission, delete dispatch).
2. **Per-kind behavior objects (polymorphism)** — an `ObjectBehavior<T>` interface (applyMove, applyResize, applyRotate, makeTransformOp, makeRotateOp, makeDeleteOp, save); the Select tool looks up the behavior at selection-time and dispatches without ever branching on kind.

Both are well-understood patterns. Approach 1 is the conventional choice for two-or-three-variant unions in TypeScript codebases; approach 2 generalizes better as the number of variants grows but adds indirection.

## Decision

**Adopt the discriminated-union + uniform view pattern.** Concretely:

1. `Selection = { kind: 'image'; id: string } | { kind: 'text'; id: string }`. The previously-image-only `selectedImageId` becomes `selected: Selection | null`.
2. `ObjectView { selection, obj, transform, rotation }` is the live view used by handle math, hover-cursor decisions, render, and drag-state initialization. A `getView()` helper resolves the discriminated union to the live underlying object (`ImageObject | TextObject`) with `transform` and `rotation ?? 0` exposed uniformly. Soft-deleted objects return null so stale selections fail closed.
3. Hit-test (`objectAt`) walks texts first (texts render above images per the per-frame render passes), then images. Reverse-z within each kind so paste-time-latest wins. Returns a `Selection`.
4. Handle-position math (`handlePositions`, `rotationHandlePos`, `handleAt`) takes `(transform, rotation)` directly — not an `ImageObject`. Same code path serves both kinds.
5. Per-kind specifics branch in three sites:
   - **Resize semantics**: image gets the existing anchor-preserving rect math (`applyResize`); text corner-drag scales font.size (`applyTextResize` + `resizeToFit`); text E/W edge-drag adjusts `wrapWidth`.
   - **Op emission** (`commitDrag`): branches on `view.selection.kind` to push `transform-image` vs `transform-text`, `rotate-image` vs `rotate-text`, etc.
   - **Delete** (`deleteSelected`): branches on `selection.kind` to dispatch `delete-image` or `delete-text` op + the matching save callback.
6. Handle availability differs by kind: images expose all 8 (4 corners + 4 edges); texts expose 4 corners (font-size scale) + 2 horizontal edges (`e`, `w`) for wrap-width adjustment. The N/S edges are hidden for text because vertical edge drags don't have a sensible content-derived-height semantic.

## Consequences

**Acceptable:**

- The Select tool stays a single file (~1175 LOC). Same person can read move + rotate + resize + delete + contextual-menu logic without jumping between behavior modules.
- Adding a third object type (e.g. a "shape" rectangle / ellipse) extends the `Selection` union by one variant, adds one branch arm to each of the three kind-specific sites, and adds one entry to the `objectAt` walk. Mechanical, grep-able, no surprises.
- TypeScript's exhaustiveness check on `selection.kind` switches gives strong compile-time pressure to handle every kind in every site. Forgotten branches surface as type errors, not runtime bugs.
- The per-kind branching is concentrated in `commitDrag` (~50 LOC), `deleteSelected` (~25 LOC), `onPointerMove` resize branch (~50 LOC), and `onPointerDown` (~20 LOC) — total ~145 LOC of kind-aware code in a 1175-LOC file. Manageable for two kinds; will grow linearly with future kinds.

**Costs:**

- Adding a fourth or fifth object type would push the kind-aware code past 300 LOC, at which point the polymorphism alternative (approach 2) becomes more attractive. See *Migration trigger* below.
- The `getView()` helper allocates a new object on every call (currently called from `onPointerMove`, `redraw`, `commitDrag`, `updateHoverCursor`). For a 60Hz drag this is ~5 allocations per frame — negligible at v1.2 but worth watching if profiling flags it.
- `DragState` carries `beforeFontSize: number | null` and `beforeTextSnapshot: {...} | null` fields that are populated only for text-resize drags. Image drags carry the null payloads. The nulls are an explicit "this field is text-only" signal but require null-checks at use sites.

## Considered alternatives

### ObjectBehavior polymorphism

Rejected for v1.2. The Select tool's flat single-file readability is a project tenet (matches the "prefer flat over clever" preference reflected in the rest of the codebase). Behavior-object polymorphism would split the resize math, op emission, and delete dispatch into per-kind modules linked through an interface table. That's a better fit at 4+ kinds; it's premature optimization at 2.

### Image-tool + Text-tool, no unified Select

Rejected as a worse UX. Forcing users to remember "to manipulate an image, press V; to manipulate text, also press V but the tool is different" violates the "snappy, sleek, user-friendly" tenet. The Select tool is the universal "arrow / pointer" surface.

## Migration trigger

Re-open this decision and adopt the `ObjectBehavior<T>` polymorphism pattern when one of these is true:

- A third object type (shapes) is being added, AND the kind-aware code in select.ts exceeds 300 LOC.
- Static analysis flags `getView()` allocation as a hot-path concern.
- A code-review pass identifies a bug caused by a missed branch in one of the three kind-aware sites (i.e., the exhaustiveness checks aren't catching everything).

Until then, the discriminated union is the right structural choice.

## Related ADRs

- **0005 Tool abstraction**: the Tool interface that Select implements
- **0006 Op-based undo**: the op pipeline that Select emits into
- **0007 Tool surface**: contextual menu pattern that Select's text-format menu uses
- **0010 Settings data model**: where sticky text-tool defaults live (textFont, textSize, etc.)
