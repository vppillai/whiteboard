/**
 * M0 entry point: low-latency drawing surface with infinite pan / zoom canvas,
 * theme-aware ink, and IndexedDB-backed local persistence.
 *
 * Keyboard:
 *   M  — toggle metrics HUD.
 *   T  — cycle theme (system → light → dark).
 *   ?  — toggle help overlay.
 *   Cmd/Ctrl + 0 — reset zoom.
 *   Cmd/Ctrl + +/- — zoom in / out.
 *   Cmd/Ctrl + Shift + K — clear board (irreversible at v1; M2 will add undo).
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
import { drawGrid } from './grid'
import { MetricsCollector, bindHudToggle, createHud } from './metrics'
import { runPerftest } from './perftest'
import { attachPointer } from './pointer'
import { applyCamera, clearLayer, drawStrokePath, setupCanvas } from './render'
import { clearAllStrokes, deleteStroke, loadAllStrokes, saveStroke } from './storage'
import { getStrokePath } from './stroke'
import { cycleMode, getEffective, getMode, initTheme, resolveInkColor } from './theme'

// Default brush. Tuned for a felt-marker feel: slightly thicker than a fine
// technical pen, smoother outline, less pressure-driven thinning. Streamline
// is kept low because it trades latency for smoothing — high streamline makes
// the wet ink visibly trail the pen. Opacity is < 1 so overlapping strokes
// layer subtly, which reads as "real ink" rather than digital fill.
const PEN_BRUSH: BrushConfig = {
  size: 3.5,
  color: 'ink',
  thinning: 0.45,
  smoothing: 0.72,
  streamline: 0.4,
  taperStart: 0,
  taperEnd: 0,
  capStart: true,
  capEnd: true,
  pressureGamma: 1.7,
  opacity: 0.94,
}

const ZOOM_WHEEL_FACTOR = 1.0015 // per pixel of deltaY when zooming

async function main(): Promise<void> {
  initTheme()

  const root = document.getElementById('app')
  if (!root) throw new Error('#app not found')

  const target = setupCanvas(root)
  const camera = makeCamera()

  const metrics = new MetricsCollector()
  const hud = createHud()
  document.body.appendChild(hud.el)
  bindHudToggle(hud)
  hud.setVisible(true)

  const pill = createPill()
  document.body.appendChild(pill.el)

  const help = createHelp()
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
  const toBoard = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = root.getBoundingClientRect()
    return screenToBoard(camera, clientX - rect.left, clientY - rect.top)
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
        liveStroke.brush.opacity ?? 1,
      )
    }
  }

  const params = new URLSearchParams(location.search)
  const usePrediction = params.has('predict')

  // ---- Pan: spacebar+drag (universal) and middle-mouse-button drag.
  //
  // Wacom users typically map a pen barrel-button to middle-click via the
  // tablet's driver — that lets them pan without leaving the pen. Trackpad
  // two-finger swipe already pans via the wheel handler below.
  let spaceHeld = false
  let panState: {
    pointerId: number
    startClientX: number
    startClientY: number
    startCameraX: number
    startCameraY: number
  } | null = null

  const isPanIntent = (e: PointerEvent): boolean => spaceHeld || e.button === 1

  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !e.repeat) {
      spaceHeld = true
      if (!panState) root.dataset.input = 'pan'
    }
  })
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      spaceHeld = false
      if (!panState) delete root.dataset.input
    }
  })

  root.addEventListener('pointerdown', (e) => {
    if (!isPanIntent(e)) return
    e.preventDefault()
    root.setPointerCapture(e.pointerId)
    root.dataset.input = 'panning'
    panState = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startCameraX: camera.x,
      startCameraY: camera.y,
    }
  })

  root.addEventListener('pointermove', (e) => {
    if (!panState || e.pointerId !== panState.pointerId) return
    const dx = e.clientX - panState.startClientX
    const dy = e.clientY - panState.startClientY
    camera.x = panState.startCameraX - dx / camera.scale
    camera.y = panState.startCameraY - dy / camera.scale
    committedDirty = true
  })

  const endPan = (e: PointerEvent): void => {
    if (!panState || e.pointerId !== panState.pointerId) return
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId)
    panState = null
    if (spaceHeld) root.dataset.input = 'pan'
    else delete root.dataset.input
  }
  root.addEventListener('pointerup', endPan)
  root.addEventListener('pointercancel', endPan)

  // Suppress the browser's middle-click auto-scroll cursor on Windows/Linux.
  root.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault()
  })

  const detachPointer = attachPointer(root, {
    getBrush: () => PEN_BRUSH,
    toBoard,
    usePrediction,
    shouldSkip: isPanIntent,
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

  // Metrics: separate pointermove listener so the HUD reflects the actual
  // coalesced sample count, regardless of stroke state.
  root.addEventListener('pointermove', (e) => {
    if (!(e instanceof PointerEvent)) return
    const coalesced = e.getCoalescedEvents().length || 1
    metrics.notePointerEvent(coalesced)
  })

  // Wheel: pan (plain) or zoom (Cmd/Ctrl/pinch).
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const rect = root.getBoundingClientRect()
      const fx = e.clientX - rect.left
      const fy = e.clientY - rect.top
      if (e.ctrlKey || e.metaKey) {
        const factor = ZOOM_WHEEL_FACTOR ** -e.deltaY
        zoomAt(camera, fx, fy, factor)
      } else {
        panByScreen(camera, -e.deltaX, -e.deltaY)
      }
      committedDirty = true
    },
    { passive: false },
  )

  // Theme change: re-render committed strokes (color / grid follow theme).
  document.documentElement.addEventListener('themechange', () => {
    committedDirty = true
    pill.update()
  })
  pill.update()

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
      committedDirty = true
      return
    }
    if (meta && (e.key === '=' || e.key === '+')) {
      e.preventDefault()
      const cx = target.width / 2
      const cy = target.height / 2
      zoomAt(camera, cx, cy, 1.2)
      committedDirty = true
      return
    }
    if (meta && e.key === '-') {
      e.preventDefault()
      const cx = target.width / 2
      const cy = target.height / 2
      zoomAt(camera, cx, cy, 1 / 1.2)
      committedDirty = true
      return
    }
    if (meta && e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      strokes.length = 0
      redoStack.length = 0
      committedDirty = true
      void clearAllStrokes()
      return
    }
    if (e.key === 't' && !meta && !e.altKey) {
      cycleMode()
      pill.update()
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
      drawGrid(target.committed, camera, target.width, target.height)
      applyCamera(target.committed, camera, target.dpr)
      for (const s of strokes) {
        const path = getStrokePath(s, [], true)
        if (path) {
          drawStrokePath(
            target.committed,
            path,
            resolveInkColor(s.brush.color),
            s.brush.opacity ?? 1,
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

interface Pill {
  el: HTMLElement
  update: () => void
}

function createPill(): Pill {
  const el = document.createElement('div')
  el.id = 'whiteboard-pill'
  const update = () => {
    const mode = getMode()
    const effective = getEffective()
    const themeStr = mode === 'system' ? `theme: system (${effective})` : `theme: ${mode}`
    el.textContent = `${themeStr}  ·  ? for help`
  }
  return { el, update }
}

interface Help {
  el: HTMLElement
  toggle: () => void
}

function createHelp(): Help {
  const el = document.createElement('div')
  el.id = 'whiteboard-help'
  el.style.display = 'none'
  el.textContent = [
    '⌘/Ctrl + Z         undo',
    '⌘/Ctrl + Shift + Z redo   (also ⌘/Ctrl + Y)',
    '',
    'M                  toggle metrics',
    'T                  cycle theme',
    '?                  toggle this help',
    '⌘/Ctrl + 0         reset zoom',
    '⌘/Ctrl + +/-       zoom in/out',
    '⌘/Ctrl + Shift + K clear board (irreversible)',
    '',
    'wheel / 2-finger   pan',
    '⌘/Ctrl + wheel     zoom',
    'pinch              zoom',
    'space + drag       pan (any device)',
    'middle-mouse drag  pan',
  ].join('\n')
  const toggle = () => {
    el.style.display = el.style.display === 'none' ? 'block' : 'none'
  }
  return { el, toggle }
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
    brush: PEN_BRUSH,
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
      synth.brush.opacity ?? 1,
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
