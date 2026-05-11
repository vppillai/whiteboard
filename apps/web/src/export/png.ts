/**
 * PNG export. Renders all non-deleted strokes (theme-aware bg + grid + strokes
 * with destination-out erasure) into a detached HTMLCanvasElement sized to
 * the board bounds, then converts via `canvas.toBlob`.
 *
 * Mirrors the on-screen `frame()` pass-1/pass-2 scaffolding so the export
 * matches what the user sees, using the shared `drawStrokeOntoLayer` helper
 * for the per-stroke work.
 */

import type { Stroke } from '@whiteboard/shared'
import { makeCamera } from '../camera'
import { drawGrid } from '../grid'
import { type CanvasLayer, applyCamera, clearLayer, drawStrokeOntoLayer } from '../render'
import type { SettingsV1 } from '../settings'
import { effectiveOpacity, getStrokePath } from '../stroke'
import { resolveInkColor } from '../theme'
import type { Bounds } from './bounds'

export interface PngExportOptions {
  /** Device-pixel-ratio multiplier. Default 1 (matches on-screen-at-100%
   *  zoom). PDF embed bumps to 2 for print quality. */
  dpr?: number
}

/**
 * Render the board (theme bg + grid + strokes + erasure) into a PNG blob.
 * Background color reads from `--bg-canvas` so the export matches the user's
 * active theme — dark theme renders dark-bg PNG so light-ink strokes are
 * visible.
 */
export function exportPNG(
  strokes: Stroke[],
  bounds: Bounds,
  settings: SettingsV1,
  options: PngExportOptions = {},
): Promise<Blob> {
  const dpr = options.dpr ?? 1
  const w = Math.max(1, Math.ceil(bounds.width * dpr))
  const h = Math.max(1, Math.ceil(bounds.height * dpr))

  const strokesLayer = makeDetachedLayer(w, h)
  const committedLayer = makeDetachedLayer(w, h)

  // Camera anchored on bounds top-left, no zoom — board coord (bounds.x,
  // bounds.y) maps to canvas (0, 0).
  const camera = makeCamera()
  camera.x = bounds.x
  camera.y = bounds.y
  camera.scale = 1

  // ----- Pass 1: per-stroke draw + destination-out onto strokes layer -----
  clearLayer(strokesLayer)
  applyCamera(strokesLayer, camera, dpr)
  for (const s of strokes) {
    if (s.deleted) continue
    if (s.samples.length === 0) continue
    const path = getStrokePath(s, [], true)
    if (!path) continue
    drawStrokeOntoLayer(
      strokesLayer,
      path,
      resolveInkColor(s.brush.color),
      effectiveOpacity(s),
      s.erasedStamps,
    )
  }

  // ----- Pass 2: committed = theme bg + grid + composited strokes -----
  clearLayer(committedLayer)
  const cCtx = committedLayer.ctx
  // Theme background — read CSS variable at export time so light / dark
  // themes produce matching PNGs.
  cCtx.save()
  cCtx.setTransform(1, 0, 0, 1, 0, 0)
  cCtx.fillStyle = resolveBgColor()
  cCtx.fillRect(0, 0, w, h)
  cCtx.restore()
  applyCamera(committedLayer, camera, dpr)
  drawGrid(committedLayer, camera, bounds.width, bounds.height, settings.grid)
  cCtx.save()
  cCtx.setTransform(1, 0, 0, 1, 0, 0)
  cCtx.drawImage(strokesLayer.el, 0, 0)
  cCtx.restore()

  return new Promise((resolve, reject) => {
    committedLayer.el.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('export/png: canvas.toBlob returned null'))
    }, 'image/png')
  })
}

function resolveBgColor(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim()
  return v || '#ffffff'
}

function makeDetachedLayer(w: number, h: number): CanvasLayer {
  const el = document.createElement('canvas')
  el.width = w
  el.height = h
  const ctx = el.getContext('2d')
  if (!ctx) throw new Error('export/png: 2D canvas context unavailable')
  return { el, ctx }
}
