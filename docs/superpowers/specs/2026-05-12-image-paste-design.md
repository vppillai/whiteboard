# Image Paste + Draw On Top — Design

**Status:** Approved (autonomously-implemented overnight).
**Date:** 2026-05-12.
**Author:** vppillai (design alignment); Claude (recon + drafting + implementation).
**Implementation branch:** `feat/image-paste`.

## Summary

Add a "paste an image onto the canvas, then draw strokes on top of it"
feature. The image is a **floating, movable object** with a dedicated
**Select tool** for move / resize / delete. Pen and Eraser tools treat
images as inert (drawing always goes on top, no per-frame hit-testing
overhead while drawing).

This is whiteboard's first non-stroke first-class object type. The
design deliberately introduces the minimum scaffolding (data model,
storage, render layer, ops, hit-test, handles) that future floating
objects (sticky notes, sub-canvas regions) can inherit.

## Motivation

Two concrete workflows the user named:

- **Markup a screenshot** — paste a screenshot of a UI / diagram /
  reference, then annotate over it with the pen.
- **Trace a sketch** — paste a photo of a hand sketch and ink-trace it
  cleanly on a layer above.

The "draw on top of it" framing is the user's exact words. Locked-
background was considered (~200 LOC) but rejected in favor of
floating-with-handles (~800-1200 LOC) because the user wants to
reposition / resize after paste, and the selection-and-transform
infrastructure pays back for future floating-object features.

## Non-goals (deferred)

These are deliberately **not in v1**. Each is a small follow-up if it
turns out to be missed:

- **Rotation handle.** Move + resize only. Adds a 9th handle + rotation
  math through render, hit-test, export.
- **Manual z-reorder.** v1 stacking = paste-order monotonic. "Bring to
  front" / "Send to back" comes if it's a pain point.
- **Multi-select.** Hit-test is reverse-z first-hit only. No
  cmd-click-multi, no marquee, no group transform.
- **Copy / cut / duplicate selected image.** Net-new ops; ship later.
- **Image filtering, opacity, brightness.** Out of scope.
- **Cross-client sync.** v1 is local-only (IndexedDB). M3 sync is
  deferred per ADR 0012; image-binary sync is M5.1.
- **SVG paste.** SVG can be passed as `<image>` href safely but has
  sandboxing concerns (foreign-fetched references, scripts). Skip for
  v1.

## Architecture

### 1. Data model — `packages/shared/src/types.ts`

```ts
export type ImageObject = {
  id: string                  // ulid (same id format strokes use)
  blobRef: string             // = id; key into the images-blob IDB store
  format: 'png' | 'jpeg' | 'webp' | 'gif'
  natural: { w: number; h: number }      // original pixel dims
  transform: { x: number; y: number; w: number; h: number }
                              // canvas-space rect; (x, y) is top-left
  z: number                   // stacking order; paste-time monotone
  createdAt: number           // ms wall-clock; tie-break + debug
  deleted?: boolean           // soft-delete (matches Stroke pattern)
}
```

`blobRef === id` for v1 — distinct field is forward-compat for a future
where the binary lives on a server (sync) or in a content-addressed
store (dedupe).

### 2. Storage — `apps/web/src/storage.ts`

Bump the IndexedDB schema by adding two object stores in the same
database used by strokes:

| Store         | Keyed on   | Stores             | Why split             |
|---------------|------------|--------------------|-----------------------|
| `images`      | `id`       | `ImageObject`      | Cheap to scan in frame |
| `images-blob` | `blobRef`  | raw `Blob`         | Pageable bytes        |

The two-store split keeps the metadata store cheap to scan (the render
loop reads it every frame) and the heavy bytes pageable independently.

`ImageStore` interface in a new `apps/web/src/imagestore.ts` mirroring
`StrokeStore`'s shape — same async-cache-with-IDB pattern, same sync
seam. In-memory cache keeps `HTMLImageElement` per `blobRef` so render
is `ctx.drawImage(imgEl, …)` without paying URL.createObjectURL on
every frame.

### 3. Render pipeline — `apps/web/src/render.ts` + `main.ts`

Existing frame loop (committed = grid + strokes composite; live = cursors).
New layer slots in between grid and strokes composite:

```
Pass 1: per-stroke render onto strokes-offscreen (existing)
Pass 2 (NEW): per-image render onto images-offscreen, sorted by z
Pass 3: composite to committed = grid + images + strokes  ← order matters
Pass 4: live cursors (existing)
```

Images render **below strokes** so drawing on top is naturally correct.

The images-offscreen layer is invalidated when:
- An image is added, transformed, or deleted (full repaint of that layer).
- The viewport bounds change (only the visible images repaint).

