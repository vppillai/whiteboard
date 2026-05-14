/**
 * Shape tool. Drag-to-create vector primitives: rectangle, ellipse, line,
 * arrow. One unified tool with four sub-modes — the sub-mode is sticky
 * (last picked one is restored on tool re-entry) and selectable from the
 * contextual menu or via keyboard shortcuts (R/O/A/L per v1.4 brief).
 *
 * Interaction:
 *   - pointerdown: record the start point; build an in-flight ShapeObject
 *     with `transform.w/h = 0` and the user's sticky color / strokeWidth /
 *     fill defaults.
 *   - pointermove: update transform so the second corner tracks the
 *     pointer. Negative w/h is FINE for line/arrow (encodes direction)
 *     and tolerated for rect/ellipse (renderer normalizes). Shift held:
 *     for rect/ellipse → constrain to square / circle (equal abs(w),
 *     abs(h)); for line/arrow → snap angle to 45° increments. The
 *     in-flight render goes to the LIVE layer; nothing is committed
 *     until pointerup.
 *   - pointerup: if the shape is degenerate (both dimensions below
 *     MIN_BOARD_PX), discard. Otherwise push 'create-shape' op,
 *     persist via deps.saveShape, mark committed dirty. Always clear
 *     the live layer.
 *
 * Why a single tool with sub-modes rather than four tools? The user
 * brief asked for it ("one Shape tool with sub-mode selection") to keep
 * the toolpill compact. The four shapes share 95% of their interaction
 * code (drag → transform encode → commit op); only the in-flight render
 * dispatches on `kind`.
 *
 * Live-layer rendering reuses the same drawing primitives as the
 * committed-layer pass in renderShapes.ts via the `drawInFlightShape`
 * helper there — duplicated logic would risk drift between in-flight
 * preview and final committed look.
 */

import type { ShapeKind, ShapeObject } from '@whiteboard/shared'
import { CURATED_COLORS as PALETTE } from '../colorpicker'
import { makeShapeId } from '../ids'
import {
  iconFillOutline,
  iconFillSolid,
  iconShapeArrow,
  iconShapeEllipse,
  iconShapeLine,
  iconShapeRect,
  iconStrokeWidth,
} from '../menu-icons'
import { paletteGrid, pill, pillRow, sectionLabel, separator, swatch } from '../menu-ui'
import type { Op } from '../ops'
import { applyCamera, clearLayer } from '../render'
import { drawInFlightShape } from '../rendershapes'
import {
  getShapeColor,
  getShapeFillEnabled,
  getShapeFillOpacity,
  getShapeKind,
  getShapeStrokeWidth,
  setShapeColor,
  setShapeFillEnabled,
  setShapeFillOpacity,
  setShapeKind,
  setShapeStrokeWidth,
} from '../settings'
import type { Tool, ToolContext } from './types'

/** Minimum size (board pixels) below which both dimensions count as
 *  degenerate and the in-flight shape is discarded on pointerup. Tap-
 *  without-drag should never leave a 0×0 invisible shape behind. */
const MIN_BOARD_PX = 2

/** Stroke-width options surfaced in the contextual menu (board pixels). */
const STROKE_WIDTH_OPTIONS: readonly number[] = [1, 2, 4, 8]

/** Fill-opacity slider range (clamped to the same bounds the settings
 *  module enforces). Step is fine enough for smooth feel but coarse
 *  enough that the live label reads as a clean two-decimal number. */
const OPACITY_MIN = 0.05
const OPACITY_MAX = 1.0
const OPACITY_STEP = 0.05

interface OpacitySliderDeps {
  get(): number
  set(v: number): void
  disabled: boolean
}

/** Build a labeled opacity slider row. Lives outside renderContextual-
 *  Menu so the Select tool's shape menu can reuse the same widget
 *  (write semantics there: write per-shape via edit-shape op, not the
 *  sticky setting). */
function buildFillOpacitySlider(deps: OpacitySliderDeps): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'whiteboard-tools-row whiteboard-fillopacity-row'

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = String(OPACITY_MIN)
  slider.max = String(OPACITY_MAX)
  slider.step = String(OPACITY_STEP)
  slider.value = String(deps.get())
  slider.className = 'whiteboard-fillopacity-slider'
  slider.disabled = deps.disabled
  slider.setAttribute('aria-label', 'Fill opacity')

  const readout = document.createElement('span')
  readout.className = 'whiteboard-fillopacity-readout'
  const renderValue = (v: number): string => `${Math.round(v * 100)}%`
  readout.textContent = renderValue(deps.get())

  slider.addEventListener('input', () => {
    const v = Number(slider.value)
    deps.set(v)
    readout.textContent = renderValue(v)
  })

  row.appendChild(slider)
  row.appendChild(readout)
  return row
}

/** Shape sub-mode entries for the contextual menu. Order matches the
 *  keymap (R/O/A/L per the v1.4 brief). Each entry carries a label
 *  (becomes the hover tooltip + aria-name), a single-key shortcut
 *  hint, and an icon factory — the right-click pill renders as an
 *  icon and reveals "Rectangle (R)" on hover, per the v1.4 menu-icon
 *  pass. */
