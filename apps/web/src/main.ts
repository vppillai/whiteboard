/**
 * App entry point. Orchestrates: top-level state (strokes, undo / redo
 * stacks, camera, settings), the render loop, the tool registry, and the
 * keyboard / pointer / wheel event surfaces. Tool-specific rendering and
 * menu surfaces live inside each tool module (ADR 0007).
 *
 * Keyboard:
 *   B                  — drawing tool (current brush preset)
 *   P                  — drawing tool + Pen brush preset (default setup)
 *   E                  — eraser (tap toggles, hold spring-loads — see eraserhold.ts)
 *   1 – 5              — brush preset
 *   M                  — toggle metrics HUD
 *   T                  — cycle theme
 *   ?                  — toggle help overlay
 *   Esc                — cancel / dismiss popover
 *   ⌘/Ctrl + Z         — undo
 *   ⌘/Ctrl + Shift + Z — redo (also ⌘/Ctrl + Y)
 *   ⌘/Ctrl + 0         — reset zoom
 *   ⌘/Ctrl + 1         — fit all strokes to view
 *   ⌘/Ctrl + + / -     — zoom in / out
 *   ⌘/Ctrl + Shift + K — clear board (confirm)
 *
 * Pointer:
 *   Pen / mouse / touch — active tool's behavior
 *   Right-click         — tool menu (also via Wacom barrel button)
 *   Wheel               — pan; ⌘/Ctrl+wheel or pinch — zoom
 *   Space + drag        — pan
 *   Middle-mouse drag   — pan
 *
 * Query string:
 *   ?perftest=1 — synthetic stroke harness on load
 *   ?predict=1  — re-enable predicted events (off by default — ADR 0004)
 */

import './style.css'
import type { BrushConfig, Sample, Stroke } from '@whiteboard/shared'
import { BRUSH_IDS, BRUSH_PRESETS } from './brushes'
import { makeCamera, panByScreen, resetZoom, screenToBoard, zoomAt } from './camera'
import { createClearFlow } from './clearflow'
import { openColorPicker } from './colorpicker'
import { attachEraserHold } from './eraserhold'
import { drawGrid } from './grid'
import { createHelpOverlay } from './helpoverlay'
import { attachKeymap } from './keymap'
import { MetricsCollector, bindHudToggle, createHud } from './metrics'
import { type Op, type OpContext, applyOp, unapplyOp } from './ops'
import { openOptionsMenu } from './optionsmenu'
import { attachPan } from './pan'
import { runPerftest } from './perftest'
import { createHelpPill } from './pill'
import { attachPointer } from './pointer'
import { dismissAllPopovers, getActiveTag } from './popover'
import { applyCamera, clearLayer, drawStrokePath, setupCanvas } from './render'
import {
  getBrushId,
  getColor,
  getSettings,
  onChange as onSettingsChange,
  setBrushId,
} from './settings'
import { clearAllStrokes, loadAllStrokes, saveStroke } from './storage'
import { bboxesIntersect, effectiveOpacity, getStrokeBBox, getStrokePath } from './stroke'
import { cycleMode, initTheme, resolveInkColor } from './theme'
import { openToolMenu } from './toolmenu'
import { createToolPill } from './toolpill'
import {
  type EraserTool,
  type LassoTool,
  type Tool,
  type ToolContext,
  type ToolId,
  createEraserTool,
  createLassoTool,
  createPenTool,
} from './tools'
import { clearView, loadView, makeViewSaver } from './viewstate'
import { fitToContent } from './zoomfit'

// Compose a runtime BrushConfig from the active brush preset (shape) and the
// active color (settings). Called once per stroke at pointerdown.
const makeBrush = (): BrushConfig => ({ ...BRUSH_PRESETS[getBrushId()], color: getColor() })

const ZOOM_WHEEL_FACTOR = 1.0015 // per pixel of deltaY

