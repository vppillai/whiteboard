/**
 * Lasso tool. Free-form polygon selection + move + delete.
 *
 * Phases (state machine driven by pointer + keyboard):
 *   - **idle** — selection may exist; nothing being drawn or dragged.
 *   - **lasso** — pointerdown started a polygon; pointermove appends
 *     points; pointerup either closes the polygon (drag) or treats it as
 *     a tap on a single stroke.
 *   - **moving** — pointerdown started inside the existing selection's
 *     union bbox; pointermove translates the selection visually (live
 *     layer ghost-render); pointerup emits a single `move` op.
 *
 * Selection persists across tool switches — common pattern in design
 * tools — and across non-destructive ops. Deleting clears the selection
 * because the selected strokes are gone.
 *
 * Visualization:
 *   - Per-stroke **halo** — the perfect-freehand outline traced with a
 *     wider stroke + accent color, drawn on the live layer.
 *   - **Bounding-box outline** — dashed rectangle around the selection
 *     union. Static (no marching-ants animation in v1; that would force
 *     a live redraw every frame, breaking the dirty-driven render loop).
 *   - **In-progress polygon** — dashed outline + translucent fill
 *     during a lasso draw.
 *
 * Renderer integration: lasso exposes `getDragState()` so the orchestrator
 * can skip dragging strokes from the offscreen strokes pass and let
 * `redraw()` paint them on live at offset (the same hook pattern the
 * eraser uses for in-flight wipe stamps via `getPendingStamps()`).
 */

import type { Stroke } from '@whiteboard/shared'
import { pill, pillRow, sectionLabel } from '../menu-ui'
import { applyCamera, clearLayer } from '../render'
import { type BBox, getStrokeBBox, getStrokePath } from '../stroke'
import type { Tool, ToolContext } from './types'

const TAP_THRESHOLD_PX = 5
const TAP_HIT_TOLERANCE_PX = 8
const HALO_WIDTH_PX = 4
const SELECTION_COLOR = 'rgba(59, 130, 246, 0.85)' // accent blue
const POLYGON_FILL = 'rgba(59, 130, 246, 0.12)'

/**
 * Custom SVG cursor: a dashed oval (the lasso loop) with a short tail
 * down-and-right to the click point. Hotspot at the tail tip (17, 22).
 * Stroke uses the same accent blue as the selection halo + a white outer
 * outline so the cursor stays legible on both light and dark themes
 * without needing JS to swap variants.
 *
 * SVG sizing: 24x24 native cursor box. Bigger than the 16x16 default but
 * still small enough that browsers don't downsample. Single quotes inside
 * the SVG so the data URI can use double quotes; `%23` for `#` in colors.
 */
const LASSO_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<ellipse cx='10' cy='8' rx='7' ry='4.5' fill='none' stroke='white' stroke-width='3' stroke-dasharray='2.5 1.8'/>" +
  "<line x1='10' y1='12.5' x2='15' y2='21' stroke='white' stroke-width='3' stroke-linecap='round'/>" +
  "<ellipse cx='10' cy='8' rx='7' ry='4.5' fill='none' stroke='%233b82f6' stroke-width='1.5' stroke-dasharray='2.5 1.8'/>" +
  "<line x1='10' y1='12.5' x2='15' y2='21' stroke='%233b82f6' stroke-width='1.5' stroke-linecap='round'/>" +
  '</svg>") 15 21, crosshair'

export interface LassoToolCallbacks {
  /** Returns the live strokes list. Called on selection / hit-test. */
  getStrokes: () => readonly Stroke[]
  /** Emit a `delete` op for the given stroke ids. */
  onDelete: (strokeIds: string[]) => void
  /** Emit a `move` op translating the given strokes by `(dx, dy)`. */
  onMove: (strokeIds: string[], dx: number, dy: number) => void
}

export interface LassoToolOptions {
  callbacks: LassoToolCallbacks
}

export interface DragState {
  ids: ReadonlySet<string>
  dx: number
  dy: number
}

/**
 * Lasso extends `Tool` with selection + drag-state introspection so the
 * orchestrator can wire keyboard shortcuts (`Delete`, `⌘A`) and the
 * render loop can skip dragging strokes from the offscreen pass.
 */
export interface LassoTool extends Tool {
  hasSelection(): boolean
  deleteSelection(): boolean
  selectAll(): void
  clearSelection(): void
  /** Stroke IDs being live-moved during a drag, plus the current offset.
   *  `null` when not dragging. */
  getDragState(): DragState | null
}

type Phase = 'idle' | 'lasso' | 'moving'
interface Point {
  x: number
  y: number
}

