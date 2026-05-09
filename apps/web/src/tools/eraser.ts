/**
 * Eraser tool. Stroke-hit erasing — operates on whole strokes via the
 * `Stroke.deleted` soft-delete flag (ADR 0006); never splits stroke geometry.
 *
 * Two modes, locked at pointerdown by Shift state:
 *
 *   - **Wipe** (default): drag-through. Every stroke whose path passes within
 *     `(radius + stroke.brush.size/2)` of the eraser cursor gets queued. On
 *     pointerup, the whole queue becomes one delete op.
 *
 *   - **Object** (Shift held at pointerdown): a single tap deletes the
 *     **topmost** stroke under the cursor (and only that one). No sweep
 *     accumulation. Surgical removal without touching neighbouring strokes.
 *
 * The cursor visual differentiates the modes — wipe is just the red circle,
 * object adds a small filled center dot (target reticle).
 *
 * Performance: O(eraser_path_length × strokes × samples_per_stroke) for wipe,
 * O(strokes × samples) for object. Stroke clipping (M1) cuts both
 * proportionally to viewport size.
 */

import type { Stroke } from '@whiteboard/shared'
import type { Tool, ToolContext } from './types'

export type EraserMode = 'wipe' | 'object'

export interface EraserToolCallbacks {
  /** Returns the live strokes list. Called on each hit-test. */
  getStrokes: () => readonly Stroke[]
  /** Emit a delete op for the swept strokes. Called once per gesture. */
  onErase: (strokeIds: string[]) => void
  /** Live cursor render, board coordinates. Mode passed for visual differentiation. */
  onCursorMove: (boardX: number, boardY: number, radius: number, mode: EraserMode) => void
  /** Cursor cleared. */
  onCursorEnd: () => void
}

export interface EraserToolOptions {
  callbacks: EraserToolCallbacks
  /** Eraser hit radius in board-space pixels. Read on every event so a
   *  size change in settings applies immediately. */
  getRadius: () => number
}

export function createEraserTool(opts: EraserToolOptions): Tool {
  const swept = new Set<string>()
  let active = false
  let mode: EraserMode = 'wipe'

  /** Wipe-mode hit: accumulate every match within tolerance. */
  const sweepHit = (px: number, py: number): void => {
    for (const stroke of opts.callbacks.getStrokes()) {
      if (stroke.deleted) continue
      if (swept.has(stroke.id)) continue
      if (strokeNearPoint(stroke, px, py, opts.getRadius())) {
        swept.add(stroke.id)
      }
    }
  }

  /** Object-mode hit: take only the topmost match (last in the strokes array). */
  const objectHit = (px: number, py: number): void => {
    const strokes = opts.callbacks.getStrokes()
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i]
      if (!stroke || stroke.deleted || swept.has(stroke.id)) continue
      if (strokeNearPoint(stroke, px, py, opts.getRadius())) {
        swept.add(stroke.id)
        return
      }
    }
  }

  const cancel = (): void => {
    active = false
    swept.clear()
    opts.callbacks.onCursorEnd()
  }

  return {
    id: 'eraser',
    cursor: 'none',
    onPointerDown(e, ctx) {
      const { x, y } = ctx.toBoard(e.clientX, e.clientY)
      active = true
      mode = e.shiftKey ? 'object' : 'wipe'
      swept.clear()
      if (mode === 'wipe') {
        sweepHit(x, y)
      }
      opts.callbacks.onCursorMove(x, y, opts.getRadius(), mode)
    },
    onPointerMove(e, ctx) {
      if (!active) {
        // Hover: render the cursor so the user sees where they'll erase. The
        // mode here is the *prospective* mode (what would happen if they
        // pressed now) so it reflects current Shift state.
        const { x, y } = ctx.toBoard(e.clientX, e.clientY)
        opts.callbacks.onCursorMove(x, y, opts.getRadius(), e.shiftKey ? 'object' : 'wipe')
        return
      }
      if (mode === 'wipe') {
        const coalesced = e.getCoalescedEvents()
        const events = coalesced.length > 0 ? coalesced : [e]
        for (const ce of events) {
          const { x, y } = ctx.toBoard(ce.clientX, ce.clientY)
          sweepHit(x, y)
        }
      }
      // Object mode: don't accumulate during move; only commit at pointerup.
      const last = ctx.toBoard(e.clientX, e.clientY)
      opts.callbacks.onCursorMove(last.x, last.y, opts.getRadius(), mode)
    },
    onPointerUp(e, ctx) {
      if (!active) return
      active = false
      opts.callbacks.onCursorEnd()
      if (mode === 'object') {
        const { x, y } = ctx.toBoard(e.clientX, e.clientY)
        objectHit(x, y)
      }
      if (swept.size > 0) opts.callbacks.onErase([...swept])
      swept.clear()
    },
    cleanup: cancel,
  }
}

/**
 * True if any segment of the stroke passes within `(radius + stroke.brush.size/2)`
 * of the point. Empty / single-sample strokes are tested as a circle around
 * the lone sample.
 */
function strokeNearPoint(stroke: Stroke, px: number, py: number, radius: number): boolean {
  const tolerance = radius + stroke.brush.size / 2
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
