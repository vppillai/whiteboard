/**
 * Eraser tool. Two distinct erase semantics, locked at pointerdown:
 *
 *   - **Wipe** (default): pixel-mask "cuts through" erasing per
 *     [ADR 0009](../../../docs/decisions/0009-pixel-mask-eraser.md).
 *     Each pointer event during a sweep records one cursor disk
 *     `{ x, y, r }` (a *stamp*) on every stroke whose bbox the disk
 *     could touch. The renderer applies `globalCompositeOperation =
 *     'destination-out'` for each stamp on the offscreen strokes layer,
 *     subtracting those pixels from the rendered ink. The visible
 *     cursor circle and the erased pixels match 1:1 — no over-erase, no
 *     trail past the cursor.
 *
 *     Sweep state is held internally as a `Map<strokeId, Stamp[]>` of
 *     "pending" stamps. The renderer reads this map via
 *     `getPendingStamps()` to preview the cut while the sweep is in
 *     progress; on pointerup the pending stamps are converted into one
 *     `eraseStamps` op (single Cmd+Z restores the whole sweep) and
 *     `applyOp` does the actual mutation of `stroke.erasedStamps`. The
 *     pending map is cleared after emit, so the next frame renders
 *     exclusively from the committed `erasedStamps`.
 *
 *     This separation — pending = render preview, op = source of truth —
 *     keeps the ops layer's "ops are the only mutation path" invariant
 *     intact while still giving immediate visual feedback during a
 *     sweep.
 *
 *   - **Object** (single tap): deletes the **topmost** whole stroke
 *     under the cursor. Selected from the right-click menu, OR
 *     temporarily activated by holding Shift at pointerdown when in
 *     Wipe mode. Emits a `delete` op (whole-stroke soft-delete).
 *
 * The cursor visual differentiates the modes — wipe is just the red
 * circle, object adds a small filled center dot (target reticle).
 */

import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import { pointInImage } from '../imagegeom'
import { pill, pillRow, sectionLabel } from '../menu-ui'
import { applyCamera, clearLayer } from '../render'
import { pointInShape } from '../rendershapes'
import {
  ERASER_RADII,
  type EraserMode,
  type EraserSize,
  getEraserMode,
  getEraserSize,
  setEraserConfig,
} from '../settings'
import { getStrokeBBox } from '../stroke'
import { pointInText } from '../textgeom'
import type { Tool, ToolContext } from './types'

/** Visual / behavioral mode at the moment of an eraser gesture. */
export type EraserGestureMode = 'wipe' | 'object'

/** A single cursor-disk stamp. Board coords, board-pixel radius. */
export interface Stamp {
  x: number
  y: number
  r: number
}

/** Per-stroke index edit emitted by the wipe-mode sweep at pointerup. */
export interface StampEdit {
  strokeId: string
  addedStamps: Stamp[]
}

export interface EraserToolCallbacks {
  /** Returns the live strokes list. Called on each hit-test. */
  getStrokes: () => readonly Stroke[]
  /** Returns the live shapes list. Object-mode tap and wipe-mode sweep
   *  both delete the WHOLE shape on hit — vector primitives don't
   *  have pixel-mask semantics. v1.4. */
  getShapes: () => readonly ShapeObject[]
  /** Returns the live texts list. Same whole-object delete semantics
   *  as shapes. v1.4. */
  getTexts: () => readonly TextObject[]
  /** Returns the live images list. Same whole-object delete semantics. v1.4. */
  getImages: () => readonly ImageObject[]
  /** Object mode: emit a whole-stroke delete op for the topmost stroke at
   *  the tap point. Called at most once per gesture at pointerup. */
  onObjectErase: (strokeId: string) => void
  /** Wipe mode: emit a pixel-mask op for the per-stroke stamp edits.
   *  Called once per gesture at pointerup. */
  onWipeErase: (edits: StampEdit[]) => void
  /** Whole-object deletes for non-stroke kinds (shapes, texts, images).
   *  Fired ONCE per gesture at pointerup if any non-stroke object was
   *  touched. Both wipe and object modes use the same callback — the
   *  semantics for vector / raster objects are whole-object delete
   *  regardless of eraser mode. Empty arrays for kinds that weren't
   *  touched. v1.4. */
  onWholeObjectErase: (deletes: {
    shapes: string[]
    texts: string[]
    images: string[]
  }) => void
}

export interface EraserToolOptions {
  callbacks: EraserToolCallbacks
}

