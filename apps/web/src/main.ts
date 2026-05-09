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
import { clearAllStrokes, loadAllStrokes, saveStroke } from './storage'
import { getStrokePath } from './stroke'
import { cycleMode, getEffective, getMode, initTheme, resolveInkColor } from './theme'

const PEN_BRUSH: BrushConfig = {
  size: 3,
  color: 'ink',
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  taperStart: 0,
  taperEnd: 0,
  capStart: true,
  capEnd: true,
  pressureGamma: 2.0,
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
  let liveStroke: Stroke | null = null
  let livePredicted: Sample[] = []
  let liveDirty = false
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

  const detachPointer = attachPointer(root, {
    getBrush: () => PEN_BRUSH,
    toBoard,
    callbacks: {
      onStrokeStart(stroke) {
        liveStroke = stroke
        livePredicted = []
        liveDirty = true
      },
      onStrokeUpdate(_stroke, predicted) {
        livePredicted = predicted
        liveDirty = true
      },
      onStrokeCommit(stroke) {
        strokes.push(stroke)
        liveStroke = null
        livePredicted = []
        liveDirty = false
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
      liveDirty = true
    },
    { passive: false },
  )

  // Theme change: re-render committed strokes (color / grid follow theme).
  document.documentElement.addEventListener('themechange', () => {
    committedDirty = true
    pill.update()
  })
  pill.update()

  // Keyboard shortcuts.
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey
    if (meta && e.key === '0') {
      e.preventDefault()
      resetZoom(camera)
      committedDirty = true
      liveDirty = true
      return
    }
    if (meta && (e.key === '=' || e.key === '+')) {
      e.preventDefault()
      const cx = target.width / 2
      const cy = target.height / 2
      zoomAt(camera, cx, cy, 1.2)
      committedDirty = true
      liveDirty = true
      return
    }
    if (meta && e.key === '-') {
      e.preventDefault()
      const cx = target.width / 2
      const cy = target.height / 2
      zoomAt(camera, cx, cy, 1 / 1.2)
      committedDirty = true
      liveDirty = true
      return
    }
    if (meta && e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      strokes.length = 0
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

  // Render loop.
  function frame(now: DOMHighResTimeStamp): void {
    metrics.noteFrame(now)

    if (committedDirty) {
      clearLayer(target.committed)
      drawGrid(target.committed, camera, target.width, target.height)
      applyCamera(target.committed, camera, target.dpr)
      for (const s of strokes) {
        const path = getStrokePath(s)
        if (path) drawStrokePath(target.committed, path, resolveInkColor(s.brush.color))
      }
      committedDirty = false
      liveDirty = true // live layer needs re-render on top of new committed
    }

    if (liveDirty) {
      clearLayer(target.live)
      if (liveStroke) {
        applyCamera(target.live, camera, target.dpr)
        const path = getStrokePath(liveStroke, livePredicted)
        if (path) drawStrokePath(target.live, path, resolveInkColor(liveStroke.brush.color))
      }
      liveDirty = false
    }

    hud.update(metrics.state)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // Cleanup on unload (mostly belt-and-suspenders for HMR).
  window.addEventListener('beforeunload', () => detachPointer())

  // Perftest mode.
  if (new URLSearchParams(location.search).has('perftest')) {
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
    'M               toggle metrics',
    'T               cycle theme',
    '?               toggle this help',
    '⌘/Ctrl + 0      reset zoom',
    '⌘/Ctrl + +/-    zoom in/out',
    '⌘/Ctrl+Shift+K  clear board',
    'wheel           pan',
    '⌘/Ctrl + wheel  zoom',
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

  const result = await runPerftest({ width: target.width, height: target.height }, (s: Sample) => {
    // Translate screen-space synth coordinates into board space so the
    // stroke ends up where expected under the current camera.
    const board = screenToBoard(camera, s.x, s.y)
    synth.samples.push({ ...s, x: board.x, y: board.y })
    clearLayer(target.live)
    applyCamera(target.live, camera, target.dpr)
    const path = getStrokePath(synth)
    if (path) drawStrokePath(target.live, path, resolveInkColor(synth.brush.color))
  })

  // Commit synthetic stroke to the persistent set so it's visible after the
  // banner closes.
  const path = getStrokePath(synth)
  if (path) drawStrokePath(target.committed, path, resolveInkColor(synth.brush.color))
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
