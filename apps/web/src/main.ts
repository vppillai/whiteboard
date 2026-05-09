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
import { openColorPicker } from './colorpicker'
import { drawGrid } from './grid'
import { MetricsCollector, bindHudToggle, createHud } from './metrics'
import { openOptionsMenu } from './optionsmenu'
import { runPerftest } from './perftest'
import { attachPointer } from './pointer'
import { dismissAllPopovers, getActiveTag } from './popover'
import { applyCamera, clearLayer, drawStrokePath, setupCanvas } from './render'
import { getColor, getSettings, onChange as onSettingsChange } from './settings'
import { clearAllStrokes, deleteStroke, loadAllStrokes, saveStroke } from './storage'
import { effectiveOpacity, getStrokePath } from './stroke'
import { cycleMode, initTheme, resolveInkColor } from './theme'
import { openToolMenu } from './toolmenu'

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

  const metrics = new MetricsCollector()
  const hud = createHud()
  document.body.appendChild(hud.el)
  bindHudToggle(hud)
  // HUD defaults to hidden — `M` toggles it on. Most of the time the user just
  // wants to draw; the metrics surface only when something's worth measuring.
  hud.setVisible(false)

  document.body.appendChild(createHelpPill())

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
        effectiveOpacity(liveStroke),
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
        onClear: requestClear,
      })
    },
    { capture: true },
  )

  const detachPointer = attachPointer(root, {
    getBrush: makeBrush,
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

  // Metrics + last-pointer tracking: a separate pointermove listener so the
  // HUD reflects the actual coalesced sample count regardless of stroke state,
  // and so popover keyboard shortcuts can anchor at the most recent pointer.
  let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  root.addEventListener('pointermove', (e) => {
    if (!(e instanceof PointerEvent)) return
    lastPointer = { x: e.clientX, y: e.clientY }
    const coalesced = e.getCoalescedEvents().length || 1
    metrics.notePointerEvent(coalesced)
  })
  document.addEventListener('pointermove', (e) => {
    // Track even outside the canvas so popovers anchor sensibly when the user
    // moves between the pen and the keyboard.
    lastPointer = { x: e.clientX, y: e.clientY }
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
  })

  // Settings change: grid type / spacing / color affects what's rendered.
  onSettingsChange(() => {
    committedDirty = true
  })

  // Clear-board confirmation: a transient toast at the top of the screen with
  // explicit Cancel / Clear buttons. The keyboard path (⌘/Ctrl+Shift+K twice
  // within the window, or Esc to cancel) still works, but the pen-only path —
  // tap "Clear board…" in the right-click menu, then tap Clear in the toast —
  // doesn't require a keyboard at all.
  const CLEAR_CONFIRM_MS = 4000
  const toast = document.createElement('div')
  toast.id = 'whiteboard-toast'
  toast.style.display = 'none'
  document.body.appendChild(toast)

  let clearTimer: ReturnType<typeof setTimeout> | null = null

  const performClear = (): void => {
    strokes.length = 0
    redoStack.length = 0
    committedDirty = true
    void clearAllStrokes().catch((err) => {
      console.warn('whiteboard/web: clear failed:', err)
    })
  }

  const cancelClearConfirm = (): void => {
    if (clearTimer) {
      clearTimeout(clearTimer)
      clearTimer = null
    }
    toast.replaceChildren()
    toast.style.display = 'none'
  }

  const showClearToast = (): void => {
    toast.replaceChildren()
    toast.style.display = 'flex'

    const msg = document.createElement('span')
    msg.className = 'whiteboard-toast-message'
    msg.textContent = 'Clear the whole board?'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'whiteboard-toast-button whiteboard-toast-cancel'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', cancelClearConfirm)

    const confirmBtn = document.createElement('button')
    confirmBtn.type = 'button'
    confirmBtn.className = 'whiteboard-toast-button whiteboard-toast-confirm'
    confirmBtn.textContent = 'Clear'
    confirmBtn.addEventListener('click', () => {
      cancelClearConfirm()
      performClear()
    })

    toast.append(msg, cancelBtn, confirmBtn)
  }

  const requestClear = (): void => {
    if (clearTimer) {
      // Second press of the keyboard shortcut — short-circuit to confirm.
      cancelClearConfirm()
      performClear()
      return
    }
    showClearToast()
    clearTimer = setTimeout(cancelClearConfirm, CLEAR_CONFIRM_MS)
  }

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
    if (meta && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      requestClear()
      return
    }
    if (e.key === 'Escape') {
      let handled = false
      if (clearTimer) {
        cancelClearConfirm()
        handled = true
      }
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

function createHelpPill(): HTMLElement {
  const el = document.createElement('div')
  el.id = 'whiteboard-pill'
  el.textContent = '? for help'
  return el
}

interface Help {
  el: HTMLElement
  toggle: () => void
}

function createHelp(): Help {
  const el = document.createElement('div')
  el.id = 'whiteboard-help'
  el.style.display = 'none'

  const shortcuts = document.createElement('pre')
  shortcuts.className = 'whiteboard-help-shortcuts'
  shortcuts.textContent = [
    'right-click        tool menu (pen-friendly)',
    'C                  color picker (at pointer)',
    'O                  options (grid type, spacing)',
    '',
    '⌘/Ctrl + Z         undo',
    '⌘/Ctrl + Shift + Z redo   (also ⌘/Ctrl + Y)',
    '⌘/Ctrl + Shift + K clear board (confirm twice)',
    '',
    'M                  toggle metrics',
    'T                  cycle theme',
    '?                  toggle this help',
    '',
    '⌘/Ctrl + 0         reset zoom',
    '⌘/Ctrl + +/-       zoom in/out',
    'wheel / 2-finger   pan',
    '⌘/Ctrl + wheel     zoom',
    'pinch              zoom',
    'space + drag       pan (any device)',
    'middle-mouse drag  pan',
    'Esc                close popover / cancel',
  ].join('\n')
  el.appendChild(shortcuts)

  const footer = document.createElement('div')
  footer.className = 'whiteboard-help-footer'
  const link = document.createElement('a')
  link.href = 'https://github.com/vppillai/whiteboard'
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.className = 'whiteboard-help-link'
  link.textContent = 'github.com/vppillai/whiteboard ↗'
  footer.appendChild(link)
  el.appendChild(footer)

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
