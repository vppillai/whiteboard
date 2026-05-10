/**
 * Pen / drawing tool. The only tool that produces strokes; eraser, lasso,
 * laser, text are separate `Tool` implementations.
 *
 * Owns:
 *   - The in-flight stroke (samples, predicted lookahead, render-as-final flag).
 *   - Live-layer rendering — both the wet ink during a stroke and the hover
 *     preview between strokes. The hover preview shape varies per brush so the
 *     user sees what they're about to draw.
 *   - The COLOR + BRUSH sections of the right-click menu.
 *
 * Behavior carried over from earlier iterations (see ADR 0004 / M0):
 *   - `getCoalescedEvents()` for full Wacom 200 Hz sampling.
 *   - `getPredictedEvents()` (gated by `usePrediction`) for visual lookahead.
 *   - γ-curve applied to raw pressure before the sample is recorded.
 *   - Shift-constrained drawing: stroke snaps to a straight line from
 *     pointerdown to current cursor; rendered with `last: true` so the cap
 *     shows live (no gap between line end and cursor).
 */

import type { BrushConfig, Sample, Stroke } from '@whiteboard/shared'
import { BRUSH_IDS, BRUSH_LABELS, BRUSH_PRESETS } from '../brushes'
import { boardToScreen } from '../camera'
import { paletteGrid, pill, pillRow, sectionLabel, separator, swatch } from '../menu-ui'
import { applyCamera, clearLayer, drawStrokePath } from '../render'
import { getBrushId, getColor, setBrushId, setColor } from '../settings'
import { applyPressure, effectiveOpacity, getStrokePath } from '../stroke'
import type { Tool, ToolContext } from './types'

// Finder halo: constant screen-px ring drawn around the hover preview when
// the brush's effective radius falls below the threshold in screen pixels.
// Small brushes (pen / pencil) and any brush at low zoom otherwise leave
// the cursor invisible on Wacom Intuos (indirect input — user is looking
// at the screen, not the pen). The halo gives a consistent locator without
// lying about brush size.
const HOVER_HALO_RADIUS_PX = 11
const HOVER_HALO_THRESHOLD_PX = 4
const HOVER_HALO_ALPHA = 0.35

export interface PenToolCallbacks {
  /** Stroke finalized at pointerup. Caller pushes it to the strokes array
   *  and emits the create op. */
  onStrokeCommit: (stroke: Stroke) => void
}

export interface PenToolOptions {
  callbacks: PenToolCallbacks
  /** When false, `getPredictedEvents()` is ignored. */
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

const PALETTE: readonly string[] = [
  'ink',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#6b7280',
]

export function createPenTool(opts: PenToolOptions): Tool {
  let active: Stroke | null = null
  let predicted: Sample[] = []
  let renderAsFinal = false
  // Last cursor position painted as a hover preview. Cached so `redraw()`
  // can repaint after the render loop clears the live layer (settings
  // change, theme change, undo) — without it the brush cursor would blink
  // off until the next pointermove.
  let lastHover: { x: number; y: number } | null = null

  const sample = (e: SampleSource, brush: BrushConfig, ctx: ToolContext): Sample => {
    const { x, y } = ctx.toBoard(e.clientX, e.clientY)
    return {
      x,
      y,
      p: applyPressure(e.pressure, brush),
      tx: e.tiltX,
      ty: e.tiltY,
      t: e.timeStamp,
    }
  }

  const renderStroke = (ctx: ToolContext): void => {
    if (!active) return
    clearLayer(ctx.liveLayer)
    applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
    const path = getStrokePath(active, predicted, renderAsFinal)
    if (path) {
      drawStrokePath(
        ctx.liveLayer,
        path,
        ctx.resolveColor(active.brush.color),
        effectiveOpacity(active),
      )
    }
  }

  const renderHover = (boardX: number, boardY: number, ctx: ToolContext): void => {
    const brushId = getBrushId()
    const preset = BRUSH_PRESETS[brushId]
    clearLayer(ctx.liveLayer)
    applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
    const c = ctx.liveLayer.ctx
    c.save()
    c.fillStyle = ctx.resolveColor(getColor())
    if (brushId === 'highlighter') {
      c.globalAlpha = 0.45
      const w = preset.size
      const h = Math.max(2, preset.size * 0.4)
      c.fillRect(boardX - w / 2, boardY - h / 2, w, h)
    } else if (brushId === 'brush') {
      c.globalAlpha = 0.5
      c.beginPath()
      c.arc(boardX, boardY, preset.size / 2, 0, Math.PI * 2)
      c.fill()
      c.globalAlpha = 0.18
      c.beginPath()
      c.arc(boardX, boardY, preset.size * 0.85, 0, Math.PI * 2)
      c.fill()
    } else if (brushId === 'marker') {
      c.globalAlpha = 0.7
      c.beginPath()
      c.arc(boardX, boardY, preset.size / 2, 0, Math.PI * 2)
      c.fill()
    } else if (brushId === 'pencil') {
      c.globalAlpha = 0.4
      c.beginPath()
      c.arc(boardX, boardY, preset.size / 2, 0, Math.PI * 2)
      c.fill()
    } else {
      c.globalAlpha = 0.5
      c.beginPath()
      c.arc(boardX, boardY, preset.size / 2, 0, Math.PI * 2)
      c.fill()
    }
    c.restore()

    // Halo (gated): screen-coords ring so the cursor is locatable when the
    // brush is sub-finder-sized. preset.size / 2 is a coarse "visible radius"
    // proxy — close enough for the gate; brush's wider soft halo and
    // highlighter's chisel half-width fall slightly above their own
    // brush-shape extents, so the gate trips a touch eagerly on those, which
    // is fine because the ring is faint by design.
    const screenRadius = (preset.size / 2) * ctx.camera.scale
    if (screenRadius < HOVER_HALO_THRESHOLD_PX) {
      const screen = boardToScreen(ctx.camera, boardX, boardY)
      c.save()
      c.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0)
      c.globalAlpha = HOVER_HALO_ALPHA
      c.strokeStyle = ctx.resolveColor(getColor())
      c.lineWidth = 1
      c.beginPath()
      c.arc(screen.x, screen.y, HOVER_HALO_RADIUS_PX, 0, Math.PI * 2)
      c.stroke()
      c.restore()
    }
  }