const KIND_OPTIONS: readonly {
  id: ShapeKind
  label: string
  shortcut: string
  icon: () => SVGElement
}[] = [
  { id: 'rect', label: 'Rectangle', shortcut: 'R', icon: iconShapeRect },
  { id: 'ellipse', label: 'Ellipse', shortcut: 'O', icon: iconShapeEllipse },
  { id: 'arrow', label: 'Arrow', shortcut: 'A', icon: iconShapeArrow },
  { id: 'line', label: 'Line', shortcut: 'L', icon: iconShapeLine },
]

export interface ShapeToolDeps {
  /** Live in-memory shapes array (mutated by ops). */
  getShapes: () => ShapeObject[]
  /** Next z slot above the current max image / text / shape z. The
   *  shared object-z sequence keeps stacking interleavable. */
  nextZ: () => number
  /** Push an op onto the undo stack. */
  pushOp: (op: Op) => void
  /** Persist a shape record. Same warn-and-continue policy as text. */
  saveShape: (s: ShapeObject) => void
  /** Mark the committed layer dirty (shape render lives there). */
  markCommittedDirty: () => void
  /** Resolve a color token ('ink' / hex) to CSS. Mirrors ToolContext for
   *  use in callsites that don't carry a ToolContext (menu builders). */
  resolveColor: (token: string) => string
}

export interface ShapeTool extends Tool {
  /** Switch the active sub-mode (rect / ellipse / line / arrow). Called
   *  from keyboard shortcuts in main.ts when the tool is already active;
   *  the menu writes via setShapeKind directly. */
  setKind(kind: ShapeKind): void
  /** Currently active sub-mode. Used by the toolpill / status indicator
   *  to show which shape is queued. */
  getKind(): ShapeKind
}

interface DragState {
  shape: ShapeObject
  startBoard: { x: number; y: number }
}