/**
 * Eraser extends `Tool` with `getPendingStamps()` so the orchestrator's
 * render loop can preview the in-progress wipe before pointerup. No other
 * tool needs this hook today; if a second one shows up (a lasso preview,
 * for instance), promote it to the base `Tool` interface as a generic
 * "render-preview-mutations" method.
 */
export interface EraserTool extends Tool {
  getPendingStamps(): ReadonlyMap<string, ReadonlyArray<Stamp>>
}

interface EraserPillSpec {
  label: string
  config: { mode: EraserMode; size?: EraserSize }
  isActive: (mode: EraserMode, size: EraserSize) => boolean
}

const ERASER_PILLS: readonly EraserPillSpec[] = [
  {
    label: 'Small',
    config: { mode: 'wipe', size: 'small' },
    isActive: (m, s) => m === 'wipe' && s === 'small',
  },
  {
    label: 'Medium',
    config: { mode: 'wipe', size: 'medium' },
    isActive: (m, s) => m === 'wipe' && s === 'medium',
  },
  {
    label: 'Large',
    config: { mode: 'wipe', size: 'large' },
    isActive: (m, s) => m === 'wipe' && s === 'large',
  },
  {
    label: 'Item',
    config: { mode: 'item' },
    isActive: (m) => m === 'item',
  },
]

