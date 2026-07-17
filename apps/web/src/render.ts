/**
 * Three-layer canvas:
 *
 *   - **committed** — in DOM. Background grid + composited stroke pixels.
 *     Re-rendered on commit / camera change / theme change.
 *   - **strokes** — offscreen scratch (NOT in DOM). Strokes are drawn here,
 *     then `globalCompositeOperation = 'destination-out'` is applied for
 *     each stroke's `erasedStamps` (ADR 0009 pixel-mask eraser). The
 *     resulting buffer is composited onto `committed` after the grid, so
 *     destination-out can subtract stroke pixels without touching the grid.
 *   - **live** — in DOM. In-flight stroke + tool cursors. Cleared and
 *     redrawn each frame.
 *
 * All three layers are sized in device pixels with a base CSS-pixel
 * transform. The camera transform is layered on top via applyCamera();
 * render output is in board space.
 */

import type { Camera } from './camera'

export interface CanvasLayer {
  el: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
}

export interface RenderTarget {
  committed: CanvasLayer
  strokes: CanvasLayer
  live: CanvasLayer
  /** CSS pixels. */
  width: number
  height: number
  dpr: number
  /** Remove the window-resize listener. Used at HMR / page-unload teardown. */
  cleanup(): void
}

export function setupCanvas(
  parent: HTMLElement,
  /** Called after every re-rasterize triggered by a window resize or a
   *  devicePixelRatio change (NOT the initial synchronous sizing).
   *  Assigning canvas width/height ERASES the bitmap per the HTML spec,
   *  so the caller must mark its render state dirty here or the board
   *  stays blank until the next unrelated repaint. */
  onResize?: () => void,
): RenderTarget {
  const committed = makeLayer()
  const strokes = makeLayer()
  const live = makeLayer()
  // Only committed and live live in the DOM. `strokes` is an offscreen
  // scratch — never appended.
  parent.append(committed.el, live.el)

  const resize = () => {
    const rect = parent.getBoundingClientRect()
    target.width = rect.width
    target.height = rect.height
    target.dpr = window.devicePixelRatio || 1

    for (const layer of [committed, strokes, live]) {
      layer.el.width = Math.max(1, Math.floor(target.width * target.dpr))
      layer.el.height = Math.max(1, Math.floor(target.height * target.dpr))
      layer.el.style.width = `${target.width}px`
      layer.el.style.height = `${target.height}px`
      // Reset to identity; callers apply camera transform per draw pass.
      layer.ctx.setTransform(target.dpr, 0, 0, target.dpr, 0, 0)
    }
  }

  const onExternalResize = () => {
    resize()
    onResize?.()
  }

  // devicePixelRatio changes (drag between monitors of different DPI,
  // browser zoom) do NOT fire a window `resize` when the CSS-pixel size
  // is unchanged — the standard detector is a matchMedia listener on the
  // CURRENT resolution, re-armed after each fire because the query
  // string bakes in the old dpr.
  let dprMedia: MediaQueryList | null = null
  const onDprChange = (): void => {
    onExternalResize()
    armDprListener()
  }
  const armDprListener = (): void => {
    dprMedia?.removeEventListener('change', onDprChange)
    dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    dprMedia.addEventListener('change', onDprChange)
  }

  const target: RenderTarget = {
    committed,
    strokes,
    live,
    width: 0,
    height: 0,
    dpr: window.devicePixelRatio || 1,
    cleanup: () => {
      window.removeEventListener('resize', onExternalResize)
      dprMedia?.removeEventListener('change', onDprChange)
    },
  }

  resize()
  window.addEventListener('resize', onExternalResize)
  armDprListener()

  return target
}

function makeLayer(): CanvasLayer {
  const el = document.createElement('canvas')
  const ctx = el.getContext('2d', { desynchronized: true, alpha: true })
  if (!ctx) throw new Error('2D canvas context unavailable')
  return { el, ctx }
}

/**
 * Set the layer's transform to: device-pixel scaling × camera. After this,
 * draws should be in board space (CSS pixels at scale 1).
 */
export function applyCamera(layer: CanvasLayer, camera: Camera, dpr: number): void {
  const a = camera.scale * dpr
  layer.ctx.setTransform(a, 0, 0, a, -camera.x * a, -camera.y * a)
}

/** Clears the entire canvas regardless of current transform. */
export function clearLayer(layer: CanvasLayer): void {
  const { ctx, el } = layer
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, el.width, el.height)
  ctx.restore()
}

export function drawStrokePath(layer: CanvasLayer, path: Path2D, color: string, opacity = 1): void {
  const { ctx } = layer
  if (opacity >= 1) {
    ctx.fillStyle = color
    ctx.fill(path)
    return
  }
  // Wrap in save/restore so we don't leak globalAlpha to subsequent draws.
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.fillStyle = color
  ctx.fill(path)
  ctx.restore()
}

/** Cursor-disk record for the pixel-mask wipe eraser (ADR 0009). */
export interface EraseStamp {
  x: number
  y: number
  r: number
}

/**
 * Render one stroke's outline + its destination-out erasure stamps onto
 * `layer`. Both committed `erasedStamps` and any in-flight `pendingStamps`
 * subtract from the just-drawn outline.
 *
 * Used by both the on-screen `frame()` render and the PNG export path so
 * the two render paths can't drift. Caller must clear + apply-camera to
 * `layer` before the first stroke and composite the layer after the last
 * (per ADR 0009 — destination-out on a strokes-only offscreen, then
 * composite over the grid).
 */
export function drawStrokeOntoLayer(
  layer: CanvasLayer,
  path: Path2D,
  color: string,
  opacity: number,
  committedStamps: readonly EraseStamp[] | undefined,
  pendingStamps?: readonly EraseStamp[],
): void {
  drawStrokePath(layer, path, color, opacity)
  if (!committedStamps?.length && !pendingStamps?.length) return
  const { ctx } = layer
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#000' // destination-out only cares about source alpha
  if (committedStamps) {
    for (const st of committedStamps) {
      ctx.beginPath()
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  if (pendingStamps) {
    for (const st of pendingStamps) {
      ctx.beginPath()
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}
