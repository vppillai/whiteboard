# 0018. Shape data model

Date: 2026-05-14

## Status

Accepted.

## Context

v1.4 introduces vector primitives — rectangle, ellipse, line, arrow — as a fourth user-visible object kind, alongside strokes (M1), images (M1.5), and texts (v1.2). The user brief is small and concrete: "draw some shapes." The design surface, however, has several decisions whose downstream cost is non-trivial.

Open questions at the start:

1. **Tool model.** Four separate tools (Rect / Ellipse / Line / Arrow), or one Shape tool with a sub-mode picker?
2. **Transform encoding.** Lines and arrows are naturally two-endpoint, not rect-shaped. Do they get their own data shape, or share the BoardObject rect + rotation contract?
3. **Style model.** Independent stroke color, fill color, fill opacity, stroke width per shape — or fewer knobs?
4. **Stacking.** Where in the render z-order do shapes sit relative to strokes / images / texts?
5. **Hit-test discipline.** Per-kind geometry helper vs. dispatch-by-kind inside a single function?
6. **Selection / Select-tool integration.** Reuse the image/text plumbing (transform + rotation, 8 handles, rotation handle, multi-select), or build shape-specific affordances?

The user explicitly framed the v1.4 brief as **"no user-facing clutter"** — paramount tenet from the project's other guidance (snappy, sleek, user-friendly overrides feature wishes when they conflict). The data-model decisions follow from that framing.

## Decision

### 1. One `'shape'` tool, four sub-modes

A single Tool with `id: 'shape'` and a sticky `shapeKind: 'rect' | 'ellipse' | 'line' | 'arrow'`. The contextual menu has a 4-pill sub-mode row; keyboard R / O / A / L set the sub-mode AND activate the tool in one stroke (no separate activation key).

**Why not four tools.** Each separate tool would add an entry to the toolpill, the right-click TOOL row, the cycle order, and the keymap. The four shapes share 95% of their interaction code (drag-to-create, transform encode, commit op); only the in-flight render dispatches on kind. Four tools would mostly be four facades over one implementation, paying real UI cost (more chrome) for marginal mental-model benefit.

**Trade-off accepted.** Pen-style tools that don't share a sub-mode (Eraser, Laser, Select) keep their own ToolId. Shape is the only sub-mode-bearing tool; it's a deliberate one-off because the four shapes form a tight conceptual group.

### 2. Rect-based transform for all four kinds

Every `ShapeObject` extends `BoardObject` and stores its geometry as a `transform: { x, y, w, h }` rect plus an optional `rotation`. Lines and arrows encode their direction in the **sign of `w` / `h`** — endpoints are `(x, y)` → `(x+w, y+h)`. Negative `w` or `h` is valid and meaningful for line/arrow; rect/ellipse renderers normalize it before drawing.

**Why uniform with images / texts.** The Select tool's transform handles, rotation math, resize anchor preservation, AABB cull, marquee hit-test, and rotated outline rendering are all *already abstracted over `{ transform, rotation }`*. Reusing the rect contract for shapes meant the Select-tool integration cost dropped from "from-scratch geometry layer" to "add `'shape'` to the per-kind dispatch chains." See the PR diff in commit `2622de8` — the integration is mostly mechanical fan-out, plus one parameter to `applyResize` (`minSide`) so near-zero-h lines aren't clamped to 16 px.

**Why not endpoint-based for lines/arrows.** It would have read more naturally for those two kinds — `start: {x,y}, end: {x,y}` — but every shared transform consumer would have needed a per-kind dispatch. Rotation around a center, AABB inflation by stroke half-width, multi-drag translation, the marquee union, the resize anchor math — all uniform under rect, all forked under endpoint. The single uniformity cost (the sign-encoded direction trick) is one place; the abstraction violation would have lived in dozens.

### 3. Stroke color, stroke width, fill toggle, fill opacity — no separate fill color

Sticky settings: `shapeColor`, `shapeStrokeWidth`, `shapeFillEnabled`, `shapeFillOpacity`. When fill is enabled, `ShapeObject.fill` is set to the **same token** as the stroke color, and the renderer applies `shape.fillOpacity` (or a `DEFAULT_FILL_ALPHA = 0.25` fallback for older records that predate the per-shape opacity field) via `globalAlpha` during the fill pass. There is **no `shapeFillColor` setting** — fill color always tracks stroke color.