async function main(): Promise<void> {
  initTheme()

  const root = document.getElementById('app')
  if (!root) throw new Error('#app not found')
  // Programmatically focusable (without joining the tab order) so dialogs
  // like the clear-board toast can hand focus back here on close.
  root.tabIndex = -1

  const target = setupCanvas(root)
  const camera = makeCamera()

  // Restore last-saved camera position. Per-device, no sync; reset on clear-
  // board. Infinite canvas has no canonical "origin" — wherever you left off
  // is home.
  const persistedView = loadView()
  if (persistedView) {
    camera.x = persistedView.x
    camera.y = persistedView.y
    camera.scale = persistedView.scale
  }
  const viewSaver = makeViewSaver(camera)

  // ---------------------------------------------------------------------
  //  Static UI: metrics HUD, help overlay, help pill
  // ---------------------------------------------------------------------
  const metrics = new MetricsCollector()
  const hud = createHud()
  document.body.appendChild(hud.el)
  bindHudToggle(hud)
  hud.setVisible(false) // M to toggle

  document.body.appendChild(createHelpPill())
  const help = createHelpOverlay()
  document.body.appendChild(help.el)

  // ---------------------------------------------------------------------
  //  App state — strokes + op-based undo / redo (ADR 0006)
  // ---------------------------------------------------------------------
  const strokes: Stroke[] = []
  const undoStack: Op[] = []
  const redoStack: Op[] = []
  let committedDirty = true

  try {
    const persisted = await loadAllStrokes()
    strokes.push(...persisted)
  } catch (err) {
    console.warn('whiteboard/web: failed to load persisted strokes:', err)
  }

  // ---------------------------------------------------------------------
  //  Pointer-coordinate mapping. Cached canvas rect (M1.5 perf fix).
  // ---------------------------------------------------------------------
  let canvasRect = root.getBoundingClientRect()
  window.addEventListener('resize', () => {
    canvasRect = root.getBoundingClientRect()
  })
  const toBoard = (clientX: number, clientY: number): { x: number; y: number } =>
    screenToBoard(camera, clientX - canvasRect.left, clientY - canvasRect.top)

  // ---------------------------------------------------------------------
  //  Camera-change hook: marks committed dirty + queues view save.
  // ---------------------------------------------------------------------
  const onCameraChange = (): void => {
    committedDirty = true
    viewSaver.queueSave()
  }
  const pan = attachPan({ root, camera, onCameraChange })

  // ---------------------------------------------------------------------
  //  Tool registry. Pen and eraser implement the Tool interface (ADR 0005,
  //  extended in ADR 0007). Each owns its cursor/stroke rendering and
  //  contextual menu section. Main.ts only handles cross-tool concerns
  //  (committing strokes, applying ops, switching tools).
  // ---------------------------------------------------------------------
  const params = new URLSearchParams(location.search)
  const usePrediction = params.has('predict')

  const opCtx: OpContext = {
    strokes,
    saveStroke: (s) => {
      void saveStroke(s).catch((err) => {
        console.warn('whiteboard/web: failed to persist stroke:', err)
      })
    },
    markDirty: () => {
      committedDirty = true
    },
  }

  const penTool = createPenTool({
    usePrediction,
    callbacks: {
      onStrokeCommit(stroke) {
        strokes.push(stroke)
        undoStack.push({ kind: 'create', strokeId: stroke.id })
        redoStack.length = 0
        // Don't clear live here — the next RAF redraws committed (with this
        // stroke baked in) and clears live, avoiding a flicker.
        committedDirty = true
        void saveStroke(stroke).catch((err) => {
          console.warn('whiteboard/web: failed to persist stroke:', err)
        })
      },
    },
  })

  const eraserTool: EraserTool = createEraserTool({
    callbacks: {
      getStrokes: () => strokes,
      onObjectErase: (ids) => {
        if (ids.length === 0) return
        const op: Op = { kind: 'delete', strokeIds: ids }
        applyOp(op, opCtx)
        undoStack.push(op)
        redoStack.length = 0
      },
      onWipeErase: (edits) => {
        if (edits.length === 0) return
        // ADR 0009: pending stamps live in eraserTool until pointerup, then
        // applyOp adds them to each stroke's `erasedStamps` and saves —
        // ops are the source of truth, the sweep was just a render preview.
        const op: Op = { kind: 'eraseStamps', edits }
        applyOp(op, opCtx)
        undoStack.push(op)
        redoStack.length = 0
      },
    },
  })

  const lassoTool: LassoTool = createLassoTool({
    callbacks: {
      getStrokes: () => strokes,
      onDelete: (ids) => {
        if (ids.length === 0) return
        const op: Op = { kind: 'delete', strokeIds: ids }
        applyOp(op, opCtx)
        undoStack.push(op)
        redoStack.length = 0
      },
      onMove: (ids, dx, dy) => {
        if (ids.length === 0 || (dx === 0 && dy === 0)) return
        const op: Op = { kind: 'move', strokeIds: ids, dx, dy }
        applyOp(op, opCtx)
        undoStack.push(op)
        redoStack.length = 0
      },
    },
  })

  const allTools: Record<'pen' | 'eraser' | 'lasso', Tool> = {
    pen: penTool,
    eraser: eraserTool,
    lasso: lassoTool,
  }
  const tool: { current: Tool } = { current: penTool }
  // Apply the initial tool's cursor — `setTool` only fires on changes, so
  // without this the CSS default (`#app { cursor: crosshair }`) shows on
  // load until the user first switches tools.
  root.style.cursor = tool.current.cursor ?? ''
  const toolPill = createToolPill({
    initial: 'pen',
    onCycle: (next) => {
      setTool(next)
      // Hand focus back to the canvas so subsequent keystrokes don't go
      // through the pill button.
      root.focus({ preventScroll: true })
    },
  })
  document.body.appendChild(toolPill.el)
  const setTool = (id: ToolId): void => {
    if (tool.current.id === id) return
    if (id !== 'pen' && id !== 'eraser' && id !== 'lasso') return // others land later
    tool.current.cleanup?.()
    tool.current = allTools[id]
    root.style.cursor = tool.current.cursor ?? ''
    toolPill.setActiveTool(id)
    committedDirty = true // active tool changed; selection halos may toggle
  }

  // ---------------------------------------------------------------------
  //  Tool context — passed to every tool event. Carries cross-cutting
  //  capabilities so tools render directly without callbacks.
  // ---------------------------------------------------------------------
  const toolCtx: ToolContext = {
    toBoard,
    getBrush: makeBrush,
    liveLayer: target.live,
    camera,
    dpr: target.dpr,
    resolveColor: resolveInkColor,
    markCommittedDirty: () => {
      committedDirty = true
    },
  }

  // ---------------------------------------------------------------------
  //  Pointer pipeline (active tool dispatch + pan filter)
  // ---------------------------------------------------------------------
  const detachPointer = attachPointer(root, {
    getActiveTool: () => tool.current,
    context: toolCtx,
    shouldSkip: pan.isPanIntent,
  })

  // Metrics + last-pointer (for popover anchoring on keyboard shortcuts).
  let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  root.addEventListener('pointermove', (e) => {
    if (!(e instanceof PointerEvent)) return
    lastPointer = { x: e.clientX, y: e.clientY }
    const coalesced = e.getCoalescedEvents().length || 1
    metrics.notePointerEvent(coalesced)
  })

  // ---------------------------------------------------------------------
  //  Right-click → tool menu (capture phase + stopImmediatePropagation so
  //  the draw handler can't see right-click; pen drivers can fire
  //  button=0,buttons=3 for barrel-as-right-click and we want to handle it
  //  cleanly regardless).
  // ---------------------------------------------------------------------
  root.addEventListener('contextmenu', (e) => e.preventDefault())
  root.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 2) return
      e.stopImmediatePropagation()
      e.preventDefault()
      if (getActiveTag() === 'tools') {
        dismissAllPopovers()
        return
      }
      openToolMenu({
        at: { x: e.clientX, y: e.clientY },
        getActiveTool: () => tool.current,
        onSelectTool: setTool,
        onResetZoom: () => {
          resetZoom(camera)
          onCameraChange()
        },
        onZoomToFit: () => {
          if (fitToContent(camera, strokes, { width: target.width, height: target.height })) {
            onCameraChange()
          }
        },
        onClear: clearFlow.request,
      })
    },
    { capture: true },
  )

  // ---------------------------------------------------------------------
  //  Wheel — pan (plain) or zoom (Cmd/Ctrl/pinch).
  // ---------------------------------------------------------------------
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const fx = e.clientX - canvasRect.left
      const fy = e.clientY - canvasRect.top
      if (e.ctrlKey || e.metaKey) {
        zoomAt(camera, fx, fy, ZOOM_WHEEL_FACTOR ** -e.deltaY)
      } else {
        panByScreen(camera, -e.deltaX, -e.deltaY)
      }
      onCameraChange()
    },
    { passive: false },
  )

  // ---------------------------------------------------------------------
  //  Theme + settings change hooks
  // ---------------------------------------------------------------------
  document.documentElement.addEventListener('themechange', () => {
    committedDirty = true
  })
  onSettingsChange(() => {
    committedDirty = true
  })

  // ---------------------------------------------------------------------
  //  Clear-board flow
  // ---------------------------------------------------------------------
  const clearFlow = createClearFlow({
    refocusOnClose: root,
    onPerformClear: () => {
      // Destructive boundary by design — undo/redo stacks reset alongside
      // the in-memory strokes and the IDB store. See ops.ts (clear is *not*
      // an Op).
      strokes.length = 0
      undoStack.length = 0
      redoStack.length = 0
      camera.x = 0
      camera.y = 0
      camera.scale = 1
      committedDirty = true
      clearView()
      void clearAllStrokes().catch((err) => {
        console.warn('whiteboard/web: clear failed:', err)
      })
    },
  })

  // ---------------------------------------------------------------------
  //  Undo / redo
  // ---------------------------------------------------------------------
  const undo = (): void => {
    const op = undoStack.pop()
    if (!op) return
    unapplyOp(op, opCtx)
    redoStack.push(op)
  }
  const redo = (): void => {
    const op = redoStack.pop()
    if (!op) return
    applyOp(op, opCtx)
    undoStack.push(op)
  }

  // ---------------------------------------------------------------------
  //  Keyboard shortcuts
  // ---------------------------------------------------------------------
  attachEraserHold({
    getActiveToolId: () => tool.current.id,
    setTool,
  })

  attachKeymap({
    undo,
    redo,
    zoomReset: () => {
      resetZoom(camera)
      onCameraChange()
    },
    zoomIn: () => {
      zoomAt(camera, target.width / 2, target.height / 2, 1.2)
      onCameraChange()
    },
    zoomOut: () => {
      zoomAt(camera, target.width / 2, target.height / 2, 1 / 1.2)
      onCameraChange()
    },
    zoomToFit: () => {
      if (fitToContent(camera, strokes, { width: target.width, height: target.height })) {
        onCameraChange()
      }
    },
    clear: clearFlow.request,
    toggleTheme: cycleMode,
    toggleColor: () => {
      if (getActiveTag() === 'color') dismissAllPopovers()
      else openColorPicker(lastPointer)
    },
    toggleOptions: () => {
      if (getActiveTag() === 'options') dismissAllPopovers()
      else openOptionsMenu(lastPointer)
    },
    toggleHelp: help.toggle,
    selectBrush: (index1Based) => {
      const id = BRUSH_IDS[index1Based - 1]
      if (id) setBrushId(id)
    },
    selectDrawingTool: () => setTool('pen'),
    selectPenDefault: () => {
      setTool('pen')
      setBrushId('pen')
    },
    selectEraserSticky: () => setTool('eraser'),
    selectLassoTool: () => setTool('lasso'),
    deleteSelection: () => {
      if (tool.current !== lassoTool) return false
      return lassoTool.deleteSelection()
    },
    selectAll: () => {
      setTool('lasso')
      lassoTool.selectAll()
      committedDirty = true
    },
    cancel: () => {
      let handled = false
      if (clearFlow.cancel()) handled = true
      if (dismissAllPopovers()) handled = true
      return handled
    },
  })

  // ---------------------------------------------------------------------
  //  Render loop. Committed layer rebuilt on dirty (camera, commit, theme,
  //  settings). Live layer is owned by the active tool; we ask it to redraw
  //  after committed redraws so in-flight content survives camera changes.
  // ---------------------------------------------------------------------
  function frame(now: DOMHighResTimeStamp): void {
    metrics.noteFrame(now)

    if (committedDirty) {
      const viewBBox = {
        minX: camera.x,
        minY: camera.y,
        maxX: camera.x + target.width / camera.scale,
        maxY: camera.y + target.height / camera.scale,
      }

      // ----- Pass 1: stroke outlines on the offscreen strokes layer -----
      // ADR 0009: strokes go to a dedicated offscreen so we can apply
      // destination-out for eraser stamps without subtracting from the
      // grid (which lives on the committed layer).
      clearLayer(target.strokes)
      applyCamera(target.strokes, camera, target.dpr)

      // Strokes the lasso is live-moving are skipped here and ghost-painted
      // on live by the lasso's `redraw()` at offset.
      const dragState = tool.current === lassoTool ? lassoTool.getDragState() : null
      const draggingIds = dragState?.ids

      for (const s of strokes) {
        if (s.deleted) continue
        if (draggingIds?.has(s.id)) continue
        if (!bboxesIntersect(getStrokeBBox(s), viewBBox)) continue
        const path = getStrokePath(s, [], true)
        if (!path) continue
        drawStrokePath(target.strokes, path, resolveInkColor(s.brush.color), effectiveOpacity(s))
      }

      // ----- Pass 2: destination-out for eraser stamps -----
      // Both the committed `erasedStamps` (set by applied `eraseStamps`
      // ops) and the active tool's pending stamps (in-flight wipe sweep
      // not yet committed) are applied here. Pending stamps are read
      // through the EraserTool's `getPendingStamps` extension; if no other
      // tool is active, the lookup is skipped.
      const pendingStamps = tool.current === eraserTool ? eraserTool.getPendingStamps() : null
      const sCtx = target.strokes.ctx
      sCtx.save()
      sCtx.globalCompositeOperation = 'destination-out'
      sCtx.fillStyle = '#000' // destination-out only cares about source alpha
      for (const s of strokes) {
        if (s.deleted) continue
        if (draggingIds?.has(s.id)) continue
        const committedStamps = s.erasedStamps
        const pendingForStroke = pendingStamps?.get(s.id)
        if (!committedStamps && !pendingForStroke) continue
        if (committedStamps) {
          for (const st of committedStamps) {
            sCtx.beginPath()
            sCtx.arc(st.x, st.y, st.r, 0, Math.PI * 2)
            sCtx.fill()
          }
        }
        if (pendingForStroke) {
          for (const st of pendingForStroke) {
            sCtx.beginPath()
            sCtx.arc(st.x, st.y, st.r, 0, Math.PI * 2)
            sCtx.fill()
          }
        }
      }
      sCtx.restore()

      // ----- Pass 3: committed layer (grid + composited strokes) -----
      clearLayer(target.committed)
      applyCamera(target.committed, camera, target.dpr)
      drawGrid(target.committed, camera, target.width, target.height, getSettings().grid)
      // Composite the offscreen onto committed in pixel space (identity
      // transform) so the strokes pixel-for-pixel overlay the grid.
      const cCtx = target.committed.ctx
      cCtx.save()
      cCtx.setTransform(1, 0, 0, 1, 0, 0)
      cCtx.drawImage(target.strokes.el, 0, 0)
      cCtx.restore()

      committedDirty = false

      // Live layer needs to refresh too: clear stale content; ask the active
      // tool to re-render its in-flight state if any.
      clearLayer(target.live)
      tool.current.redraw?.(toolCtx)
    }

    hud.update(metrics.state)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // Cleanup on unload (HMR safety).
  window.addEventListener('beforeunload', () => detachPointer())

  // Perftest mode.
  if (params.has('perftest')) {
    const mode = params.get('perftest')
    const dirty = (): void => {
      committedDirty = true
    }
    if (mode === 'erase') {
      void runErasePerfMode(strokes, target, dirty)
    } else {
      void runPerfMode(camera, target, dirty)
    }
  }
}

