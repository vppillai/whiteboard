/**
 * Eraser tool. Stroke-hit erasing — operates on whole strokes via the
 * `Stroke.deleted` soft-delete flag (ADR 0006); never splits stroke geometry.
 *
 * Two modes, locked at pointerdown:
 *
 *   - **Wipe** (default): drag-through. Each stroke the eraser passes over
 *     is **immediately soft-deleted** so the user sees it vanish in real
 *     time — that's what makes a wipe feel like a wipe rather than an
 *     end-of-gesture batch action. The accumulated stroke ids are still
 *     emitted as **one** delete op at pointerup so a single Cmd+Z brings
 *     the whole sweep back. The op's apply is idempotent on already-deleted
 *     strokes (no double-flip), so undo / redo work cleanly.
 *
 *   - **Object**: a single tap deletes the **topmost** stroke under the
 *     cursor (and only that one). Selected as a top-level option from the
 *     right-click menu, OR temporarily activated by holding Shift at
 *     pointerdown when in Wipe mode.
 *
 * The cursor visual differentiates the modes — wipe is just the red circle,
 * object adds a small filled center dot (target reticle).
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
import type { Tool, ToolContext } from './types'

/** Visual / behavioral mode at the moment of an eraser gesture. */
export type EraserGestureMode = 'wipe' | 'object'

export interface EraserToolCallbacks {
  /** Returns the live strokes list. Called on each hit-test. */
  getStrokes: () => readonly Stroke[]
  /** Emit a delete op for the swept strokes. Called once per gesture. */
  onErase: (strokeIds: string[]) => void
}

export interface EraserToolOptions {
  callbacks: EraserToolCallbacks
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

export function createEraserTool(opts: EraserToolOptions): Tool {
  const swept = new Set<string>()
  let active = false
  let mode: EraserGestureMode = 'wipe'

  const radius = (): number => ERASER_RADII[getEraserSize()]

  /** Wipe-mode hit: accumulate every match within tolerance AND immediately
   *  soft-delete each newly-hit stroke so the user sees it vanish under the
   *  eraser. Returns true if anything new was hit (caller marks committed
   *  dirty if so). */
  const sweepHit = (px: number, py: number): boolean => {
    let hitSomething = false
    for (const stroke of opts.callbacks.getStrokes()) {
      if (stroke.deleted) continue
      if (swept.has(stroke.id)) continue
      if (strokeNearPoint(stroke, px, py, radius())) {
        swept.add(stroke.id)
        stroke.deleted = true
        hitSomething = true
      }
    }
    return hitSomething
  }

  const objectHit = (px: number, py: number): boolean => {
    const strokes = opts.callbacks.getStrokes()
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i]
      if (!stroke || stroke.deleted || swept.has(stroke.id)) continue
      if (strokeNearPoint(stroke, px, py, radius())) {
        swept.add(stroke.id)
        stroke.deleted = true
        return true
      }
    }
    return false
  }

  const renderCursor = (
    boardX: number,
    boardY: number,
    gestureMode: EraserGestureMode,
    ctx: ToolContext,
  ): void => {
    clearLayer(ctx.liveLayer)
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

  const cancel = (): void => {
    active = false
    swept.clear()
  }

  return {
    id: 'eraser',
    cursor: 'none',

    onPointerDown(e, ctx) {
      const { x, y } = ctx.toBoard(e.clientX, e.clientY)
      active = true
      // Configured default mode, with Shift always overriding to item.
      const wantItem = e.shiftKey || getEraserMode() === 'item'
      mode = wantItem ? 'object' : 'wipe'
      swept.clear()
      if (mode === 'wipe') {
        if (sweepHit(x, y)) ctx.markCommittedDirty()
      }
      renderCursor(x, y, mode, ctx)
    },

    onPointerMove(e, ctx) {
      if (!active) {
        // Hover: cursor reflects the *prospective* mode (Shift override + setting).
        const { x, y } = ctx.toBoard(e.clientX, e.clientY)
        const previewItem = e.shiftKey || getEraserMode() === 'item'
        renderCursor(x, y, previewItem ? 'object' : 'wipe', ctx)
        return
      }
      if (mode === 'wipe') {
        const coalesced = e.getCoalescedEvents()
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
      }
      if (swept.size > 0) opts.callbacks.onErase([...swept])
      swept.clear()
      // Clear cursor since the gesture is over; hover render will reappear on
      // the next pointermove.
      clearLayer(ctx.liveLayer)
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

    cleanup: cancel,
  }
}

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
