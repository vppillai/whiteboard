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

import type { Stroke } from '@whiteboard/shared'
import { pill, pillRow, sectionLabel } from '../menu-ui'
import { applyCamera, clearLayer } from '../render'
import {
  ERASER_RADII,
  type EraserMode,
  type EraserSize,
  getEraserMode,
  getEraserSize,
  setEraserConfig,
} from '../settings'
import { getStrokeBBox } from '../stroke'
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
  /** Object mode: emit a whole-stroke delete op. Called once per tap. */
  onObjectErase: (strokeIds: string[]) => void
  /** Wipe mode: emit a pixel-mask op for the per-stroke stamp edits.
   *  Called once per gesture at pointerup. */
  onWipeErase: (edits: StampEdit[]) => void
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
  // Strokes deleted in object mode this gesture (passed to `onObjectErase`).
  const objectDeleted = new Set<string>()
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
    return any
  }

  /** Object-mode hit: soft-delete the topmost whole stroke under the cursor. */
  const objectHit = (px: number, py: number): boolean => {
    const r = radius()
    const strokes = opts.callbacks.getStrokes()
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i]
      if (!stroke || stroke.deleted || objectDeleted.has(stroke.id)) continue
      if (strokeNearPoint(stroke, px, py, r)) {
        objectDeleted.add(stroke.id)
        stroke.deleted = true
        return true
      }
    }
    return false
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
    objectDeleted.clear()
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
      objectDeleted.clear()
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
        if (objectHit(x, y)) ctx.markCommittedDirty()
        if (objectDeleted.size > 0) opts.callbacks.onObjectErase([...objectDeleted])
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
      objectDeleted.clear()
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