export function createEraserTool(opts: EraserToolOptions): EraserTool {
  // Pending sweep stamps — written during pointermove, drained into one
  // `eraseStamps` op at pointerup. Read by the render loop via
  // `getPendingStamps()` so the cut shows live before the op commits.
  const pending = new Map<string, Stamp[]>()
  // Object-mode is single-tap: only the topmost stroke under the cursor at
  // pointerup is deleted. The matched id is captured at pointerup and
  // handed to `onObjectErase` exactly once. (Pre-#7 this was a Set wired
  // for sweep-delete that was never implemented.)
  let objectDeletedId: string | null = null
  // Non-stroke deletes accumulated per gesture. Both wipe mode (sweep
  // crosses an object) and object mode (single tap on an object) write
  // here; the flush at pointerup emits a single onWholeObjectErase
  // batch. Sets so a sweep that re-crosses the same shape doesn't
  // double-queue. v1.4. */
  const wholeDeletes = {
    shapes: new Set<string>(),
    texts: new Set<string>(),
    images: new Set<string>(),
  }
  let active = false
  let mode: EraserGestureMode = 'wipe'
  // Last cursor position + mode the live layer was painted with. The render
  // loop clears the live layer on every committed redraw and asks tools to
  // re-render via `redraw()`; without this cache the cursor would flicker
  // off mid-sweep (committed-dirty fires per stamp, faster than pointermove).
  let lastCursor: { x: number; y: number; mode: EraserGestureMode } | null = null

  const radius = (): number => ERASER_RADII[getEraserSize()]

  /**
   * Wipe-mode hit. Records a stamp at `(px, py)` for every stroke whose
   * bbox the disk could touch (lenient AABB cull — false positives just
   * waste render cycles, never cause over-erasure because destination-out
   * only affects pixels actually inside the disk). Returns true if any
   * stroke was stamped (caller marks committed dirty).
   */
  const sweepHit = (px: number, py: number): boolean => {
    const stamp: Stamp = { x: px, y: py, r: radius() }
    let any = false
    for (const stroke of opts.callbacks.getStrokes()) {
      if (stroke.deleted) continue
      // Lenient AABB cull: the disk could affect this stroke if the disk's
      // footprint overlaps the stroke's padded bbox.
      const tol = stamp.r + stroke.brush.size / 2
      const bb = getStrokeBBox(stroke)
      if (px + tol < bb.minX || px - tol > bb.maxX) continue
      if (py + tol < bb.minY || py - tol > bb.maxY) continue
      let bucket = pending.get(stroke.id)
      if (!bucket) {
        bucket = []
        pending.set(stroke.id, bucket)
      }
      bucket.push(stamp)
      any = true
    }
    // Wipe mode is STROKES-ONLY. Earlier in v1.4 the sweep also queued
    // whole-object deletes for shapes / texts / images that the disk
    // touched, but that was too aggressive: a user scrubbing strokes
    // OFF an image would also nuke the image underneath. Now wipe is
    // narrowly scoped to "cut through strokes." To delete a shape /
    // text / image, the user switches to object mode (tap-to-delete).
    return any
  }

  /** Scan shapes / texts / images for any that the eraser disk at
   *  (px, py) with radius `r` overlaps. Add the ids to the whole-
   *  delete queue (deduped by Set). Returns true if anything new
   *  was queued so the caller can mark dirty / preview the deletion.
   *
   *  Object-mode tap only. Wipe mode is intentionally strokes-only —
   *  scrubbing strokes off an image shouldn't also delete the image
   *  underneath. Whole-object delete is a deliberate single-tap
   *  gesture in object mode.
   *
   *  Tolerance: the disk radius. Texts and images use a rotated-rect
   *  AABB containment at the center point. */
  const queueNonStrokeHits = (px: number, py: number, r: number): boolean => {
    let any = false
    for (const sh of opts.callbacks.getShapes()) {
      if (sh.deleted) continue
      if (wholeDeletes.shapes.has(sh.id)) continue
      // pointInShape takes a screen-relative tolerance — feeding it
      // the eraser radius gives "disk touches the shape" semantics.
      if (pointInShape({ x: px, y: py }, sh, r)) {
        wholeDeletes.shapes.add(sh.id)
        any = true
      }
    }
    for (const t of opts.callbacks.getTexts()) {
      if (t.deleted) continue
      if (wholeDeletes.texts.has(t.id)) continue
      if (pointInText({ x: px, y: py }, t)) {
        wholeDeletes.texts.add(t.id)
        any = true
      }
    }
    for (const img of opts.callbacks.getImages()) {
      if (img.deleted) continue
      if (wholeDeletes.images.has(img.id)) continue
      if (pointInImage({ x: px, y: py }, img)) {
        wholeDeletes.images.add(img.id)
        any = true
      }
    }
    return any
  }

  /** Object-mode hit: identify the topmost whole stroke under the cursor.
   *  Returns the matched id (or null). Pure read — the op pipeline owns
   *  the deletion via `applyOp({ kind: 'delete' })` so the mutation stays
   *  CRDT-friendly for the deferred future sharing layer (ADR 0012). */
  const objectHit = (px: number, py: number): string | null => {
    const r = radius()
    const strokes = opts.callbacks.getStrokes()
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i]
      if (!stroke || stroke.deleted) continue
      if (strokeNearPoint(stroke, px, py, r)) return stroke.id
    }
    return null
  }

  /** Paint the cursor at the given board point. Caller is responsible for
   *  having cleared the live layer first if appropriate. */
  const paintCursor = (
    boardX: number,
    boardY: number,
    gestureMode: EraserGestureMode,
    ctx: ToolContext,
  ): void => {
    applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
    const c = ctx.liveLayer.ctx
    c.save()
    c.strokeStyle = 'rgba(239, 68, 68, 0.7)'
    c.lineWidth = 1.5 / ctx.camera.scale
    c.beginPath()
    c.arc(boardX, boardY, radius(), 0, Math.PI * 2)
    c.stroke()
    if (gestureMode === 'object') {
      c.fillStyle = 'rgba(239, 68, 68, 0.85)'
      c.beginPath()
      c.arc(boardX, boardY, Math.max(2 / ctx.camera.scale, 1.5), 0, Math.PI * 2)
      c.fill()
    }
    c.restore()
  }

  /** Update the cursor cache and repaint the live layer (clear + paint). */
  const renderCursor = (
    boardX: number,
    boardY: number,
    gestureMode: EraserGestureMode,
    ctx: ToolContext,
  ): void => {
    lastCursor = { x: boardX, y: boardY, mode: gestureMode }
    clearLayer(ctx.liveLayer)
    paintCursor(boardX, boardY, gestureMode, ctx)
  }

  const cancel = (): void => {
    active = false
    pending.clear()
    objectDeletedId = null
    lastCursor = null
  }

  return {
    id: 'eraser',
    cursor: 'none',

    onPointerDown(e, ctx) {
      const { x, y } = ctx.toBoard(e.clientX, e.clientY)
      active = true
      // Configured default mode, with Shift always overriding to object.
      const wantObject = e.shiftKey || getEraserMode() === 'item'
      mode = wantObject ? 'object' : 'wipe'
      pending.clear()
      objectDeletedId = null
      wholeDeletes.shapes.clear()
      wholeDeletes.texts.clear()
      wholeDeletes.images.clear()
      if (mode === 'wipe') {
        if (sweepHit(x, y)) ctx.markCommittedDirty()
      }
      renderCursor(x, y, mode, ctx)
    },

    onPointerMove(e, ctx) {
      if (!active) {
        // Hover: cursor reflects the *prospective* mode (Shift override + setting).
        const { x, y } = ctx.toBoard(e.clientX, e.clientY)
        const previewObject = e.shiftKey || getEraserMode() === 'item'
        renderCursor(x, y, previewObject ? 'object' : 'wipe', ctx)
        return
      }
      if (mode === 'wipe') {
        const coalesced = e.getCoalescedEvents?.() ?? []
        const events = coalesced.length > 0 ? coalesced : [e]
        let anyHit = false
        for (const ce of events) {
          const { x, y } = ctx.toBoard(ce.clientX, ce.clientY)
          if (sweepHit(x, y)) anyHit = true
        }
        if (anyHit) ctx.markCommittedDirty()
      }
      const last = ctx.toBoard(e.clientX, e.clientY)
      renderCursor(last.x, last.y, mode, ctx)
    },

    onPointerUp(e, ctx) {
      if (!active) return
      active = false
      if (mode === 'object') {
        const { x, y } = ctx.toBoard(e.clientX, e.clientY)
        objectDeletedId = objectHit(x, y)
        // Object-mode tap also targets the topmost non-stroke kind
        // under the cursor: shapes / texts / images get whole-object
        // delete the same way a tapped stroke does. queueNonStrokeHits
        // populates wholeDeletes; the flush below emits one batched
        // onWholeObjectErase callback.
        queueNonStrokeHits(x, y, radius())
        if (objectDeletedId) opts.callbacks.onObjectErase(objectDeletedId)
      } else if (pending.size > 0) {
        // Build edits, drain pending, then emit op. Drain BEFORE emit so
        // the render pass triggered by applyOp's markDirty doesn't double-
        // apply (pending empty + stroke.erasedStamps now populated).
        const edits: StampEdit[] = []
        for (const [strokeId, stamps] of pending) {
          edits.push({ strokeId, addedStamps: stamps.map((s) => ({ ...s })) })
        }
        pending.clear()
        opts.callbacks.onWipeErase(edits)
      }
      // Flush non-stroke whole-object deletes accumulated during this
      // gesture. Single batched callback so undo gets ONE step
      // covering everything the eraser pass touched, regardless of
      // mode and regardless of how many objects were crossed.
      if (
        wholeDeletes.shapes.size > 0 ||
        wholeDeletes.texts.size > 0 ||
        wholeDeletes.images.size > 0
      ) {
        opts.callbacks.onWholeObjectErase({
          shapes: [...wholeDeletes.shapes],
          texts: [...wholeDeletes.texts],
          images: [...wholeDeletes.images],
        })
        wholeDeletes.shapes.clear()
        wholeDeletes.texts.clear()
        wholeDeletes.images.clear()
      }
      objectDeletedId = null
      // Gesture is over. Clear the cached cursor + live layer; hover render
      // will reappear on the next pointermove.
      lastCursor = null
      clearLayer(ctx.liveLayer)
      ctx.markCommittedDirty()
    },

    renderContextualMenu(host, dismiss) {
      host.appendChild(sectionLabel('Eraser'))
      const row = pillRow()
      const m = getEraserMode()
      const s = getEraserSize()
      for (const spec of ERASER_PILLS) {
        row.appendChild(
          pill({
            label: spec.label,
            title:
              spec.config.mode === 'item'
                ? 'Tap a single stroke to delete it'
                : `Wipe — ${spec.label.toLowerCase()} radius`,
            active: spec.isActive(m, s),
            onClick: () => {
              setEraserConfig(spec.config)
              dismiss()
            },
          }),
        )
      }
      host.appendChild(row)
    },

    redraw(ctx) {
      // Render loop just cleared the live layer after a committed redraw.
      // Repaint the cursor at its last known position so it doesn't blink
      // off between pointermove events while the sweep marks committed
      // dirty per stamp.
      if (lastCursor) paintCursor(lastCursor.x, lastCursor.y, lastCursor.mode, ctx)
    },

    cleanup: cancel,

    getPendingStamps: () => pending,
  }
}

/** Object-mode whole-stroke hit test: any sample / segment within `r`. */
function strokeNearPoint(stroke: Stroke, px: number, py: number, r: number): boolean {
  const tolerance = r + stroke.brush.size / 2
  const tol2 = tolerance * tolerance
  const samples = stroke.samples
  const n = samples.length
  if (n === 0) return false
  if (n === 1) {
    const s = samples[0]
    if (!s) return false
    const dx = s.x - px
    const dy = s.y - py
    return dx * dx + dy * dy <= tol2
  }
  for (let i = 1; i < n; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    if (!a || !b) continue
    if (segmentDistSq(a.x, a.y, b.x, b.y, px, py) <= tol2) return true
  }
  return false
}

function segmentDistSq(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  px: number,
  py: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  const ddx = px - cx
  const ddy = py - cy
  return ddx * ddx + ddy * ddy
}
