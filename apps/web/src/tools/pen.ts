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
import { getBrushId, getColor, getSettings, setBrushId, setColor } from '../settings'
import {
  applyPressure,
  effectiveOpacity,
  getStrokePath,
  synthesizePressureFromVelocity,
} from '../stroke'
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
 * "Fluorescent" halo promotion — drawn instead of the faint gated halo
 * when EITHER:
 *   - the cursor has been still for IDLE_HALO_MS (user lost it; classic
 *     Wacom Intuos scenario where eye drifts to a reference document),
 *   - the cursor is being JIGGLED — wiggling back-and-forth indicates
 *     the user is hunting for it. Detected by sliding-window path-length
 *     to net-displacement ratio so it doesn't false-positive on fast
 *     linear motion (cross-canvas sweep, fast scribble). Only checked
 *     while HOVERING — an active stroke (`active !== null`) bypasses
 *     the check entirely so high-speed scribbling never bloom-promotes.
 *
 * Both triggers paint the same visual state: wider radius, higher alpha,
 * soft glow, drawn regardless of brush size. Jiggle keeps the halo lit
 * for JIGGLE_HALO_LINGER_MS after the last detected jiggle so the user
 * gets a moment to see it before it demotes back.
 */
const IDLE_HALO_MS = 5000
const IDLE_HALO_RADIUS_PX = 22
const IDLE_HALO_ALPHA = 0.9
const IDLE_HALO_LINE_WIDTH = 2
const IDLE_HALO_GLOW_BLUR = 14
/** Sliding-window length for the jiggle detector. ~300 ms captures 3-4
 *  cycles of a typical hand wiggle without lagging into stale samples. */
const JIGGLE_WINDOW_MS = 300
/** Below this total path length (screen px) the motion is too small to
 *  call a jiggle. Filters out micro-tremor. */
const JIGGLE_MIN_PATH_PX = 60
/** Below this denominator the displacement is treated as effectively
 *  zero — protects the ratio from dividing by near-zero. */
const JIGGLE_MIN_DISPLACEMENT_PX = 8
/** Path-length / displacement ratio above which the motion is "windy"
 *  enough to count. A fast straight sweep has ratio ~1; back-and-forth
 *  jiggle climbs above 3 quickly. */
const JIGGLE_RATIO_THRESHOLD = 3
/** How long the bright halo lingers after the last jiggle-detect tick
 *  before the timer demotes it back to the faint gated halo. */
