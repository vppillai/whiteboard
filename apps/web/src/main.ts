/**
 * M0 entry point: low-latency drawing surface with infinite pan / zoom canvas,
 * theme-aware ink, and IndexedDB-backed local persistence.
 *
 * Keyboard:
 *   M  — toggle metrics HUD.
 *   T  — cycle theme (system → light → dark).
 *   ?  — toggle help overlay.
 *   Cmd/Ctrl + Z — undo.
 *   Cmd/Ctrl + Shift + Z — redo (also Cmd/Ctrl + Y).
 *   Cmd/Ctrl + 0 — reset zoom.
 *   Cmd/Ctrl + +/- — zoom in / out.
 *   Cmd/Ctrl + Shift + K — clear board (press twice within 3 s; Esc cancels).
 *   Esc — cancel a pending action (e.g. clear-confirm).
 *
 * Pointer:
 *   Pen / mouse / touch — draw.
 *   Wheel — pan (plain) or zoom around cursor (Cmd/Ctrl + wheel, or pinch).
 *
 * Query string:
 *   ?perftest=1 — run synthetic stroke harness on load and overlay results.
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
import { effectiveOpacity, getStrokePath } from './stroke'
import { cycleMode, initTheme, resolveInkColor } from './theme'
import { openToolMenu } from './toolmenu'
import { type Tool, createPenTool } from './tools'
import { clearView, loadView, makeViewSaver } from './viewstate'

// Compose a runtime BrushConfig from the active brush preset (shape) and the
// active color (settings). Called once per stroke at pointerdown.
const makeBrush = (): BrushConfig => ({ ...BRUSH_PRESETS[getBrushId()], color: getColor() })

const ZOOM_WHEEL_FACTOR = 1.0015 // per pixel of deltaY when zooming

async function main(): Promise<void> {
  initTheme()

  const root = document.getElementById('app')
  if (!root) throw new Error('#app not found')

  const target = setupCanvas(root)
  const camera = makeCamera()

  // Restore last-saved camera position. Per-device, so no sync; reset on
  // clear-board. The board is infinite — there is no canonical "origin" the
  // user thinks of as home, just wherever they left off.
  const persistedView = loadView()
  if (persistedView) {
    camera.x = persistedView.x
    camera.y = persistedView.y
    camera.scale = persistedView.scale
  }
  const viewSaver = makeViewSaver(camera)

  const metrics = new MetricsCollector()
  const hud = createHud()
  document.body.appendChild(hud.el)
  bindHudToggle(hud)
  // HUD defaults to hidden — `M` toggles it on. Most of the time the user just
  // wants to draw; the metrics surface only when something's worth measuring.
  hud.setVisible(false)

  document.body.appendChild(createHelpPill())

  const help = createHelpOverlay()
  document.body.appendChild(help.el)

  // Render state
  const strokes: Stroke[] = []
  // Operation-based undo / redo. Each new committed action pushes an Op to
  // undoStack and clears redoStack. Undo pops from undoStack, unapplies,
  // pushes to redoStack. Redo is the inverse. Not persisted: redo history
  // dies on reload, which matches every other drawing tool.
  const undoStack: Op[] = []
  const redoStack: Op[] = []
  let liveStroke: Stroke | null = null
  let livePredicted: Sample[] = []
  let committedDirty = true

  // Hydrate from local storage before the first render.
  try {
    const persisted = await loadAllStrokes()
    strokes.push(...persisted)
  } catch (err) {
    console.warn('whiteboard/web: failed to load persisted strokes:', err)
  }

  // Camera-aware coordinate transform for the pointer pipeline.
  //
  // Performance: `getBoundingClientRect()` is normally cheap on a static
  // fixed-position element, but unrelated DOM mutations (popover open/close,
  // dataset.input changes, theme toggle) invalidate layout and force a
  // relayout on the next call. Calling it 200 times/sec during a Wacom
  // stroke surfaced as input lag. Cache the rect and refresh it only when
  // the viewport actually changes.
  let canvasRect = root.getBoundingClientRect()
  const refreshCanvasRect = (): void => {
    canvasRect = root.getBoundingClientRect()
  }
  window.addEventListener('resize', refreshCanvasRect)

  const toBoard = (clientX: number, clientY: number): { x: number; y: number } => {
    return screenToBoard(camera, clientX - canvasRect.left, clientY - canvasRect.top)
  }

  /**
   * Render the in-flight stroke immediately. Called synchronously inside
   * pointer handlers so wet ink reaches the screen the same frame the pen
   * moved, rather than waiting for the next RAF (saves ~8 ms p50). Safe because
   * the canvas context is `desynchronized` and only the live layer is touched.
   */
  const renderLive = (): void => {
    clearLayer(target.live)
    if (!liveStroke) return
    applyCamera(target.live, camera, target.dpr)
    const path = getStrokePath(liveStroke, livePredicted, false)
    if (path) {
      drawStrokePath(
        target.live,
        path,
        resolveInkColor(liveStroke.brush.color),
        effectiveOpacity(liveStroke),
      )
    }
  }

  const params = new URLSearchParams(location.search)
  const usePrediction = params.has('predict')

  // Single hook every camera-mutating action calls into. Marks the committed
  // layer dirty for the next RAF and queues a debounced save of view state.
  const onCameraChange = (): void => {
    committedDirty = true
    viewSaver.queueSave()
  }

  const pan = attachPan({ root, camera, onCameraChange })

  // Right-click → tool menu. Suppress the native contextmenu so our own UI
  // takes its place. Works with the pen too if the user maps a barrel button
  // to right-click in their tablet driver — that's the path to fully pen-only
  // operation, no keyboard or mouse needed.
  //
  // Registered with `capture: true` and uses `stopImmediatePropagation` so the
  // draw-pointer handler (registered earlier via attachPointer) cannot also
  // see this event. Relying on registration order alone proved fragile when
  // pen drivers report `button=0, buttons=3` for barrel-as-right-click.
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
        onResetZoom: () => {
          resetZoom(camera)
          onCameraChange()
        },
        onClear: clearFlow.request,
      })
    },
    { capture: true },
  )

  const penTool = createPenTool({
    usePrediction,
    callbacks: {
      onStrokeStart(stroke) {
        liveStroke = stroke
        livePredicted = []
        renderLive()
      },
      onStrokeUpdate(_stroke, predicted) {
        livePredicted = predicted
        renderLive()
      },
      onStrokeCommit(stroke) {
        strokes.push(stroke)
        undoStack.push({ kind: 'create', strokeId: stroke.id })
        redoStack.length = 0
        liveStroke = null
        livePredicted = []
        // Don't clear live here — RAF redraws committed (with this stroke
        // baked in via last:true) and then clears live, avoiding a flicker.
        committedDirty = true
        void saveStroke(stroke).catch((err) => {
          console.warn('whiteboard/web: failed to persist stroke:', err)
        })
      },
    },
  })

  // Active-tool state. Single tool today; M1's eraser / lasso land alongside
  // pen and the user switches between them via the side panel (M1.7) or the
  // tool menu. M1.4 just gets the abstraction in place — boxed in a ref so
  // tool switching is a single field write that future code can perform
  // without rewiring the pointer pipeline.
  const tool: { current: Tool } = { current: penTool }

  const detachPointer = attachPointer(root, {
    getActiveTool: () => tool.current,
    context: { toBoard, getBrush: makeBrush },
    shouldSkip: pan.isPanIntent,
  })

  // Metrics + last-pointer tracking: a single pointermove listener on the
  // canvas root. The previous version also had a document-level pointermove
  // for "track cursor when it's over a popover," but that listener fired on
  // every pointer movement anywhere in the document — non-trivial overhead
  // for a marginal edge case. Removed; popovers anchor at the last canvas
  // pointer position, which is correct in all common flows.
  let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  root.addEventListener('pointermove', (e) => {
    if (!(e instanceof PointerEvent)) return
    lastPointer = { x: e.clientX, y: e.clientY }
    const coalesced = e.getCoalescedEvents().length || 1
    metrics.notePointerEvent(coalesced)
  })

  // Wheel: pan (plain) or zoom (Cmd/Ctrl/pinch).
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const fx = e.clientX - canvasRect.left
      const fy = e.clientY - canvasRect.top
      if (e.ctrlKey || e.metaKey) {
        const factor = ZOOM_WHEEL_FACTOR ** -e.deltaY
        zoomAt(camera, fx, fy, factor)
      } else {
        panByScreen(camera, -e.deltaX, -e.deltaY)
      }
      onCameraChange()
    },
    { passive: false },
  )

  // Theme change: re-render committed strokes (color / grid follow theme).
  document.documentElement.addEventListener('themechange', () => {
    committedDirty = true
  })

  // Settings change: grid type / spacing / color affects what's rendered.
  onSettingsChange(() => {
    committedDirty = true
  })

  const clearFlow = createClearFlow({
    onPerformClear: () => {
      // Clear is a destructive boundary by design — undo / redo stacks are
      // reset along with the in-memory strokes and the IDB store. This is
      // the one operation that's *not* an Op (see ops.ts).
      strokes.length = 0
      undoStack.length = 0
      redoStack.length = 0
      // Reset to the canonical origin on clear — gives the user a known
      // starting point, since the infinite-canvas "wherever you left off"
      // semantic is no longer meaningful with no strokes.
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

  // Operation-based undo / redo. Apply / unapply are uniform across stroke
  // creation, future eraser deletes, and future lasso moves — see ops.ts.
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
    cancel: () => {
      let handled = false
      if (clearFlow.cancel()) handled = true
      if (dismissAllPopovers()) handled = true
      return handled
    },
  })

  // Render loop. The committed layer is rebuilt only when something invalidates
  // it (camera change, stroke commit, theme change). The live layer is rendered
  // synchronously inside pointer handlers (renderLive) for minimum latency, so
  // RAF only touches live to refresh after committed redraws.
  function frame(now: DOMHighResTimeStamp): void {
    metrics.noteFrame(now)

    if (committedDirty) {
      clearLayer(target.committed)
      drawGrid(target.committed, camera, target.width, target.height, getSettings().grid)
      applyCamera(target.committed, camera, target.dpr)
      for (const s of strokes) {
        if (s.deleted) continue
        const path = getStrokePath(s, [], true)
        if (path) {
          drawStrokePath(
            target.committed,
            path,
            resolveInkColor(s.brush.color),
            effectiveOpacity(s),
          )
        }
      }
      committedDirty = false
      // Refresh live layer too (camera transform, or just-committed stroke now
      // belongs to the committed layer and should disappear from live).
      renderLive()
    }

    hud.update(metrics.state)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // Cleanup on unload (mostly belt-and-suspenders for HMR).
  window.addEventListener('beforeunload', () => detachPointer())

  // Perftest mode.
  if (params.has('perftest')) {
    void runPerfMode(camera, target, root, () => {
      committedDirty = true
    })
  }
}

async function runPerfMode(
  camera: ReturnType<typeof makeCamera>,
  target: ReturnType<typeof setupCanvas>,
  _root: HTMLElement,
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

  const drawSynth = (last: boolean): void => {
    const path = getStrokePath(synth, [], last)
    if (!path) return
    drawStrokePath(target.live, path, resolveInkColor(synth.brush.color), synth.brush.opacity ?? 1)
  }

  const result = await runPerftest({ width: target.width, height: target.height }, (s: Sample) => {
    // Translate screen-space synth coordinates into board space so the stroke
    // ends up where expected under the current camera.
    const board = screenToBoard(camera, s.x, s.y)
    synth.samples.push({ ...s, x: board.x, y: board.y })
    clearLayer(target.live)
    applyCamera(target.live, camera, target.dpr)
    drawSynth(false)
  })

  // Commit synthetic stroke to the committed layer so it stays after dismiss.
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

  // Allow click-anywhere to dismiss
  banner.style.pointerEvents = 'auto'
  banner.addEventListener('click', () => banner.remove(), { once: true })
}

void main()