**Why one color, alpha for fill.** The user brief was explicit: "no user-facing clutter." A second color picker (stroke vs fill) doubles the menu footprint for a feature that, in informal observation of how users actually fill shapes in tldraw / Excalidraw, almost always picks "same color, lighter" anyway. Translucent fill behind a solid outline reads as a tint, keeps any pen ink underneath visible, and avoids the visual confusion of an opaque fill matching the stroke. If a future iteration adds a separate fill color it can land as an `else if (s.fillColor) ... else` branch in the renderer — the `fill: string` token already supports an arbitrary color, the renderer just doesn't expose the knob yet.

**Why a per-shape `fillOpacity` slider** (amended during v1.4 development). The initial ADR rejected a slider for clutter reasons. Two factors flipped that decision:

  1. **User request.** During v1.4 feel-testing the user explicitly asked for a fill-opacity selection bar with the original 0.25 as the default. The slider is small (one row in the contextual menu), and its disabled state for line/arrow keeps it out of the way when irrelevant.
  2. **Per-shape, not global.** Each new shape snapshots the sticky `shapeFillOpacity` at creation into `ShapeObject.fillOpacity`. Changing the slider later doesn't retroactively retint existing shapes. Selected-shape editing via the Select-tool's menu emits `edit-shape` ops, committing on slider `change` (pointerup) rather than per `input` event so a slow scrub produces ONE undoable / syncable op instead of N.

