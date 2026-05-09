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
import { makeCamera, panByScreen, resetZoom, screenToBoard, zoomAt } from './camera'
import { createClearFlow } from './clearflow'
import { openColorPicker } from './colorpicker'
import { drawGrid } from './grid'
import { createHelpOverlay } from './helpoverlay'
import { MetricsCollector, bindHudToggle, createHud } from './metrics'
import { openOptionsMenu } from './optionsmenu'
import { attachPan } from './pan'
import { runPerftest } from './perftest'
import { createHelpPill } from './pill'
import { attachPointer } from './pointer'
import { dismissAllPopovers, getActiveTag } from './popover'
import { applyCamera, clearLayer, drawStrokePath, setupCanvas } from './render'
import { getColor, getSettings, onChange as onSettingsChange } from './settings'
import { clearAllStrokes, deleteStroke, loadAllStrokes, saveStroke } from './storage'
import { effectiveOpacity, getStrokePath } from './stroke'
import { cycleMode, initTheme, resolveInkColor } from './theme'
import { openToolMenu } from './toolmenu'
import { clearView, loadView, makeViewSaver } from './viewstate'

// Default brush shape. Color is supplied at stroke-start time from the settings
// store so the color picker can change it dynamically.
//
// Pressure handling notes:
//   - `thinning` controls width range; higher = more pressure-sensitive width.
//   - `pressureGamma` < 1 boosts low-pressure response; > 1 squashes it.
//   - `opacity` here is the *baseline*; it gets multiplied by a per-stroke
//     pressure factor in stroke.ts so harder-pressed strokes appear darker.
const PEN_BRUSH_BASE: Omit<BrushConfig, 'color'> = {
  size: 3.5,
  thinning: 0.6,
  smoothing: 0.72,
  streamline: 0.4,
  taperStart: 0,
  taperEnd: 0,
  capStart: true,
  capEnd: true,
  pressureGamma: 1.3,
  opacity: 0.94,
}

const makeBrush = (): BrushConfig => ({ ...PEN_BRUSH_BASE, color: getColor() })

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
  // LIFO of strokes that were undone — re-doing pops from the top. Cleared
  // whenever a new stroke is committed (any new action invalidates redo).
  // Not persisted: redo history dies on reload, which matches every other
  // drawing tool.
  const redoStack: Stroke[] = []
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
        onUndo: undo,
        onRedo: redo,
        onClear: clearFlow.request,
      })
    },
    { capture: true },
  )

  const detachPointer = attachPointer(root, {
    getBrush: makeBrush,
    toBoard,
    usePrediction,
    shouldSkip: pan.isPanIntent,
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
      strokes.length = 0
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

  const undo = (): void => {
    const stroke = strokes.pop()
    if (!stroke) return
    redoStack.push(stroke)
    committedDirty = true
    void deleteStroke(stroke.id).catch((err) => {
      console.warn('whiteboard/web: failed to remove stroke on undo:', err)
    })
  }

  const redo = (): void => {
    const stroke = redoStack.pop()
    if (!stroke) return
    strokes.push(stroke)
    committedDirty = true
    void saveStroke(stroke).catch((err) => {
      console.warn('whiteboard/web: failed to re-persist stroke on redo:', err)
    })
  }

  // Keyboard shortcuts.
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey
    if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undo()
      return
    }
    if (meta && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      redo()
      return
    }
    if (meta && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'y') {
      // Cmd/Ctrl+Y is the Windows convention for redo.
      e.preventDefault()
      redo()
      return
    }
    if (meta && e.key === '0') {
      e.preventDefault()
      resetZoom(camera)
      onCameraChange()
      return
    }
    if (meta && (e.key === '=' || e.key === '+')) {
      e.preventDefault()
      zoomAt(camera, target.width / 2, target.height / 2, 1.2)
      onCameraChange()
      return
    }
    if (meta && e.key === '-') {
      e.preventDefault()
      zoomAt(camera, target.width / 2, target.height / 2, 1 / 1.2)
      onCameraChange()
      return
    }
    if (meta && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      clearFlow.request()
      return
    }
    if (e.key === 'Escape') {
      let handled = false
      if (clearFlow.cancel()) handled = true
      if (dismissAllPopovers()) handled = true
      if (handled) e.preventDefault()
      return
    }
    if (e.key === 't' && !meta && !e.altKey && !e.repeat) {
      cycleMode()
      return
    }
    if (e.key === 'c' && !meta && !e.altKey && !e.repeat) {
      e.preventDefault()
      if (getActiveTag() === 'color') dismissAllPopovers()
      else openColorPicker(lastPointer)
      return
    }
    if (e.key === 'o' && !meta && !e.altKey && !e.repeat) {
      e.preventDefault()
      if (getActiveTag() === 'options') dismissAllPopovers()
      else openOptionsMenu(lastPointer)
      return
    }
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      help.toggle()
    }
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
