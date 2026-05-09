/**
 * App entry point. Orchestrates: top-level state (strokes, undo / redo
 * stacks, camera, settings), the render loop, the tool registry, and the
 * keyboard / pointer / wheel event surfaces. Tool-specific rendering and
 * menu surfaces live inside each tool module (ADR 0007).
 *
 * Keyboard:
 *   B / E              — drawing / eraser tool
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
import { type Tool, type ToolContext, type ToolId, createEraserTool, createPenTool } from './tools'
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

  const eraserTool = createEraserTool({
    callbacks: {
      getStrokes: () => strokes,
      onErase: (ids) => {
        if (ids.length === 0) return
        const op: Op = { kind: 'delete', strokeIds: ids }
        applyOp(op, opCtx)
        undoStack.push(op)
        redoStack.length = 0
      },
    },
  })

  const allTools: Record<'pen' | 'eraser', Tool> = { pen: penTool, eraser: eraserTool }
  const tool: { current: Tool } = { current: penTool }
  const setTool = (id: ToolId): void => {
    if (tool.current.id === id) return
    if (id !== 'pen' && id !== 'eraser') return // others land at later milestones
    tool.current.cleanup?.()
    tool.current = allTools[id]
    root.style.cursor = tool.current.cursor ?? ''
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
    selectEraserTool: () => setTool('eraser'),
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
      clearLayer(target.committed)
      drawGrid(target.committed, camera, target.width, target.height, getSettings().grid)
      applyCamera(target.committed, camera, target.dpr)

      const viewBBox = {
        minX: camera.x,
        minY: camera.y,
        maxX: camera.x + target.width / camera.scale,
        maxY: camera.y + target.height / camera.scale,
      }

      for (const s of strokes) {
        if (s.deleted) continue
        if (!bboxesIntersect(getStrokeBBox(s), viewBBox)) continue
        const path = getStrokePath(s, [], true)
        if (!path) continue
        drawStrokePath(target.committed, path, resolveInkColor(s.brush.color), effectiveOpacity(s))
      }
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
    void runPerfMode(camera, target, () => {
      committedDirty = true
    })
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

void main()
