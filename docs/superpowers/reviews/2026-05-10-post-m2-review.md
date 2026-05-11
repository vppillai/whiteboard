# Post-M2 Critical Codebase Review

**Date:** 2026-05-10
**Reviewer:** feature-dev:code-reviewer agent (independent pass)
**Branch:** `main` at tag `m2-export-polish`
**Scope:** Whole codebase — simplicity, maintainability, consistency, correctness

---

## Headline — Three Things to Fix Before M3

1. **Introduce a `StrokeStore` interface seam in `main.ts` before writing any sync code** (#9). This is the highest-leverage structural change. Without it, M3 sync will either pile into the existing 1067-line closure or require a disruptive refactor mid-milestone. A `StrokeStore` abstraction with `load()`, `save()`, `clear()`, and `onRemoteChange()` methods takes half a day to extract and makes local-vs-room branching trivial.

2. **Change `Stroke.startedAt` from `performance.now()` to `Date.now()`** (#6). One-line fix that prevents a silent CRDT sort-order bug in multi-peer sessions. `startedAt` is the sort key for render order; tab-relative monotonic timestamps from two peers will interleave strokes non-chronologically, scrambling visual stacking. Fix before migration code snapshots the wrong epoch.

3. **Fix the object-eraser's direct mutation of `stroke.deleted` outside the op pipeline** (#1). When Y.js wraps strokes as `Y.Map`, direct field assignment won't propagate to the CRDT — only op-mediated writes will. Current pattern would silently make object-erased strokes vanish locally but persist on other peers. Small fix; window to make it cleanly is before M3 starts.

---

## Critical

### 1. Object-mode eraser mutates `stroke.deleted` directly — bypasses op layer, will break under CRDT

**Location:** `apps/web/src/tools/eraser.ts:175-176, 270-273`

`objectHit` sets `stroke.deleted = true` directly on the in-memory stroke during the drag (to suppress re-hit). `onPointerUp` then calls `onObjectErase(ids)` → `applyOp({kind:'delete', strokeIds:ids}, opCtx)` → `flipDeleted` → `saveStroke`. The stroke ends up correctly marked but it gets mutated **outside the op pipeline first**. When M3 wraps `Stroke` as a `Y.Map`, direct field assignment won't propagate to the Y.Doc — only mutations through op-mediated writes will. The object-erase deletion will silently fail to sync to other peers even after pointerup.

**Fix:** Remove `stroke.deleted = true` from `objectHit`. Track in-flight "preview deletions" in `objectDeleted: Set<string>` only (already done). Suppress the visual immediately on pointerup; the op fires synchronously.

**Confidence:** 85

---

### 2. `deleteStroke` exported but never called — soft-deleted strokes accumulate in IDB forever

**Location:** `apps/web/src/storage.ts:59-67`

`deleteStroke(id)` is dead code. Soft-deleted strokes remain in IDB and are reloaded on every page load. `loadAllStrokes` loads *every* row including soft-deleted ones. On long sessions or heavy erasing, IDB grows unbounded. At M3 migration time (Decision 10), every ever-soft-deleted stroke gets ingested into the Y.Doc and tombstoned forever, bloating the CRDT document.

**Fix:** Background compaction in `loadAllStrokes`: hard-delete strokes with `deleted === true` and `startedAt` older than the undo-stack horizon (e.g., 5 minutes or 500 ops).

**Confidence:** 82

---

## Important

### 3. Dead code: `applyGamma` in `pen.ts`

**Location:** `apps/web/src/tools/pen.ts:299-302`

Pre-M2 implementation orphaned when `applyPressure` was promoted to `stroke.ts`. Never invoked. Trap for future readers who might reach for it thinking it's authoritative.

**Fix:** Delete lines 299–302.

**Confidence:** 100

---

### 4. `fonts` field is dead schema weight — persisted for explicitly-deferred Text tool

**Location:** `apps/web/src/settings.ts:74`; `apps/web/src/settings/panel-content.ts:293-300`

`SettingsV1.fonts: string[]` is persisted, migrated, and renders a panel section that says "Reserved for the Text tool (M2+)." Text tool descoped. Carries forward through any future settings-sync.

**Fix:** Remove `fonts` from `SettingsV1`, `defaultV1()`, `migrate()`. Drop `renderFontsSection`. Update tests. Re-introduce with V2 bump when Text actually lands.

**Confidence:** 80

---

### 5. `getComputedStyle` called inside 60 Hz render loop

**Location:** `apps/web/src/grid.ts:34`

`drawGrid` reads `--grid-dot` / `--grid-line` from `getComputedStyle(document.documentElement)` on every committed redraw — 60 calls/sec with panning, each forces a style recalc. Theme tokens only change on `themechange` event.

**Fix:** Cache the two strings at module level. Invalidate in the `themechange` handler (already wired in `main.ts:491`).

**Confidence:** 85

---

### 6. `Stroke.startedAt` uses `performance.now()` — will collide in CRDT merge

**Location:** `apps/web/src/tools/pen.ts:187`; `packages/shared/src/types.ts:53`

`startedAt = e.timeStamp` is performance.now()-based (milliseconds since tab origin). `startedAt` is the sort key in `loadAllStrokes`. Two peers — or the same user on two devices — produce values in disjoint monotonic ranges. Merged into the Y.Doc and sorted by `startedAt`, the two peers' strokes interleave chaotically rather than in wall-clock order. Display order = visual z-order, so this affects what the user sees.

**Fix:** Change to `Date.now()` (wall-clock ms). CRDT merge handles ties via Y.js's internal vector clock; `startedAt` just needs to be cross-peer-monotonic. One-line change in `pen.ts` + comment in `types.ts`.

**Confidence:** 88

---

### 7. Object-mode eraser only fires at `pointerUp` — multi-id callback path is dead

**Location:** `apps/web/src/tools/eraser.ts:243-265, 272-273`

In object mode, `onPointerMove` doesn't call `objectHit` — just repaints cursor. Only a single hit fires at `pointerUp`. The `objectDeleted: Set<string>` and `onObjectErase(ids: string[])` API was designed for sweep-delete that was never implemented. YAGNI debt: the multi-id structure exists for a behavior that doesn't happen.

**Fix:** Pick one and remove the dead abstraction:
- (a) Keep single-tap object delete: `objectDeletedId: string | null`, `onObjectErase(id: string)`, drop the Set.
- (b) Wire sweep-delete: call `objectHit` from `onPointerMove`.

**Confidence:** 82

---

### 8. Curve editor uses hardcoded hex colors — invisible in dark mode

**Location:** `apps/web/src/settings/curve-editor.ts:78-107`

Diagonal reference line (`#d4d4d8`) and four quarter-grid lines (`#f4f4f5`) are hardcoded light-theme grays. In dark mode the panel bg is `#161b22` — reference line is near-invisible, grid washed out. Same pattern as the `--surface-1/2` bug.

**Fix:** Replace hex values with `var(--border)` and `var(--surface-2)` respectively. Or use `currentColor` on a container with `color: var(--fg-muted)`.

**Confidence:** 88

---

### 9. `main.ts` has no seam for M3 local-vs-sync branching

**Location:** `apps/web/src/main.ts` (entire file, ~1067 lines)

The m3-prep doc (Decision 16) identifies this as the most architecturally significant new boundary in M3. Currently `main.ts` is a 1067-line closure that owns `strokes: Stroke[]`, undo/redo stacks, `opCtx`, all tool instances, the render loop, all keyboard shortcuts, and all settings wiring. Sync means `strokes` becomes `yDoc.getArray('strokes')` in room mode, `saveStroke` becomes a Y.Doc mutation, `loadAllStrokes` becomes provider hydration. None are clean injection points today.

The cost of not decomposing: M3 sync work will either (a) be crammed into `main.ts` behind `if (isRoomMode)` branches, making it a 1600-line file with tangled conditionals, or (b) require a refactor under time pressure during M3.

**Fix:** Before any M3 sync code, extract a `StrokeStore` interface from `main.ts` into a new file. Methods: `load()`, `save(stroke)`, `delete(id)`, `clear()`, `onRemoteChange(handler)`. Wire `storage.ts` (local) and the future `sync/ydoc-store.ts` (room) through it. ~50 lines to extract; makes the M3 seam explicit.

**Confidence:** 90

---

### 10. SVG export uses straight-line polyline — visual mismatch with canvas curves

**Location:** `apps/web/src/export/svg.ts:123-136`

Canvas render in `stroke.ts`'s `outlineToPath2D` uses `quadraticCurveTo` between adjacent outline points (smooth-polygon hull). SVG serializer uses straight `L` segments. For short strokes with few outline vertices, exported SVG has sharp corners where canvas has smooth curves. Violates "WYSIWYG export" tenet.

**Fix:** Change `outlineToPath` to use SVG `Q cx cy mx my` matching the `quadraticCurveTo(x0, y0, midX, midY)` logic. String-building change; geometry stays the same.

**Confidence:** 87

---

### 11. `Sample.t` uses `performance.now()` and is persisted — epoch-crosses across page reloads

**Location:** `packages/shared/src/types.ts:18`; `apps/web/src/tools/pen.ts:87`

`Sample.t = e.timeStamp` (performance.now-relative) is stored in IDB. Next page load, samples carry timestamps from a different navigation epoch. Currently unused after storage, so harmless today — but future replay or velocity-effects will get meaningless cross-epoch values. At M3, Y.js distributes `t` to peers with different origins → completely incomparable.

**Fix:** Either (a) redefine as "elapsed time within stroke; t=0 at pointerdown" = `e.timeStamp - stroke.startedAt`, making it epoch-independent; or (b) strip `t` before `saveStroke`. (a) is more useful for future velocity features.

**Confidence:** 80

---

### 12. `renderCurveThumbnail` rebuilds SVG for every unrelated settings change

**Location:** `apps/web/src/settings/panel-content.ts:113, 131`

`refreshThumb` is wired into the global `update` callback, which fires for every settings change (color, grid, opacity, etc.). Each change causes N brush cards × 1 SVG thumbnail reconstruction. O(brushes) DOM work per unrelated change.

**Fix:** Only re-render when the brush's `pressureCurve.mid` or `pressureGamma` changes. Compare before/after, skip `replaceChildren` if unchanged. Or hoist invalidation to `clearPreset` / `setPresetField` callsites for `pressureCurve` specifically.

**Confidence:** 80

---

## Observations (below 80 confidence, worth knowing)

- `simulatePressure: false` in `export/svg.ts:66` is passed to `getStroke` but the canvas path in `getStrokePath` doesn't pass `simulatePressure` — uses perfect-freehand's default (`true` when `thinning !== 0`). May compound issue #10 for thinned brushes.

- Popover drag in `popover.ts` adds pointermove/pointerup to header without a cleanup path. Self-removal in `endDrag` is correct for transient drags. No issue.

- `?` / `Shift+/` help toggle in `keymap.ts:200` doesn't `preventDefault` — may collide with browser shortcuts on Firefox. Low risk.

---

## How To Use This Doc

For each numbered item, the location, root cause, fix, and confidence are sufficient to drive a TDD fix loop without re-investigating. The **Headline** is the prioritized must-do list for the pre-M3 hardening pass.