const JIGGLE_HALO_LINGER_MS = 1500

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

  // Jiggle-halo state. Sliding window of recent screen-space samples used
  // to compute the path-length / displacement ratio. `jiggleHaloUntilT`
  // is the wall-clock-future time at which the bright halo demotes — set
  // forward on each detected jiggle so a sustained hunt keeps the halo lit.
  // `jiggleDemoteTimer` schedules the demote redraw so the user sees the
  // halo fade without needing to move the cursor.
  const jiggleWindow: { x: number; y: number; t: number }[] = []
  let jiggleHaloUntilT = 0
  let jiggleDemoteTimer: ReturnType<typeof setTimeout> | null = null
  const cancelJiggleTimer = (): void => {
    if (jiggleDemoteTimer !== null) {
      clearTimeout(jiggleDemoteTimer)
      jiggleDemoteTimer = null
    }
  }
  const detectJiggle = (clientX: number, clientY: number, ctx: ToolContext): void => {
    const now = performance.now()
    jiggleWindow.push({ x: clientX, y: clientY, t: now })
    // Drop samples older than the window. Keep at least 2 so the ratio
    // math has something to chew on.
    while (jiggleWindow.length > 2) {
      const head = jiggleWindow[0]
      if (!head || now - head.t <= JIGGLE_WINDOW_MS) break
      jiggleWindow.shift()
    }
    if (jiggleWindow.length < 3) return
    let pathLen = 0
    for (let i = 1; i < jiggleWindow.length; i++) {
      const a = jiggleWindow[i - 1]
      const b = jiggleWindow[i]
      if (!a || !b) continue
      pathLen += Math.hypot(b.x - a.x, b.y - a.y)
    }
    if (pathLen < JIGGLE_MIN_PATH_PX) return
    const first = jiggleWindow[0]
    const last = jiggleWindow[jiggleWindow.length - 1]
    if (!first || !last) return
    const displacement = Math.max(
      JIGGLE_MIN_DISPLACEMENT_PX,
      Math.hypot(last.x - first.x, last.y - first.y),
    )
    const ratio = pathLen / displacement
    if (ratio < JIGGLE_RATIO_THRESHOLD) return
    // Jiggle detected — promote halo and arm a demote redraw.
    jiggleHaloUntilT = now + JIGGLE_HALO_LINGER_MS
    cancelJiggleTimer()
    jiggleDemoteTimer = setTimeout(() => {
      jiggleDemoteTimer = null
      ctx.markCommittedDirty()
    }, JIGGLE_HALO_LINGER_MS)
    // Force an immediate redraw so the bright halo paints on the current
    // frame instead of waiting for the next idle/jiggle event.
    ctx.markCommittedDirty()
  }
  // Performance-clock origin captured at pointerdown. `Sample.t` is the
  // elapsed milliseconds since this origin (epoch-independent, survives
  // page reload, comparable across peers). `Stroke.startedAt` is a
  // separate wall-clock timestamp (Date.now) used as the render-order
  // sort key — it must come from the same time base on every peer.
  let strokeStartPerfTime = 0
  // Last raw sample input (screen-space + timestamp). Tracked across the
  // active stroke so the velocity-to-pressure synthesis path has a prior
  // anchor for each consecutive sample (including coalesced events, which
  // each define their own velocity segment). Cleared at stroke start /
  // cancel — first sample of a stroke has no velocity and gets the
  // "fully-pressed" synthesis fallback.
  let lastSampleScreen: { x: number; y: number; t: number } | null = null

  /**
   * Build a board-space Sample from a raw event. `pointerType` comes from
   * the parent PointerEvent (coalesced sub-events inherit it), and gates
   * the synthetic-pressure path: only mouse strokes get synthesis, and
   * only when `settings.mouseSyntheticPressure` is on. Pen / touch always
   * go through `applyPressure` on the real input pressure.
   */
  const sample = (
    e: SampleSource,
    brush: BrushConfig,
    ctx: ToolContext,
    pointerType: string,
  ): Sample => {
    const { x, y } = ctx.toBoard(e.clientX, e.clientY)
    let rawPressure = e.pressure
    if (pointerType === 'mouse' && getSettings().mouseSyntheticPressure) {
      // For mouse strokes the browser-reported pressure is the constant
      // 0.5 — flat by design. Replace with a velocity-shaped value so
      // the same `applyPressure` curve produces a stroke with feel.
      if (lastSampleScreen) {
        const dx = e.clientX - lastSampleScreen.x
        const dy = e.clientY - lastSampleScreen.y
        const dt = Math.max(1, e.timeStamp - lastSampleScreen.t)
        rawPressure = synthesizePressureFromVelocity(Math.hypot(dx, dy) / dt)
      } else {
        // First sample of the stroke — no prior, treat as stationary.
        rawPressure = synthesizePressureFromVelocity(0)
      }
    }
    lastSampleScreen = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    return {
      x,
      y,
      p: applyPressure(rawPressure, brush),
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
    const now = performance.now()
    const idleFor = now - lastMoveAt
    const isIdle = lastHover !== null && idleFor >= IDLE_HALO_MS
    const isJiggling = now < jiggleHaloUntilT
    const isHiViz = isIdle || isJiggling
    const screenRadius = (preset.size / 2) * ctx.camera.scale
    const showFaintHalo = !isHiViz && screenRadius < HOVER_HALO_THRESHOLD_PX
    if (showFaintHalo || isHiViz) {
      const screen = boardToScreen(ctx.camera, boardX, boardY)
      const inkColor = ctx.resolveColor(getColor())
      c.save()
      c.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0)
      c.strokeStyle = inkColor
      if (isHiViz) {
        // Glow pass — shadowBlur on a wider semi-transparent stroke gives
        // the bloom; the crisp ring lands on top. Same visual for both
        // idle-hold and jiggle-hunt triggers.
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
    lastSampleScreen = null
    cancelIdleTimer()
    cancelJiggleTimer()
    jiggleWindow.length = 0
    jiggleHaloUntilT = 0
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
      // pressed down (e.g. between segments of a careful line). Also
      // drops any in-flight jiggle state so the bright halo doesn't
      // leak into the active-stroke render.
      lastMoveAt = performance.now()
      cancelIdleTimer()
      cancelJiggleTimer()
      jiggleWindow.length = 0
      jiggleHaloUntilT = 0
      // New stroke → no prior sample for velocity. `sample()` will treat
      // the first call as zero-velocity (heaviest synthetic pressure).
      lastSampleScreen = null
      active = {
        id: makeId(),
        brush,
        samples: [sample(e, brush, ctx, e.pointerType)],
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
        // Hover-only: feed the jiggle detector. Skipped when actively
        // drawing so scribbling never bloom-promotes the halo.
        detectJiggle(e.clientX, e.clientY, ctx)
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
          active.samples = [first, sample(e, brush, ctx, e.pointerType)]
          predicted = []
          renderAsFinal = true
          renderStroke(ctx)
        }
        return
      }

      const coalesced = e.getCoalescedEvents?.() ?? []
      if (coalesced.length === 0) {
        active.samples.push(sample(e, brush, ctx, e.pointerType))
      } else {
        for (const ce of coalesced) active.samples.push(sample(ce, brush, ctx, e.pointerType))
      }
      // Cap predicted events at 2 to limit the "lead distance" of the
      // visual lookahead. Browsers typically return 4–6 predicted events,
      // but each predicted sample is an estimate that gets discarded and
      // replaced on the next frame — fewer predicted samples = less visible
      // "rubber band" glitch on direction changes. ADR 0004 documents the
      // smoothness/glitch trade-off; 2 was the M2 feel-test sweet spot.
      //
      // Predicted samples DON'T advance `lastSampleScreen` — they're
      // discarded on the next real move, so feeding them into the velocity
      // anchor would corrupt the synthesis for the next real sample.
      const PREDICTED_CAP = 2
      const anchorBackup = lastSampleScreen
      predicted = opts.shouldUsePrediction?.()
        ? (e.getPredictedEvents?.() ?? [])
            .slice(0, PREDICTED_CAP)
            .map((pe) => sample(pe, brush, ctx, e.pointerType))
        : []
      lastSampleScreen = anchorBackup
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