  const cancel = (): void => {
    active = null
    predicted = []
    renderAsFinal = false
    lastHover = null
  }

  return {
    id: 'pen',
    // OS cursor hidden — the per-brush hover preview drawn on the live
    // layer in `renderHover` (filled circle / chisel rect / soft halo) is
    // the cursor. Showing both stacks two indicators on the same spot.
    cursor: 'none',

    onPointerDown(e, ctx) {
      const brush = ctx.getBrush()
      active = {
        id: makeId(),
        brush,
        samples: [sample(e, brush, ctx)],
        startedAt: e.timeStamp,
      }
      predicted = []
      renderAsFinal = false
      renderStroke(ctx)
    },

    onPointerMove(e, ctx) {
      const board = ctx.toBoard(e.clientX, e.clientY)
      lastHover = board
      if (!active) {
        // Hover render — brush preview at cursor.
        renderHover(board.x, board.y, ctx)
        return
      }
      const brush = active.brush

      // Shift-constrained: snap to straight line from start sample to current
      // cursor; render as final so the cap appears live, not at commit.
      if (e.shiftKey) {
        const first = active.samples[0]
        if (first) {
          active.samples = [first, sample(e, brush, ctx)]
          predicted = []
          renderAsFinal = true
          renderStroke(ctx)
        }
        return
      }

      const coalesced = e.getCoalescedEvents?.() ?? []
      if (coalesced.length === 0) {
        active.samples.push(sample(e, brush, ctx))
      } else {
        for (const ce of coalesced) active.samples.push(sample(ce, brush, ctx))
      }
      predicted = opts.usePrediction
        ? (e.getPredictedEvents?.() ?? []).map((pe) => sample(pe, brush, ctx))
        : []
      renderAsFinal = false
      renderStroke(ctx)
    },

    onPointerUp(_e, _ctx) {
      if (!active) return
      opts.callbacks.onStrokeCommit(active)
      cancel()
    },

    redraw(ctx) {
      // Camera change, theme change, settings change (e.g. brush switch),
      // undo: re-render in-flight stroke OR hover preview so the live layer
      // is never visually empty between pointer events.
      if (active) {
        renderStroke(ctx)
      } else if (lastHover) {
        renderHover(lastHover.x, lastHover.y, ctx)
      }
    },

    renderContextualMenu(host, dismiss) {
      // COLOR section.
      host.appendChild(sectionLabel('Color'))
      const palette = paletteGrid()
      for (const c of PALETTE) {
        palette.appendChild(
          swatch({
            color: c,
            active: getColor() === c,
            onClick: () => {
              setColor(c)
              dismiss()
            },
          }),
        )
      }
      host.appendChild(palette)

      // BRUSH section.
      host.appendChild(separator())
      host.appendChild(sectionLabel('Brush'))
      const row = pillRow()
      const activeBrush = getBrushId()
      for (const id of BRUSH_IDS) {
        row.appendChild(
          pill({
            label: id === 'highlighter' ? 'Hi' : BRUSH_LABELS[id],
            title: BRUSH_LABELS[id],
            active: id === activeBrush,
            onClick: () => {
              setBrushId(id)
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

function applyGamma(p: number, gamma: number): number {
  if (p <= 0 || gamma === 1) return p
  return p ** gamma
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