export function createLassoTool(opts: LassoToolOptions): LassoTool {
  const selection = new Set<string>()
  let phase: Phase = 'idle'
  let polygon: Point[] = []
  let dragStart: Point | null = null
  let dragCurrent: Point | null = null

  // -----------------------------------------------------------------
  //  Geometry helpers
  // -----------------------------------------------------------------

  const dist2 = (a: Point, b: Point): number => {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return dx * dx + dy * dy
  }

  /** Union AABB of currently selected strokes (in their current positions),
   *  or `null` if the selection is empty. */
  const selectionBBox = (): BBox | null => {
    if (selection.size === 0) return null
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const stroke of opts.callbacks.getStrokes()) {
      if (!selection.has(stroke.id) || stroke.deleted) continue
      const bb = getStrokeBBox(stroke)
      if (bb.minX < minX) minX = bb.minX
      if (bb.minY < minY) minY = bb.minY
      if (bb.maxX > maxX) maxX = bb.maxX
      if (bb.maxY > maxY) maxY = bb.maxY
    }
    if (minX === Number.POSITIVE_INFINITY) return null
    return { minX, minY, maxX, maxY }
  }

  const isInSelectionBBox = (px: number, py: number): boolean => {
    const bb = selectionBBox()
    if (!bb) return false
    return px >= bb.minX && px <= bb.maxX && py >= bb.minY && py <= bb.maxY
  }

  /** Standard ray-casting point-in-polygon. */
  const pointInPolygon = (px: number, py: number, poly: readonly Point[]): boolean => {
    let inside = false
    let j = poly.length - 1
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[j]
      if (!a || !b) continue
      if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside
      }
      j = i
    }
    return inside
  }

  /** Single-stroke hit test: topmost stroke whose any sample is within
   *  `tolerance` of the tap point. */
  const findStrokeAt = (px: number, py: number, tolerance: number): Stroke | null => {
    const tol2 = tolerance * tolerance
    const strokes = opts.callbacks.getStrokes()
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i]
      if (!stroke || stroke.deleted) continue
      const bb = getStrokeBBox(stroke)
      if (
        px < bb.minX - tolerance ||
        px > bb.maxX + tolerance ||
        py < bb.minY - tolerance ||
        py > bb.maxY + tolerance
      ) {
        continue
      }
      for (const s of stroke.samples) {
        const dx = s.x - px
        const dy = s.y - py
        if (dx * dx + dy * dy <= tol2) return stroke
      }
    }
    return null
  }

  const selectByPolygon = (poly: readonly Point[]): void => {
    selection.clear()
    if (poly.length < 3) return
    for (const stroke of opts.callbacks.getStrokes()) {
      if (stroke.deleted) continue
      for (const s of stroke.samples) {
        if (pointInPolygon(s.x, s.y, poly)) {
          selection.add(stroke.id)
          break
        }
      }
    }
  }

  // -----------------------------------------------------------------
  //  Render
  // -----------------------------------------------------------------

  const renderOverlay = (ctx: ToolContext): void => {
    clearLayer(ctx.liveLayer)
    applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
    const c = ctx.liveLayer.ctx
    const scale = ctx.camera.scale

    // Selection halos + bbox.
    if (selection.size > 0) {
      const dragOffset =
        phase === 'moving' && dragStart && dragCurrent
          ? { dx: dragCurrent.x - dragStart.x, dy: dragCurrent.y - dragStart.y }
          : null

      c.save()
      if (dragOffset) c.translate(dragOffset.dx, dragOffset.dy)
      c.strokeStyle = SELECTION_COLOR
      c.lineWidth = HALO_WIDTH_PX / scale
      c.lineJoin = 'round'
      c.lineCap = 'round'
      for (const stroke of opts.callbacks.getStrokes()) {
        if (!selection.has(stroke.id) || stroke.deleted) continue
        const path = getStrokePath(stroke, [], true)
        if (!path) continue
        c.stroke(path)
      }
      c.restore()

      const bb = selectionBBox()
      if (bb) {
        c.save()
        if (dragOffset) c.translate(dragOffset.dx, dragOffset.dy)
        c.strokeStyle = SELECTION_COLOR
        c.lineWidth = 1 / scale
        c.setLineDash([6 / scale, 4 / scale])
        c.strokeRect(bb.minX, bb.minY, bb.maxX - bb.minX, bb.maxY - bb.minY)
        c.restore()
      }
    }

    // In-progress lasso polygon.
    if (phase === 'lasso' && polygon.length > 1) {
      c.save()
      c.strokeStyle = SELECTION_COLOR
      c.fillStyle = POLYGON_FILL
      c.lineWidth = 1.5 / scale
      c.setLineDash([6 / scale, 4 / scale])
      c.beginPath()
      const first = polygon[0]
      if (!first) {
        c.restore()
        return
      }
      c.moveTo(first.x, first.y)
      for (let i = 1; i < polygon.length; i++) {
        const p = polygon[i]
        if (p) c.lineTo(p.x, p.y)
      }
      c.closePath()
      c.fill()
      c.stroke()
      c.restore()
    }
  }

  // -----------------------------------------------------------------
  //  Tool implementation
  // -----------------------------------------------------------------

  return {
    id: 'lasso',
    cursor: LASSO_CURSOR,

    onPointerDown(e, ctx) {
      const { x, y } = ctx.toBoard(e.clientX, e.clientY)
      if (selection.size > 0 && isInSelectionBBox(x, y)) {
        // Drag inside the selection bbox = move all selected strokes.
        phase = 'moving'
        dragStart = { x, y }
        dragCurrent = { x, y }
      } else {
        // Empty space (or outside selection) = start a fresh lasso polygon.
        // Don't clear `selection` yet — it's only cleared on a successful
        // re-selection at pointerup, so a quick mis-click doesn't blow it
        // away. (Tap with no hit deselects via `selectByPolygon` /
        // `findStrokeAt` clearing.)
        phase = 'lasso'
        polygon = [{ x, y }]
      }
      ctx.markCommittedDirty()
    },

    onPointerMove(e, ctx) {
      const { x, y } = ctx.toBoard(e.clientX, e.clientY)
      if (phase === 'lasso') {
        polygon.push({ x, y })
        renderOverlay(ctx)
      } else if (phase === 'moving' && dragStart) {
        dragCurrent = { x, y }
        // Skip the moving strokes from committed pass + repaint live ghost.
        ctx.markCommittedDirty()
      } else {
        // Hover with selection visible — nothing to update.
      }
    },

    onPointerUp(e, ctx) {
      const { x, y } = ctx.toBoard(e.clientX, e.clientY)

      if (phase === 'lasso') {
        const start = polygon[0]
        const isTap =
          start !== undefined && dist2(start, { x, y }) <= TAP_THRESHOLD_PX * TAP_THRESHOLD_PX
        if (isTap) {
          // Tap = single-stroke select (or deselect if hit nothing).
          const hit = findStrokeAt(x, y, TAP_HIT_TOLERANCE_PX)
          selection.clear()
          if (hit) selection.add(hit.id)
        } else {
          // Drag = polygon select.
          selectByPolygon(polygon)
        }
        polygon = []
        phase = 'idle'
        ctx.markCommittedDirty()
      } else if (phase === 'moving' && dragStart && dragCurrent) {
        const dx = dragCurrent.x - dragStart.x
        const dy = dragCurrent.y - dragStart.y
        if (dx !== 0 || dy !== 0) {
          opts.callbacks.onMove([...selection], dx, dy)
        }
        phase = 'idle'
        dragStart = null
        dragCurrent = null
        ctx.markCommittedDirty()
      }
    },

    redraw(ctx) {
      renderOverlay(ctx)
    },

    renderContextualMenu(host, dismiss) {
      host.appendChild(sectionLabel(`Selection (${selection.size})`))
      const row = pillRow()
      const empty = selection.size === 0
      row.appendChild(
        pill({
          label: 'Delete',
          title: 'Delete the selected strokes',
          active: false,
          disabled: empty,
          onClick: () => {
            if (selection.size > 0) {
              opts.callbacks.onDelete([...selection])
              selection.clear()
            }
            dismiss()
          },
        }),
      )
      row.appendChild(
        pill({
          label: 'Clear',
          title: 'Deselect',
          active: false,
          disabled: empty,
          onClick: () => {
            selection.clear()
            dismiss()
          },
        }),
      )
      host.appendChild(row)
    },

    cleanup: () => {
      // Selection persists across tool switches (common pattern in design
      // tools), but in-flight gestures are abandoned cleanly.
      phase = 'idle'
      polygon = []
      dragStart = null
      dragCurrent = null
    },

    hasSelection: () => selection.size > 0,

    deleteSelection: () => {
      if (selection.size === 0) return false
      opts.callbacks.onDelete([...selection])
      selection.clear()
      return true
    },

    selectAll: () => {
      selection.clear()
      for (const stroke of opts.callbacks.getStrokes()) {
        if (stroke.deleted) continue
        selection.add(stroke.id)
      }
    },

    clearSelection: () => {
      selection.clear()
    },

    getDragState: () => {
      if (phase !== 'moving' || !dragStart || !dragCurrent) return null
      return {
        ids: selection,
        dx: dragCurrent.x - dragStart.x,
        dy: dragCurrent.y - dragStart.y,
      }
    },
  }
}