async function runPerfMode(
  camera: ReturnType<typeof makeCamera>,
  target: ReturnType<typeof setupCanvas>,
  markCommittedDirty: () => void,
): Promise<void> {
  const banner = document.createElement('div')
  banner.id = 'whiteboard-banner'
  banner.textContent = 'Running perftest…'
  document.body.appendChild(banner)

  const synth: Stroke = {
    id: 'perftest',
    brush: makeBrush(),
    samples: [],
    startedAt: performance.now(),
  }

  const result = await runPerftest({ width: target.width, height: target.height }, (s: Sample) => {
    const board = screenToBoard(camera, s.x, s.y)
    synth.samples.push({ ...s, x: board.x, y: board.y })
    clearLayer(target.live)
    applyCamera(target.live, camera, target.dpr)
    const path = getStrokePath(synth, [], false)
    if (path) {
      drawStrokePath(
        target.live,
        path,
        resolveInkColor(synth.brush.color),
        synth.brush.opacity ?? 1,
      )
    }
  })

  const finalPath = getStrokePath(synth, [], true)
  if (finalPath) {
    drawStrokePath(
      target.committed,
      finalPath,
      resolveInkColor(synth.brush.color),
      effectiveOpacity(synth),
    )
  }
  clearLayer(target.live)
  markCommittedDirty()

  banner.replaceChildren()
  const heading = document.createElement('div')
  heading.textContent = 'Perftest complete'
  heading.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:10px'
  banner.appendChild(heading)

  const pre = document.createElement('pre')
  pre.textContent = [
    `samples       ${result.totalSamples}`,
    `duration      ${result.durationMs.toFixed(0)} ms`,
    `fps           ${result.fps}`,
    `event→render  mean ${result.eventToRenderMs.mean} · p50 ${result.eventToRenderMs.p50} · p95 ${result.eventToRenderMs.p95} · max ${result.eventToRenderMs.max}  (ms)`,
  ].join('\n')
  banner.appendChild(pre)

  const note = document.createElement('div')
  note.textContent =
    'JS-side input-to-render only. Compositor + display latency adds ~16–32 ms on typical hardware. Tap or click anywhere to dismiss.'
  note.style.cssText = 'margin-top:12px;font-size:11px;color:var(--fg-muted);max-width:520px'
  banner.appendChild(note)
  banner.style.pointerEvents = 'auto'
  banner.addEventListener('click', () => banner.remove(), { once: true })
}

