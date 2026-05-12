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

/**
 * Idle "fluorescent" promotion. After the cursor has been still for this
 * long, the finder halo brightens, widens, and gains a glow so the user
 * can locate the pointer at a glance — common scenario on Wacom Intuos
 * where the eye drifts to a reference document and back. The halo stays
 * gated by `screenRadius < HOVER_HALO_THRESHOLD_PX` while ACTIVE; when
 * idle it ALWAYS draws regardless of brush size, because "where is my
 * cursor" outranks "don't double up on a big visible brush". One
 * setTimeout dirties the canvas once at 5 s so the static state actually
 * paints; movement clears the timer and immediately demotes back.
 */
const IDLE_HALO_MS = 5000
const IDLE_HALO_RADIUS_PX = 22
const IDLE_HALO_ALPHA = 0.9
const IDLE_HALO_LINE_WIDTH = 2
const IDLE_HALO_GLOW_BLUR = 14

export interface PenToolCallbacks {
  /** Stroke finalized at pointerup. Caller pushes it to the strokes array
   *  and emits the create op. */
  onStrokeCommit: (stroke: Stroke) => void
}

export interface PenToolOptions {
  callbacks: PenToolCallbacks
  /**
   * Called once per pointermove to decide whether to use predicted events.
   * Read every move so toggling the `settings.predictedEvents` setting at
   * runtime takes effect immediately. M2 — was a captured boolean before.
   */
  shouldUsePrediction?: () => boolean
}

interface SampleSource {
  clientX: number
  clientY: number
  pressure: number
  tiltX?: number
  tiltY?: number
  timeStamp: number
}

// Curated palette imported from colorpicker.ts to keep the right-click COLOR
// section and the C-key popover synchronized (one list = one source of truth).
import { CURATED_COLORS as PALETTE } from '../colorpicker'

export function createPenTool(opts: PenToolOptions): Tool {
  let active: Stroke | null = null
  let predicted: Sample[] = []
  let renderAsFinal = false
  // Last cursor position painted as a hover preview. Cached so `redraw()`
  // can repaint after the render loop clears the live layer (settings
  // change, theme change, undo) — without it the brush cursor would blink
  // off until the next pointermove.
  let lastHover: { x: number; y: number } | null = null
  // Idle-halo state. `lastMoveAt` updates on every pointermove; the timer
  // fires once 5 s later and marks the canvas dirty so the next frame
  // re-renders the hover with the brighter halo. Cleared on movement,
  // active stroke start, and tool cleanup.
  let lastMoveAt = 0
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const cancelIdleTimer = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }
  const armIdleTimer = (ctx: ToolContext): void => {
    cancelIdleTimer()
    idleTimer = setTimeout(() => {
      idleTimer = null
      // Trigger a redraw — `renderHover` will see lastMoveAt > IDLE_HALO_MS
      // ago and paint the bright halo.
      ctx.markCommittedDirty()
    }, IDLE_HALO_MS)
  }
  // Performance-clock origin captured at pointerdown. `Sample.t` is the
  // elapsed milliseconds since this origin (epoch-independent, survives
  // page reload, comparable across peers). `Stroke.startedAt` is a
  // separate wall-clock timestamp (Date.now) used as the render-order
  // sort key — it must come from the same time base on every peer.
  let strokeStartPerfTime = 0

  const sample = (e: SampleSource, brush: BrushConfig, ctx: ToolContext): Sample => {
    const { x, y } = ctx.toBoard(e.clientX, e.clientY)
    return {
      x,
      y,
      p: applyPressure(e.pressure, brush),
      tx: e.tiltX,
      ty: e.tiltY,
      t: Math.max(0, e.timeStamp - strokeStartPerfTime),
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

    // Halo: screen-coords ring so the cursor is locatable. Two modes:
    //   - ACTIVE (recent movement): only drawn when the brush's effective
    //     screen radius is sub-finder-sized — faint, doesn't compete with
    //     a visible brush body.
    //   - IDLE (>= IDLE_HALO_MS since the last move): ALWAYS drawn, with
    //     a wider radius, higher alpha, and a soft shadow glow for a
    //     "fluorescent" pop. Locating the pointer outranks not double-
    //     drawing the brush body.
    const idleFor = performance.now() - lastMoveAt
    const isIdle = lastHover !== null && idleFor >= IDLE_HALO_MS
    const screenRadius = (preset.size / 2) * ctx.camera.scale
    const showActiveHalo = !isIdle && screenRadius < HOVER_HALO_THRESHOLD_PX
    if (showActiveHalo || isIdle) {
      const screen = boardToScreen(ctx.camera, boardX, boardY)
      const inkColor = ctx.resolveColor(getColor())
      c.save()
      c.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0)
      c.strokeStyle = inkColor
      if (isIdle) {
        // Glow pass — shadowBlur on a wider semi-transparent stroke gives
        // the bloom; the crisp ring lands on top.
        c.globalAlpha = 0.55
        c.lineWidth = IDLE_HALO_LINE_WIDTH
        c.shadowColor = inkColor
        c.shadowBlur = IDLE_HALO_GLOW_BLUR
        c.beginPath()
        c.arc(screen.x, screen.y, IDLE_HALO_RADIUS_PX, 0, Math.PI * 2)
        c.stroke()
        c.shadowBlur = 0
        c.globalAlpha = IDLE_HALO_ALPHA
        c.stroke()
      } else {
        c.globalAlpha = HOVER_HALO_ALPHA
        c.lineWidth = 1
        c.beginPath()
        c.arc(screen.x, screen.y, HOVER_HALO_RADIUS_PX, 0, Math.PI * 2)
        c.stroke()
      }
      c.restore()
    }
  }

  const cancel = (): void => {
    active = null
    predicted = []
    renderAsFinal = false
    lastHover = null
    cancelIdleTimer()
  }

  return {
    id: 'pen',
    // OS cursor hidden — the per-brush hover preview drawn on the live
    // layer in `renderHover` (filled circle / chisel rect / soft halo) is
    // the cursor. Showing both stacks two indicators on the same spot.
    cursor: 'none',

    onPointerDown(e, ctx) {
      const brush = ctx.getBrush()
      strokeStartPerfTime = e.timeStamp
      // Active stroke counts as activity — reset the idle timer so the
      // halo doesn't bloom mid-stroke if the user pauses with the pen
      // pressed down (e.g. between segments of a careful line).
      lastMoveAt = performance.now()
      cancelIdleTimer()
      active = {
        id: makeId(),
        brush,
        samples: [sample(e, brush, ctx)],
        startedAt: Date.now(),
      }
      predicted = []
      renderAsFinal = false
      renderStroke(ctx)
    },

    onPointerMove(e, ctx) {
      const board = ctx.toBoard(e.clientX, e.clientY)
      lastHover = board
      lastMoveAt = performance.now()
      armIdleTimer(ctx)
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
      // Cap predicted events at 2 to limit the "lead distance" of the
      // visual lookahead. Browsers typically return 4–6 predicted events,
      // but each predicted sample is an estimate that gets discarded and
      // replaced on the next frame — fewer predicted samples = less visible
      // "rubber band" glitch on direction changes. ADR 0004 documents the
      // smoothness/glitch trade-off; 2 was the M2 feel-test sweet spot.
      const PREDICTED_CAP = 2
      predicted = opts.shouldUsePrediction?.()
        ? (e.getPredictedEvents?.() ?? [])
            .slice(0, PREDICTED_CAP)
            .map((pe) => sample(pe, brush, ctx))
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

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
