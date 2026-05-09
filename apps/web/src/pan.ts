/**
 * Spacebar+drag and middle-mouse-button drag panning.
 *
 * Wacom users can map a pen barrel button to middle-click via the tablet
 * driver, which gives them pen-only pan. Trackpad two-finger swipe is
 * handled by the wheel handler in main.ts, not here.
 *
 * The returned `isPanIntent` predicate is what callers (e.g. the draw
 * pointer pipeline) use to skip events that this module is going to handle.
 */

import type { Camera } from './camera'

export interface PanController {
  /**
   * True when this pointerdown should pan instead of doing whatever the
   * caller would otherwise do (typically: draw). True for spacebar-held or
   * middle-button events.
   */
  isPanIntent(e: PointerEvent): boolean
}

export interface PanOptions {
  root: HTMLElement
  camera: Camera
  /** Called whenever the camera position changes, so the renderer can refresh. */
  onCameraChange: () => void
}

interface PanState {
  pointerId: number
  startClientX: number
  startClientY: number
  startCameraX: number
  startCameraY: number
}

export function attachPan(opts: PanOptions): PanController {
  const { root, camera, onCameraChange } = opts

  let spaceHeld = false
  let panState: PanState | null = null

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
    onCameraChange()
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

  // Suppress browser middle-click auto-scroll cursor on Windows/Linux.
  root.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault()
  })

  return { isPanIntent }
}
