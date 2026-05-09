# 0008. Segment-eraser — "cuts through" instead of stroke-hit

Date: 2026-05-09

## Status

Accepted (planning). Implementation deferred to milestone M1.x. Supersedes the eraser model described in [SPEC § 4.1](../../SPEC.md#41-tool-set-v1) ("Eraser (stroke-hit erase, not pixel)") once M1.x ships.

## Context

The v1 eraser is **stroke-hit**: any sample of a stroke crossed by the eraser radius soft-deletes the entire stroke. This is what the SPEC currently specifies and what was shipped through M1.4 / M1.5 / M1.6.

User feel-test verdict on Wacom Intuos: it does not feel like an eraser. A real whiteboard eraser **cuts through** ink — only the part the eraser physically passes over disappears; the rest of the stroke survives. The current behavior repeatedly surprises the user because crossing one tail of a long curve evaporates the whole curve.

The drawing-tools tenet from `SPEC § 0` is explicit: **pen-friendly takes precedence** and **architectural debt that produces glitches is treated as milestone-critical**. Stroke-hit erasure was chosen for engineering simplicity; the simplicity is no longer worth the feel cost.

## Decision

The eraser becomes **segment-level** via a per-sample mask. Implementation lands as milestone M1.x ("segment-eraser") between M1 and M1.7.

### Data model

`Stroke` gains a sparse mask of erased samples:

```ts
type Stroke = {
  // ... existing fields ...
  /**
   * Indices of samples erased by the segment-eraser. Sorted ascending,
   * deduplicated. Sparse — undefined / empty means no erasure (the common
   * case). Renderer breaks the stroke at every gap larger than 1.
   *
   * Soft-delete (`deleted: true`) still applies to whole-stroke removals
   * (e.g. lasso-delete). Mask + deleted are independent: a stroke with
   * `deleted: true` is gone regardless of its mask.
   */
  erasedSamples?: number[]
}
```

Why a sparse `number[]` and not a dense `boolean[]`:

- The common case (no erasure) costs zero bytes per stroke.
- Persistence and (eventually) CRDT updates carry only the diff.
- Renderer iteration: a single sorted index per call to "advance to next live run."

### Render model

The render loop's `for (const stroke of strokes)` body changes from "draw one outline" to "draw N outlines, one per contiguous run of un-erased samples":

```ts
for (const run of liveRuns(stroke)) {
  const path = getStrokePathForRun(stroke, run) // cached
  drawStrokePath(ctx, path, brushFor(stroke))
}
```

`liveRuns(stroke)` yields `{ start, end }` index pairs over `samples` such that no index in `[start, end)` is in `erasedSamples`. A stroke with no `erasedSamples` produces exactly one run covering the whole stroke — the existing path is preserved with no extra cost.

### Geometry cache

The current per-stroke `WeakMap<Stroke, StrokePath>` cache (M1 viewport-clipping work) keys on the stroke object. With segment-eraser it keys on `(stroke, mask-version)`:

- Each stroke gains a private `mskVer: number` that increments on every mask change.
- The cache stores `Map<mskVer, StrokePath[]>` (one path per run).
- AABB also lives per run for viewport clipping.

This keeps the hot path (no erasure) at the same cost as today: one cache lookup, one path entry.

### Op model

Erasure becomes a new op kind in `ops.ts`:

```ts
type Op = ...existing... | {
  kind: 'maskSamples'
  /** Per-stroke list of newly-erased sample indices (NOT a delta — full
   *  set of indices added by this gesture so unapply can restore exactly). */
  edits: { strokeId: string; addedIndices: number[] }[]
}
```

`apply` extends each affected stroke's `erasedSamples` (sorted-merge); `unapply` removes the same indices. Idempotent on re-apply.

The wipe sweep emits **one** `maskSamples` op at pointerup with the accumulated edits — same UX as today: a single Cmd+Z restores the whole sweep. Progressive feedback during the sweep is a transient mutation of `erasedSamples` (mirroring the M1.6 progressive deletion of `Stroke.deleted` for stroke-hit). The transient version is finalized into the op at pointerup.

## Considered alternatives

### Split-stroke (rejected)

On erase, soft-delete the original stroke and create N new strokes from the surviving sample runs. Pros: renderer changes are minimal — strokes remain "one outline each." Cons:

- N×K op churn for K erasure gestures. The undo log becomes hostile to read.
- CRDT (M3) churn: many concurrent `create` events from a single user gesture.
- The original stroke's identity (id, createdAt) is lost — a problem for any future feature keyed on stroke identity (selection across edit, presence-aware highlight, etc.).
- Splitting requires reconstructing a `Stroke` for each run, which means re-snapshotting the brush and color — boilerplate that drifts from the original.

### Render-only cut (rejected)

Visually cut during the sweep but persist nothing — strokes survive intact. Rejected outright: the user would erase, see the cut, reload, and find their erasure undone. Defeats the purpose.

### Pixel erase via destination-out compositing (rejected)

Maintain a separate "erased pixels" raster that the live + committed layers composite against. Pros: matches the physical model literally. Cons: vector strokes survive theme changes / pan / zoom by re-rasterizing — pixel masks don't. We'd lose the theme-aware ink color, viewport clipping, and CRDT-friendly representation. Whole-design regression.

## Consequences

**Easier.**

- The eraser feels like an eraser. Tenet alignment, not nice-to-have.
- Lasso (M1) and segment-eraser share the same "operate on multiple strokes" infrastructure (op shape, render-path-per-run cache).

**Harder.**

- The renderer no longer assumes one outline per stroke. Every stroke iteration sites needs to think in runs. Touched: `main.ts` render loop, `?perftest=*` harnesses (synthetic strokes have no mask, so no behavior change, but the iteration shape is uniform).
- Undo log size grows. Each erasure gesture's op carries the indices touched per stroke. Bounded by sample count, not unbounded — but a long sweep can touch many strokes.
- Per-sample bbox math for run AABBs. Existing per-stroke bbox is `O(n)`; per-run bbox is `O(n)` total across all runs. Same complexity.

**Risks.**

- A naïve renderer iteration that builds runs on every frame burns CPU. Mitigation: cache runs by `(stroke, mskVer)`; invalidate only on mask change.
- A user could feel "stuck" because erasure is now always recoverable but not visually clean — bits of stroke remain. Mitigation: existing `Shift` for object-delete (whole-stroke) stays. Object-mode is unchanged.
- The `erasedSamples` array could grow long on a heavily-edited stroke. Practical bound is `samples.length`; a fully-erased stroke would be cheaper to represent as `deleted: true` than as `erasedSamples = [0..n-1]`. Mitigation: the ops layer collapses "all samples erased" into a `delete` op at commit time.

## Implementation plan (M1.x)

1. Extend `Stroke` type in `packages/shared/src/types.ts` with `erasedSamples?: number[]` and bump persisted-stroke version (storage migration: rows without the field default to no erasure).
2. Per-stroke `mskVer` counter (in-memory only — derived from array identity is enough; an explicit version is simpler).
3. `liveRuns(stroke)` helper in `apps/web/src/stroke.ts`. Returns an iterable of `{ start, end }` pairs.
4. Renderer changes: replace `getStrokePath(stroke)` calls with run iteration. Update viewport-clip bbox to be per-run.
5. Eraser tool changes:
   - `sweepHit` (wipe): per intersected stroke, identify the contiguous index range under the eraser radius and add to a per-stroke pending mask.
   - On pointerup: emit one `maskSamples` op carrying the accumulated edits.
6. Op type + `apply` / `unapply` in `ops.ts`.
7. `?perftest=erase` synthetic harness measuring frame time during a fast sweep across 100, 500, 1000 strokes. Budget: keep the wipe responsive within the 16 ms frame at 500 strokes (the M1 perf-at-scale gate).
8. SPEC § 4.1 updated to describe segment-eraser. CHANGELOG entry. Tagged commit `m1.x-segment-eraser`.

## Notes

This ADR replaces the eraser part of [ADR 0006](0006-op-based-undo.md)'s op table. ADR 0006's `delete` op survives unchanged for lasso-delete (whole-stroke removal); the new `maskSamples` op covers the segment-eraser path.