The slider is disabled for line / arrow sub-modes (no fill semantics) and when fill is toggled off (the value still persists, but won't visibly take effect).

### 4. Stacking: above texts, below strokes

The render order is `grid → images → texts → shapes → strokes composite`. Shapes paint on top of text but under the user's freehand pen ink.

**Why under strokes.** Strokes are the user's *annotation* layer in this app's mental model — pen ink should always be able to mark up any other object class. The image and text z-positions established the same convention (also under strokes). Continuing it for shapes keeps the mental model consistent.

**Why above texts.** Within the non-stroke layers, there's no single "right" answer, but shapes are vector regions that benefit from being on top of text labels (the common case: drawing a circle around a word). Putting shapes under text would have made annotation-style shape use (circle a word, underline with an arrow) impossible without manually reordering.

### 5. Hit-test geometry inline in `rendershapes.ts`

`pointInShape(p, shape, screenTol)` lives next to `shapeAABB` in `apps/web/src/rendershapes.ts`. Dispatch on `shape.kind`:

- **rect** — `pointInRotatedRect` after inverse-rotation around the center; outline-only kinds (no `fill` token) hit only near an edge within tolerance.
- **ellipse** — rotated-ellipse interior `(x/rx)² + (y/ry)² ≤ 1`; outline-only kinds hit when `|d² − 1|` is within a fraction-of-radius tolerance.
- **line / arrow** — distance from `p` to the segment from `(x, y)` to `(x+w, y+h)`, within `max(strokeWidth/2, screenTol)`.

**Why not a separate `shapegeom.ts` module.** It would have matched the `imagegeom.ts` / `textgeom.ts` pattern for symmetry. But shape geometry is fundamentally tied to how each kind renders (the outline-vs-fill hit-test distinction is a render-time concept; the arrow-head pad in `shapeAABB` only makes sense if you know how the head is drawn). Co-locating with the renderer keeps the cohesion that matters and saves a file. If a third consumer of shape geometry appears later, splitting is mechanical.

**Why `screenTol` is a caller-supplied parameter.** It's the Lasso/Select-style "10 px on screen, scaled by 1/zoom" tolerance. Pushing it into `pointInShape` would have required the helper to know the camera, which would entangle geometry with rendering. The Select tool computes it once per `objectAt` invocation; the geometry helper stays pure.

### 6. Op pipeline parallel to images / texts

Five new Op variants:

```ts
| { kind: 'create-shape';    shapeId: string }
| { kind: 'delete-shape';    shapeId: string }
| { kind: 'transform-shape'; shapeId: string; before: Transform; after: Transform }
| { kind: 'rotate-shape';    shapeId: string; before: number;    after: number }
| { kind: 'edit-shape';      shapeId: string; before: {...};      after: {...} }
```

`edit-shape` covers style fields (color / strokeWidth / fill); transform / rotate cover geometry. The split mirrors `transform-text` / `rotate-text` / `edit-text` — that prior decision was driven by the same forces (compact undo, clean op semantics, room for sync in M5), and there was no reason to deviate.

`TransformManyItem` (the M3 composite move op from ADR 0014) gains a `shape` variant; multi-drag emits one `transform-many` op covering every kind in the selection.

### 7. IDB v4 → v5

A new `shapes` object store, payload-inline (no companion blob like images). The upgrade is purely additive — `onupgradeneeded` creates the store inside an `if (!objectStoreNames.contains)` guard. Existing strokes / images / texts data is untouched.

During hardening of this branch, an unrelated quirk surfaced: the IDB upgrade could *block* silently if another tab held a v4 connection open. `req.onsuccess` and `req.onerror` were both wired, but `req.onblocked` was not — boot hung after attaching canvases with no console trace. Fix committed in `01a0a83`: an `onblocked` handler that rejects the open promise with a descriptive message so the load try/catch surfaces a `console.warn` rather than hanging boot.

### 8. Select-tool integration: 'shape' is a first-class Selection variant

`Selection` gains `{ kind: 'shape'; id: string }`. Every per-kind dispatch (selectSingleById, getView, objectAt, finalizeMarquee, selectAll, selectByIds, deleteSelected, startMultiDrag, tickMultiDrag, commitMultiDrag, the single-drag commit branch, rotation reset on rotate-handle double-click) extends with a shape branch. The dispatch chains read `image / text / shape / stroke` consistently.

The single-selection visual (`drawFloatingObjectSelection`) is **already kind-agnostic** — it takes `{ transform, rotation }` and paints an outline + 8 handles + rotation handle. Shape gets it for free. Multi-selection outline (`renderShapes` `isMultiSelected` predicate) was wired in SH4 ahead of the Select integration.

The Select tool's contextual menu picks up a `'shape'` branch — Color / Stroke width / Fill toggle, mirroring the Shape tool's own menu — so style edits work in either mode and emit `edit-shape` ops with proper before/after for undo.

### 9. Keymap rebinds for sub-mode shortcuts

R / O / A / L map to the four shape sub-modes (rect / ellipse / arrow / line). Each key both activates the Shape tool and sets the sub-mode in one stroke. Three single-key bindings displaced by these had to move:

| Was   | Action                | Now      |
| ----- | --------------------- | -------- |
| `C`   | toggleColor           | `Shift+C` |
| `O`   | toggleOptions         | `Shift+O` |
| `L`   | selectLaserTool       | `P`       |
| `P`   | selectPenDefault      | `Shift+P` |

The laser-to-P move (and pen-default to Shift+P) was the user's explicit pick when faced with the conflict cascade. The user is the source of authority for keymap decisions; we noted the muscle-memory cost and proceeded.

## Consequences

- **Adding a fifth shape kind is low-cost.** One entry in `ShapeKind`, one case in the renderer's draw dispatch, one case in `pointInShape`. Transform handling, hit-test scaffolding, selection integration, ops, clipboard, and exports all extend mechanically.
- **Sync (M5) inherits the op shape.** `create-shape` / `delete-shape` / `transform-shape` / `rotate-shape` / `edit-shape` map cleanly onto Y.Map mutations in the future Y.Doc world, parallel to how the text ops will. `transform-many` aggregates across kinds so a sync transaction is one wire message per peer regardless of selection cardinality.
- **No backwards-compat hazards.** Pre-v1.4 boards (no `shapes` store, no `shape` field in Selection) load and behave identically. Bundle parsing treats `shapes` as optional, so a v1.3 paste into a v1.4 board works.
- **`shapegeom.ts` deferred.** Geometry stays in `rendershapes.ts` for now. Promotion to a dedicated module is mechanical when a third consumer appears.
- **Fill color knob deferred.** The `ShapeObject.fill: string` field already supports an arbitrary color; only the UI surface and the renderer's alpha policy are paired to "fill = stroke color × FILL_ALPHA." Both can be relaxed without a data migration.
