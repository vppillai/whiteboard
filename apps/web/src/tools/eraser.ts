/**
 * Eraser tool. Stroke-hit erasing — sweeping the eraser across a stroke marks
 * it for soft-deletion (Stroke.deleted = true). Operates on whole strokes, not
 * pixels; matches the SPEC.md design.
 *
 * Behavior:
 *   - On pointerdown / pointermove the tool hit-tests the cursor against
 *     every non-deleted stroke. Any stroke whose path passes within
 *     `radius + stroke.brush.size/2` of the cursor gets queued for erasure.
 *   - The hit set accumulates throughout the gesture; on pointerup, the
 *     accumulated ids become a single `delete` op (so the user undoes the
 *     whole sweep with one Cmd+Z, not stroke-by-stroke).
 *   - The tool emits `onCursorMove` for live cursor rendering and
 *     `onCursorEnd` so the renderer can clear it.
 *
 * Performance: O(eraser_path_length × strokes × samples_per_stroke). Stroke
 * clipping (M1, separate task) cuts this proportionally to viewport size.
 * For typical hundreds-of-strokes boards this is comfortably under-budget.
 */

import type { Stroke } from '@whiteboard/shared'
import type { Tool, ToolContext } from './types'

export interface EraserToolCallbacks {
  /** Returns the live strokes list. Called on each hit-test. */
  getStrokes: () => readonly Stroke[]
  /** Emit a delete op for the swept strokes. Called once per gesture. */
  onErase: (strokeIds: string[]) => void
  /** Live cursor render, board coordinates. */
  onCursorMove: (boardX: number, boardY: number, radius: number) => void
  /** Cursor cleared. */
  onCursorEnd: () => void
}

export interface EraserToolOptions {
  callbacks: EraserToolCallbacks
  /** Eraser hit radius in board-space pixels. */
  radius: number
}

export function createEraserTool(opts: EraserToolOptions): Tool {
  const swept = new Set<string>()
  let active = false

  const handlePoint = (boardX: number, boardY: number): void => {
    for (const stroke of opts.callbacks.getStrokes()) {
      if (stroke.deleted) continue
      if (swept.has(stroke.id)) continue
      if (strokeNearPoint(stroke, boardX, boardY, opts.radius)) {
        swept.add(stroke.id)
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
      swept.clear()
      handlePoint(x, y)
      opts.callbacks.onCursorMove(x, y, opts.radius)
    },
    onPointerMove(e, ctx) {
      if (!active) {
        // Hover: still render the cursor so the user sees where they'll erase.
        const { x, y } = ctx.toBoard(e.clientX, e.clientY)
        opts.callbacks.onCursorMove(x, y, opts.radius)
        return
      }
      const coalesced = e.getCoalescedEvents()
      const events = coalesced.length > 0 ? coalesced : [e]
      for (const ce of events) {
        const { x, y } = ctx.toBoard(ce.clientX, ce.clientY)
        handlePoint(x, y)
      }
      const last = ctx.toBoard(e.clientX, e.clientY)
      opts.callbacks.onCursorMove(last.x, last.y, opts.radius)
    },
    onPointerUp(_e, _ctx) {
      if (!active) return
      active = false
      opts.callbacks.onCursorEnd()
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
