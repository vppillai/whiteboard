/**
 * Pen tool. The only tool that exists in M1.4; eraser / lasso / laser / text
 * land at later milestones as separate `Tool` implementations.
 *
 * Behavior carried over from the pre-tool-abstraction `pointer.ts`:
 *
 *   - getCoalescedEvents() to consume every Wacom sample between frames.
 *   - getPredictedEvents() (gated by `usePrediction`) for visual lookahead.
 *   - γ-curve applied to raw pressure before the sample is recorded.
 */

import type { BrushConfig, Sample, Stroke } from '@whiteboard/shared'
import type { Tool, ToolContext } from './types'

export interface PenToolCallbacks {
  onStrokeStart: (stroke: Stroke) => void
  /**
   * Called once per pointermove. `predicted` is replaced each event; do not
   * retain references across calls. `renderAsFinal` is true when the
   * in-flight stroke should be rendered with `last: true` (e.g. shift-
   * constrained mode where the stroke is a finished straight line). For
   * normal freeform drawing, false — the renderer keeps the last cap open.
   */
  onStrokeUpdate: (stroke: Stroke, predicted: Sample[], renderAsFinal: boolean) => void
  onStrokeCommit: (stroke: Stroke) => void
  /** Hover (no contact) — board coordinates. Used to render brush preview. */
  onHoverMove?: (boardX: number, boardY: number) => void
  /** Hover ended (pointerleave or stroke begin). */
  onHoverEnd?: () => void
}

export interface PenToolOptions {
  callbacks: PenToolCallbacks
  /**
   * Whether to feed predicted events into the live render. False is correct
   * for indirect input (Wacom Intuos non-screen) where the predicted ink
   * leads the cursor and visibly flickers when the pen changes direction.
   * See ADR 0004.
   */
  usePrediction?: boolean
}

interface SampleSource {
  clientX: number
  clientY: number
  pressure: number
  tiltX?: number
  tiltY?: number
  timeStamp: number
}

export function createPenTool(opts: PenToolOptions): Tool {
  let active: Stroke | null = null

  const sample = (e: SampleSource, brush: BrushConfig, ctx: ToolContext): Sample => {
    const { x, y } = ctx.toBoard(e.clientX, e.clientY)
    return {
      x,
      y,
      p: applyGamma(e.pressure, brush.pressureGamma),
      tx: e.tiltX,
      ty: e.tiltY,
      t: e.timeStamp,
    }
  }

  const cancel = (): void => {
    active = null
  }

  return {
    id: 'pen',
    cursor: 'crosshair',
    onPointerDown(e, ctx) {
      const brush = ctx.getBrush()
      active = {
        id: makeId(),
        brush,
        samples: [sample(e, brush, ctx)],
        startedAt: e.timeStamp,
      }
      // Hide hover preview; the live stroke render takes its place.
      opts.callbacks.onHoverEnd?.()
      opts.callbacks.onStrokeStart(active)
    },
    onPointerMove(e, ctx) {
      if (!active) {
        // Hover (or any non-contact movement). Render brush preview at cursor.
        if (opts.callbacks.onHoverMove) {
          const { x, y } = ctx.toBoard(e.clientX, e.clientY)
          opts.callbacks.onHoverMove(x, y)
        }
        return
      }
      const brush = active.brush

      // Shift-constrained mode: stroke is a straight line from the start
      // sample to wherever the cursor is now. Holding Shift mid-stroke "snaps"
      // the in-flight stroke to a straight line; releasing Shift returns to
      // freeform from the current position, building on whatever samples are
      // already present.
      //
      // Render as final (last:true) so the cap shows up at the cursor in real
      // time, not just at commit. Otherwise the visible line stops a few
      // pixels short of the cursor (perfect-freehand's open-end smoothing).
      if (e.shiftKey) {
        const first = active.samples[0]
        if (first) {
          active.samples = [first, sample(e, brush, ctx)]
          opts.callbacks.onStrokeUpdate(active, [], true)
        }
        return
      }

      const coalesced = e.getCoalescedEvents()
      if (coalesced.length === 0) {
        active.samples.push(sample(e, brush, ctx))
      } else {
        for (const ce of coalesced) active.samples.push(sample(ce, brush, ctx))
      }
      const predicted = opts.usePrediction
        ? e.getPredictedEvents().map((pe) => sample(pe, brush, ctx))
        : []
      opts.callbacks.onStrokeUpdate(active, predicted, false)
    },
    onPointerUp(_e, _ctx) {
      if (!active) return
      opts.callbacks.onStrokeCommit(active)
      active = null
    },
    cleanup: cancel,
  }
}

function applyGamma(p: number, gamma: number): number {
  if (p <= 0 || gamma === 1) return p
  return p ** gamma
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