/**
 * `?perftest=erase` — synthetic eraser sweep across N pre-populated strokes.
 * Verifies the ADR 0009 budget: wipe responsive within the 16 ms frame at
 * 500 strokes. Reports per-frame render cost during the sweep.
 *
 * Override defaults via query params: `?perftest=erase&n=500&r=12&dur=2000`.
 */
async function runErasePerfMode(
  strokes: Stroke[],
  target: ReturnType<typeof setupCanvas>,
  markCommittedDirty: () => void,
): Promise<void> {
  const banner = document.createElement('div')
  banner.id = 'whiteboard-banner'
  banner.textContent = 'Erase perftest: populating strokes…'
  document.body.appendChild(banner)

  const params = new URLSearchParams(window.location.search)
  const strokeCount = Number(params.get('n')) || 500
  const eraserRadius = Number(params.get('r')) || 12
  const sweepDurationMs = Number(params.get('dur')) || 2000
  const stampHz = 200

  // Populate a grid of horizontal-line strokes spread across the viewport.
  const cols = Math.max(1, Math.ceil(Math.sqrt(strokeCount)))
  const rows = Math.ceil(strokeCount / cols)
  const cellW = target.width / cols
  const cellH = target.height / rows
  const samplesPerStroke = 30

  for (let i = 0; i < strokeCount; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const x0 = col * cellW + cellW * 0.1
    const y0 = row * cellH + cellH * 0.5
    const samples: Sample[] = []
    for (let j = 0; j < samplesPerStroke; j++) {
      const u = j / (samplesPerStroke - 1)
      samples.push({ x: x0 + u * cellW * 0.8, y: y0, p: 0.7, t: 0 })
    }
    strokes.push({ id: `perf-${i}`, brush: makeBrush(), samples, startedAt: 0 })
  }
  markCommittedDirty()
  // Let one frame paint the populated strokes.
  await new Promise<void>((r) => requestAnimationFrame(() => r()))

  banner.textContent = 'Erase perftest: sweeping…'

  // Drive a synthetic sinusoidal sweep across the canvas at `stampHz`. Each
  // stamp is applied directly to overlapping strokes (bypassing the op
  // layer — we're measuring render cost, not the op pipeline).
  const totalStamps = Math.floor((sweepDurationMs / 1000) * stampHz)
  const startT = performance.now()
  const frameTimes: number[] = []
  let stampIdx = 0

  await new Promise<void>((resolve) => {
    const tick = (now: DOMHighResTimeStamp): void => {
      const frameStart = performance.now()
      const elapsed = now - startT
      const targetCount = Math.min(
        totalStamps,
        Math.floor((elapsed / sweepDurationMs) * totalStamps),
      )
      while (stampIdx < targetCount) {
        const u = stampIdx / Math.max(1, totalStamps - 1)
        const x = u * target.width
        const y = target.height / 2 + Math.sin(u * Math.PI * 4) * (target.height / 4)
        for (const s of strokes) {
          if (s.deleted) continue
          const tol = eraserRadius + s.brush.size / 2
          const bb = getStrokeBBox(s)
          if (x + tol < bb.minX || x - tol > bb.maxX) continue
          if (y + tol < bb.minY || y - tol > bb.maxY) continue
          if (!s.erasedStamps) s.erasedStamps = []
          s.erasedStamps.push({ x, y, r: eraserRadius })
        }
        stampIdx++
      }
      markCommittedDirty()
      frameTimes.push(performance.now() - frameStart)
      if (stampIdx >= totalStamps) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  // Report.
  const sorted = [...frameTimes].sort((a, b) => a - b)
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
  const sum = sorted.reduce((a, b) => a + b, 0)
  const r2 = (v: number): number => Math.round(v * 100) / 100

  banner.replaceChildren()
  const heading = document.createElement('div')
  heading.textContent = 'Erase perftest complete'
  heading.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:10px'
  banner.appendChild(heading)

  const pre = document.createElement('pre')
  pre.textContent = [
    `strokes        ${strokeCount}`,
    `eraser radius  ${eraserRadius} px`,
    `sweep dur      ${sweepDurationMs} ms`,
    `total stamps   ${totalStamps}`,
    `frames         ${frameTimes.length}`,
    `frame work     mean ${r2(sum / frameTimes.length)} · p50 ${r2(at(0.5))} · p95 ${r2(at(0.95))} · max ${r2(sorted[sorted.length - 1] ?? 0)}  (ms)`,
    'budget         16 ms / frame (ADR 0009)',
  ].join('\n')
  banner.appendChild(pre)

  const note = document.createElement('div')
  note.textContent =
    'Measures stamp-application + render cost only. Compositor + display latency separate. Tap to dismiss.'
  note.style.cssText = 'margin-top:12px;font-size:11px;color:var(--fg-muted);max-width:520px'
  banner.appendChild(note)
  banner.style.pointerEvents = 'auto'
  banner.addEventListener('click', () => banner.remove(), { once: true })
}

void main()