For v1, a simpler "always repaint all images per frame" is acceptable
(typical scenes will have ≤ 5 images, each `drawImage` is fast).
Incremental dirty-rect can come later if profiling shows a problem.

### 4. UX — Paste flow

Three entry points, all flowing through one `PasteImage` op so undo is
identical regardless of input source:

| Trigger | Where wired | Data source |
|---|---|---|
| `Ctrl/Cmd+V` | `keymap.ts` | `navigator.clipboard.read()` ItemList |
| Right-click → "Paste image" | `toolmenu.ts` | Same clipboard read |
| Drag-drop image file onto canvas | new `dragover`+`drop` listener on canvas el in `main.ts` | `e.dataTransfer.files[0]` or `e.dataTransfer.items` |

**Validation chain (shared)** for every input source:
1. Read MIME type.
2. Reject if not in {`image/png`, `image/jpeg`, `image/webp`, `image/gif`}.
3. Reject if Blob size > **25 MB** (toast: "Image too large; under 25 MB please").
4. Read `naturalWidth` / `naturalHeight` via a temporary `HTMLImageElement`.
5. Emit `PasteImage` op with `id`, `blobRef` (= id), `format`, `natural`,
   `transform: { x: cursorX, y: cursorY, w: natural.w, h: natural.h }`,
   `z: nextZ()`, `createdAt: Date.now()`.

**Position:** top-left of the image lands at the cursor position at the
moment of paste / drop. **No auto-scaling** — natural pixel size. (User-
selected option; rejects fit-to-viewport in favor of predictability.)

### 5. UX — Select tool

New entry in `apps/web/src/tools/` (a `SelectTool`) and a toolbar entry.
Tool keybind: **`s`** (verified free in `keymap.ts` before commit).

While Select is active:

- **Hover** an image body → cursor changes to `move`.
- **Hover** a handle → cursor changes to the appropriate `nesw-resize`
  / `nwse-resize` / `ns-resize` / `ew-resize`.
- **Click** an image (reverse-z first-hit) → that image becomes selected.
  Outline + 8 handles render on top.
- **Click empty space** → deselect.
- **Drag** image body → translate (single `TransformImage` op coalesced
  at drag-end).
- **Drag** a corner handle → resize from anchor (opposite corner).
  Hold **`Shift`** to constrain aspect ratio.
- **Drag** an edge handle → 1-axis resize.
- **Delete** or **Backspace** → soft-delete (with undo).

While **any other tool** is active: images are completely inert.
Drawing tools (pen, eraser) treat them as if they weren't there — no
hit-testing, no handle render, no selection state survives. The
selected-image state is held by the SelectTool and discarded on tool
switch.

### 6. Selection visual

Per user-confirmed choice — **thin outline + corner handles only**:

- 1-px outline in the existing UI accent color (whiteboard's primary
  toolbar tint), drawn on the live layer (not in the committed canvas
  — so it doesn't appear in exports).
- 8 small filled squares (4 corners, 4 edge midpoints), ~8 px on
  screen, in the same accent color with a 1-px white outer ring for
  contrast against dark images.
- No drop-shadow / glow on the image itself.
- The outline + handles render at constant **pixel** size regardless of
  canvas zoom (so they don't disappear when zoomed out).

### 7. Op-based undo — `apps/web/src/ops.ts`

Three new op kinds, in addition to the existing stroke ops:

```ts
type PasteImageOp = { kind: 'paste-image';
                      image: ImageObject; blob: Blob }
type TransformImageOp = { kind: 'transform-image';
                          imageId: string;
                          before: ImageObject['transform'];
                          after:  ImageObject['transform'] }
type DeleteImageOp = { kind: 'delete-image';
                       imageId: string }
```

- `paste-image` undo: soft-delete the image. Redo: un-delete (it's
  already in the blob store, so no re-decode).
- `transform-image` undo: revert to `before`. Redo: re-apply `after`.
  **Coalesced**: one op per drag, not per pointermove tick — committed
  at `pointerup`.
- `delete-image` is symmetric to `paste-image`.

Move and resize are the **same op kind** with different deltas — both
ultimately swap `transform`.

### 8. Export — `apps/web/src/export/`

Three export paths must include images, in z-order, **below** strokes:

- **PNG** (`png.ts`): in the pass that draws onto the detached canvas,
  add an `images` loop before the strokes loop. Each image is drawn
  via `ctx.drawImage(imgEl, x, y, w, h)` — same as on-screen render.
- **SVG** (`svg.ts`): emit `<image href="data:image/<format>;base64,…" x=… y=… width=… height=…>` elements **before** the existing `<path>` elements. Encode the blob to base64 inline (acceptable for a snapshot export).
- **PDF** (`pdf.ts`): no change required — PDF wraps the rasterized PNG, so the new PNG content already contains the images.

### 9. Acceptance checklist (manual smoke after build is green)

Tomorrow's smoke test, in order:

- [ ] `bun install` is clean (no warnings about new deps).
- [ ] `bun test` runs all suites green.
- [ ] `bun run --filter @whiteboard/web build` succeeds.
- [ ] `bun dev` (or hub-mounted): canvas loads, no console errors.
- [ ] Pick Pen tool. Draw a stroke. Looks normal.
- [ ] Press `s` → Select tool active.
- [ ] Copy an image to clipboard (e.g., screenshot). `Ctrl+V` on canvas.
- [ ] Image appears at cursor position, natural pixel size. Drawn
      below the pen stroke from step 5.
- [ ] Click image body → handles appear. Drag body → image moves.
- [ ] Drag corner handle → resize. Hold Shift → proportional resize.
- [ ] Drag edge handle → 1-axis resize.
- [ ] Press `p` → Pen tool. Draw a stroke across the image. Stroke
      renders on top.
- [ ] Press `s` again → image is still selected. Press Delete → image
      removed.
- [ ] `Ctrl+Z` → image restored. Stroke too (it was a separate op).
- [ ] `Ctrl+Z` again → undo prior stroke.
- [ ] Reload the page → strokes + images persist (IDB).
- [ ] Drag an image file from filesystem onto the canvas → drop works.
- [ ] Right-click → context menu has "Paste image" → that path also
      works.
- [ ] Export PNG → image is in the output, below strokes.
- [ ] Export SVG → image is in the output (open in browser, check the
      `<image>` element).
- [ ] Export PDF → image is in the output.

## Sequencing (one PR, three commits)

| # | Commit | Adds | Independent build/test check |
|---|---|---|---|
| A | `feat(image): foundation` | `ImageObject` schema; IDB stores; `ImageStore`; render integration; dev-only seeded test image | Seeded image renders below strokes; reload preserves it |
| B | `feat(image): paste flow` | Ctrl+V, right-click, drag-drop, ops, undo; remove seeded test image | Paste a real image; refresh; undo/redo paste & delete |
| C | `feat(image): Select tool` | Toolbar entry, hit-test, handles, transform, export updates | Move/resize works; exports include images |

After commit C: open the PR with the smoke-test checklist (section 9)
in the body so it's easy to walk through.

## Self-review (placeholders / contradictions / scope)

- **Placeholders:** none. All identifiers, file paths, types are
  named.
- **Contradictions:** none. Layer ordering, op coalescing, and tool-
  inertness are consistent across sections 3, 5, and 7.
- **Ambiguities resolved:**
  - "Paste position" — section 4 explicitly says top-left of image at
    cursor (not centered, not fit-to-viewport). Matches the user's
    pick.
  - "What happens when a stroke is drawn through a selected image" —
    section 5 says strokes only render when a non-Select tool is
    active; the moment you press a stroke key, the selection is
    discarded (held by the tool, not by the store). So the answer is:
    you can't draw a stroke while in Select mode. To draw on top, you
    switch back to Pen. The image stays put.
  - "Z-order with overlapping pastes" — section 1 has `z: nextZ()`
    paste-time monotonic. Section 5 uses reverse-z first-hit. So the
    most recently pasted image is on top and selected first when they
    overlap.
- **Scope:** intentionally bounded. Each "Non-goal" item is a candidate
  for a focused follow-up PR if it turns out to be wanted.

## Implementation notes (Claude reading this in a fresh session)

- Work happens on the `feat/image-paste` branch off `main`.
- The 3 commits (A, B, C) in section "Sequencing" should land in
  order, each independently buildable. Push as each commit lands so
  the user can watch progress overnight.
- After commit C: `bun test`, `bun run --filter @whiteboard/web build`,
  push, open PR. Title: `feat(image): paste, draw on top, Select tool`.
  PR body: include section 9 (smoke-test checklist) verbatim.
- Existing tests must stay green (`apps/web/src/export/bounds.test.ts`,
  `apps/web/src/export/svg.test.ts`). Add tests for `ImageStore` (basic
  CRUD), hit-test math (point-in-rect, point-on-handle), and
  export-with-image (SVG `<image>` is emitted; PNG composite includes
  the image bytes).
- The user's saved preferences that apply:
  - "Snappy, sleek, user-friendly is the paramount tenet" — keep the
    selection visual minimal, keep the per-frame render cheap.
  - "Docs describe current state, not changelog history" — don't put
    "v1 adds X" phrasing in README. The CHANGELOG entry is fine to
    version-stamp.
  - "Iterate on architecture, not arithmetic" — if a feel-issue
    surfaces twice, re-examine the abstraction. (The recon-driven
    decision to use a separate `Image` store rather than extend
    `Stroke` is exactly that.)