export function createShapeTool(deps: ShapeToolDeps): ShapeTool {
  let drag: DragState | null = null

  /** Snap (dx, dy) to the nearest 45° direction at the same magnitude.
   *  Used for shift-held line/arrow drags. */
  const snap45 = (dx: number, dy: number): { dx: number; dy: number } => {
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) return { dx: 0, dy: 0 }
    const angle = Math.atan2(dy, dx)
    const step = Math.PI / 4
    const snapped = Math.round(angle / step) * step
    return { dx: Math.cos(snapped) * len, dy: Math.sin(snapped) * len }
  }

  /** Build a fresh ShapeObject at `start` with current sticky defaults. */
  const buildShape = (start: { x: number; y: number }): ShapeObject => {
    const color = getShapeColor()
    const fillEnabled = getShapeFillEnabled()
    return {
      id: makeShapeId(),
      shape: getShapeKind(),
      transform: { x: start.x, y: start.y, w: 0, h: 0 },
      color,
      strokeWidth: getShapeStrokeWidth(),
      // Fill token = stroke color; the renderer applies a translucent
      // alpha so the shape reads as a tint behind the outline. Lines
      // and arrows never carry a fill in v1 — the field is ignored
      // by their draw paths but we still record it for round-trip
      // consistency across kinds (a future "convert kind" op shouldn't
      // need to recompute style).
      fill: fillEnabled ? color : undefined,
      // Snapshot the sticky opacity at creation so future slider
      // changes don't retroactively re-tint existing shapes — each
      // shape keeps the opacity it was drawn with.
      fillOpacity: fillEnabled ? getShapeFillOpacity() : undefined,
      z: deps.nextZ(),
      createdAt: Date.now(),
    }
  }

  /** Re-render the in-flight shape on the live layer. Called per
   *  pointermove. Camera is applied at the start so the same world-
   *  space coordinates produce the same visible position as the
   *  committed render. */
  const redrawLive = (ctx: ToolContext): void => {
    clearLayer(ctx.liveLayer)
    if (!drag) return
    applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
    drawInFlightShape(ctx.liveLayer.ctx, drag.shape, ctx.resolveColor)
  }

  return {
    id: 'shape',
    cursor: 'crosshair',

    onPointerDown(e, ctx) {
      const start = ctx.toBoard(e.clientX, e.clientY)
      drag = { shape: buildShape(start), startBoard: start }
      redrawLive(ctx)
    },

    onPointerMove(e, ctx) {
      if (!drag) return
      const cur = ctx.toBoard(e.clientX, e.clientY)
      let dx = cur.x - drag.startBoard.x
      let dy = cur.y - drag.startBoard.y
      if (e.shiftKey) {
        if (drag.shape.shape === 'rect' || drag.shape.shape === 'ellipse') {
          // Constrain to square / circle: equal magnitude, preserve sign.
          const m = Math.max(Math.abs(dx), Math.abs(dy))
          dx = Math.sign(dx || 1) * m
          dy = Math.sign(dy || 1) * m
        } else {
          // line / arrow: snap angle to 45° increments at same length.
          const snapped = snap45(dx, dy)
          dx = snapped.dx
          dy = snapped.dy
        }
      }
      drag.shape.transform.w = dx
      drag.shape.transform.h = dy
      redrawLive(ctx)
    },

    onPointerUp(_e, ctx) {
      if (!drag) return
      const { w, h } = drag.shape.transform
      const tooSmall = Math.abs(w) < MIN_BOARD_PX && Math.abs(h) < MIN_BOARD_PX
      clearLayer(ctx.liveLayer)
      if (tooSmall) {
        drag = null
        return
      }
      // Commit: push the shape into the live shapes array, persist,
      // emit the create op for undo.
      deps.getShapes().push(drag.shape)
      deps.saveShape(drag.shape)
      deps.pushOp({ kind: 'create-shape', shapeId: drag.shape.id })
      deps.markCommittedDirty()
      drag = null
    },

    redraw(ctx) {
      // Camera changed mid-drag: re-render the in-flight preview at the
      // new transform. drag is null between gestures, in which case
      // redrawLive just clears the live layer.
      redrawLive(ctx)
    },

    renderContextualMenu(host, dismiss) {
      // Section order (per the v1.4 user brief):
      //   Color (swatch) → Shape sub-mode → Stroke width → Fill toggle
      //   → Fill opacity (only when fill is enabled)
      // Color first matches the user's "shapes below swatch" feedback.

      // ── Color ───────────────────────────────────────────────────
      host.appendChild(sectionLabel('Color'))
      const palette = paletteGrid()
      const activeColor = getShapeColor()
      for (const c of PALETTE) {
        palette.appendChild(
          swatch({
            color: c,
            active: activeColor === c,
            onClick: () => {
              setShapeColor(c)
              dismiss()
            },
          }),
        )
      }
      host.appendChild(palette)

      host.appendChild(separator())

      // ── Sub-mode picker (icons + hover tooltip) ─────────────────
      host.appendChild(sectionLabel('Shape'))
      const kindRow = pillRow()
      const activeKind = getShapeKind()
      for (const opt of KIND_OPTIONS) {
        kindRow.appendChild(
          pill({
            label: opt.label,
            icon: opt.icon(),
            shortcut: opt.shortcut,
            active: activeKind === opt.id,
            onClick: () => {
              setShapeKind(opt.id)
              dismiss()
            },
          }),
        )
      }
      host.appendChild(kindRow)

      host.appendChild(separator())

      // ── Stroke width (icon = line at corresponding thickness) ───
      host.appendChild(sectionLabel('Stroke width'))
      const widthRow = pillRow()
      const activeWidth = getShapeStrokeWidth()
      for (const w of STROKE_WIDTH_OPTIONS) {
        widthRow.appendChild(
          pill({
            label: `${w}px`,
            icon: iconStrokeWidth(w),
            active: activeWidth === w,
            onClick: () => {
              setShapeStrokeWidth(w)
              dismiss()
            },
          }),
        )
      }
      host.appendChild(widthRow)

      host.appendChild(separator())

      // ── Fill toggle (outline / filled icons) ────────────────────
      // Outline-only by default; toggling on tints the interior at the
      // sticky `shapeFillOpacity` (default 0.25). Lines / arrows don't
      // visually carry fill — the toggle is still shown so the setting
      // survives sub-mode switches (the v1.4 "no clutter" brief).
      host.appendChild(sectionLabel('Fill'))
      const fillRow = pillRow()
      const fillOn = getShapeFillEnabled()
      fillRow.appendChild(
        pill({
          label: 'Outline only',
          icon: iconFillOutline(),
          active: !fillOn,
          onClick: () => {
            setShapeFillEnabled(false)
            dismiss()
          },
        }),
      )
      fillRow.appendChild(
        pill({
          label: 'Filled',
          icon: iconFillSolid(),
          active: fillOn,
          onClick: () => {
            setShapeFillEnabled(true)
            dismiss()
          },
        }),
      )
      host.appendChild(fillRow)

      // ── Fill opacity slider (only meaningful when filled) ───────
      // Affects newly-drawn shapes (each shape snapshots the sticky
      // opacity at creation; the slider doesn't retroactively re-tint
      // existing shapes). When fill is off, the slider is disabled so
      // the user sees the control exists but it has no effect right now.
      host.appendChild(sectionLabel('Fill opacity'))
      const opacityRow = buildFillOpacitySlider({
        get: getShapeFillOpacity,
        set: setShapeFillOpacity,
        disabled: !fillOn,
      })
      host.appendChild(opacityRow)
    },

    setKind(kind) {
      setShapeKind(kind)
    },

    getKind() {
      return getShapeKind()
    },

    cleanup() {
      // Switching tools mid-drag: discard in-flight shape. Nothing has
      // been pushed to the shapes array or to undo yet, so cleanup is a
      // simple state reset.
      drag = null
    },
  }
}
