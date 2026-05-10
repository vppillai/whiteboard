# 0009. Eraser is a per-stroke pixel mask, not a sample mask

Date: 2026-05-09

## Status

Accepted. Supersedes [ADR 0008](0008-segment-eraser.md). Implemented in M1.

## Context

ADR 0008 introduced segment-level erasure via a per-sample mask (`Stroke.erasedSamples: number[]`). Renderer broke each stroke into contiguous live-sample runs and rasterized each run as its own perfect-freehand outline.

Through feel-test on Wacom Intuos, the user reported, repeatedly, that erasure removed **more than what the visual eraser circle touched**. Four iterations of tolerance tuning didn't fix it:

1. `tol = r + brush.size/2` (visual-overlap) — original.
2. `tol = r` (sample-center inside cursor) — still too aggressive.
3. `tol = r − brush.size/2` (cursor fully covers ink at sample) — still too aggressive.
4. Removed swept-segment chain and brush-size padding — still too aggressive.

The reason it can't be fixed with arithmetic: **erasing a sample removes the sample's entire visual ink contribution**, which is `brush.size` wide regardless of how much of that ink was actually under the cursor. Worse, perfect-freehand recomputes the outline at run boundaries — the run's new end-cap can shift visibly *away from* where the sample was, making it look like more was removed than the cursor footprint should imply.

This is fundamental to the sample-based representation. To get pixel-precise erasure with vector strokes, we have to erase **pixels**, not samples.

## Decision

Each stroke carries a list of **erase stamps** (cursor-disk records):

```ts
interface Stroke {
  // ... existing fields ...
  /**
   * Cursor-disk stamps that erase pixels from this stroke at render time.
   * Each `{ x, y, r }` is one cursor position recorded during a wipe sweep
   * (board coords, board-pixel radius). Sparse — omitted / empty when the
   * stroke has not been segment-erased.
   *
   * Semantically a per-stroke pixel mask: the renderer draws the stroke
   * outline normally and then applies `globalCompositeOperation =
   * 'destination-out'` for each stamp, subtracting that disk's pixels
   * from the rendered ink.
   */
  erasedStamps?: { x: number; y: number; r: number }[]
}
```

Renderer:

1. Strokes draw to a **dedicated offscreen canvas** sized to the viewport.
2. After all strokes are drawn, `globalCompositeOperation = 'destination-out'` is set and each stamp is filled as a disk on the offscreen.
3. The offscreen is composited (source-over) onto the committed canvas, **on top of the grid**. The grid is never touched by destination-out because it lives on a different canvas (target.committed) than the strokes (target.strokes).

Op model:

```ts
type Op = ... | {
  kind: 'eraseStamps'
  edits: Array<{ strokeId: string; addedStamps: { x, y, r }[] }>
}
```

`apply` appends to each affected stroke's `erasedStamps`; `unapply` removes the same stamps (by reference equality on the position+radius tuple). Idempotent within a sweep — re-emitting the same sweep is a no-op visually because pixel-mask is set-semantic, not order-dependent.

Eraser tool:

- During a sweep, each pointer event (and each `getCoalescedEvents()` sub-frame sample) records one stamp `{ x: cx, y: cy, r: eraserRadius }`.
- For each stamp, find every stroke whose bbox + brush.size/2 + stamp.r intersects the stamp footprint (cheap AABB check).
- Append the stamp to each affected stroke's `erasedStamps` (live mutation, so the next frame redraws with the cut visible).
- At pointerup, emit one `eraseStamps` op carrying the per-stroke addedStamps lists.

## Considered alternatives

### Per-sample mask (ADR 0008, rejected after 4 iterations)

See above. Fundamentally cannot pixel-precision erase with sample-based representation.

### Global pixel mask (rejected in ADR 0008, still rejected)

A single canvas-wide raster of erased pixels. Vector strokes survive theme changes / pan / zoom because they re-rasterize; pixel masks don't, so a global raster mask would visually drift when the camera moves. **Per-stroke** stamps in board coords avoid this — the stamps re-rasterize alongside the stroke geometry on every camera change, just as the strokes do. ADR 0008 conflated "pixel mask" with "global pixel raster"; this ADR distinguishes them.

### Split-stroke (rejected)

When the eraser overlaps a stroke, soft-delete the original and create N new strokes from the surviving fragments. Heavier, more CRDT churn, identity-loss for the original stroke, and *still* sample-precise rather than pixel-precise — same fundamental problem. See ADR 0008's own rejection.

### Sub-sample resolution (rejected)

Mark stroke segments as cut at fractional sample indices. Renderer would render fractional segments. Mathematically clean but a large change to the perfect-freehand integration; pixel-mask achieves the same visual at far lower complexity.

## Consequences

**Easier.**

- The eraser does what the user expects it to do. Tenet alignment, not nice-to-have.
- The `erasedStamps` array is just data — serializes trivially to IndexedDB, easy to merge under CRDT (set-union semantics).
- Stroke rendering is back to one outline per stroke. The runs / per-run cache from ADR 0008 is gone — simpler render loop, smaller stroke.ts.
- Theme changes / pan / zoom Just Work — stamps are in board coords, the offscreen redraws with the camera transform, the grid is isolated on a separate canvas.

**Harder.**

- Per-frame overhead: clearing the offscreen, drawing all strokes to it, applying N destination-out fills, drawImage onto committed. `drawImage` of a viewport-sized buffer is ~1 ms; destination-out fills are cheap. At hundreds of strokes and thousands of stamps, total stays well within a 16 ms frame budget.
- An additional canvas. `RenderTarget` gains `strokes: CanvasLayer`. Same DPR scaling applies; resize hook wires it alongside committed and live.

**Risks.**

- Memory: stamps are 24 bytes × stamps-per-stroke. A long sweep through a stroke records ~100–300 stamps depending on cursor speed and event rate. At hundreds of strokes wiped, total memory is in the MB range — reasonable but watchable.
- Stamp dedup: heavy overlap (200 Hz cursor moving slowly) produces many near-identical stamps. Idle dedup (collapse stamps within <1 px and same radius into one) is a future optimization if memory or render cost surface.
- A fully-covered stroke is not auto-deleted; it just renders empty. Future cleanup pass can promote `stamps fully cover stroke` into `deleted: true` to reclaim storage.

## Migration

Pre-existing `Stroke` rows in IndexedDB carrying the old `erasedSamples?: number[]` field are read silently — the new renderer ignores it. New writes drop the field. No version bump needed; the field is sparse on both sides.

## Implementation notes

- `apps/web/src/render.ts` gains a third layer (`strokes`) — not appended to the DOM, used as an offscreen scratch for the strokes-with-stamps render.
- `apps/web/src/stroke.ts` is simplified: the run-based cache from ADR 0008 is removed. `getStrokePath`, `getStrokeBBox` (whole-stroke), `effectiveOpacity`, `addErasedStamps`, `removeErasedStamps`. No more `getStrokeRuns` / `getRunBBox` / `getRunPath` / `invalidateStrokeRunData`.
- `apps/web/src/ops.ts` replaces `maskSamples` with `eraseStamps`.
- `apps/web/src/tools/eraser.ts` switches from sample-finding (point-distance test) to stamp-recording (per pointer event, append a `{x, y, r}`). Object-mode (whole-stroke delete) is unchanged.
- `apps/web/src/main.ts` render loop: clear strokes layer; draw all strokes to it; apply destination-out per stamp; composite onto committed.
