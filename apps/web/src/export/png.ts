/**
 * PNG export. Renders all non-deleted strokes (grid + composited strokes
 * with destination-out erasure) into a detached HTMLCanvasElement sized
 * to the board bounds, then converts via canvas.toBlob.
 *
 * Mirrors the on-screen `frame()` pass-1/pass-2 scaffolding so the export
 * pixel-for-pixel matches what the user sees, using the shared
 * `drawStrokeOntoLayer` helper (M2 Task 3) for the per-stroke work.
 */

import type { Stroke } from '@whiteboard/shared'
import { makeCamera } from '../camera'
import { drawGrid } from '../grid'
import { type CanvasLayer, applyCamera, clearLayer, drawStrokeOntoLayer } from '../render'
import type { SettingsV1 } from '../settings'
import { effectiveOpacity, getStrokePath } from '../stroke'
import { resolveInkColor } from '../theme'
import type { Bounds } from './bounds'

/**
 * Render the board (grid + strokes + erasure) into a PNG blob. Filename is
 * provided by the caller (export/index.ts dispatcher).
 *
 * @param strokes  All strokes; deleted + zero-sample entries are skipped.
 * @param bounds   The output rectangle in board coordinates (export/bounds.ts).
 * @param settings A SettingsV1 snapshot (`getSettings()`); only `grid` is
 *                 consumed but the full shape is passed for future-proofing.
 */
export function exportPNG(strokes: Stroke[], bounds: Bounds, settings: SettingsV1): Promise<Blob> {
  // v1 ships at 1× DPR; spec § 7.1 / § 9 marks 2× / 4× selector as a follow-up.
  const dpr = 1
  const w = Math.max(1, Math.ceil(bounds.width * dpr))
  const h = Math.max(1, Math.ceil(bounds.height * dpr))

  // Two detached canvases: strokes (offscreen scratch for destination-out)
  // + committed (grid + composite, the final output).
  const strokesLayer = makeDetachedLayer(w, h)
  const committedLayer = makeDetachedLayer(w, h)

  // Camera anchored on bounds top-left, no zoom — board coord (bounds.x,
  // bounds.y) maps to canvas (0, 0). Mirrors applyCamera's semantics.
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

  // ----- Pass 2: committed = grid + composited strokes -----
  clearLayer(committedLayer)
  applyCamera(committedLayer, camera, dpr)
  drawGrid(committedLayer, camera, bounds.width, bounds.height, settings.grid)
  const cCtx = committedLayer.ctx
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

function makeDetachedLayer(w: number, h: number): CanvasLayer {
  const el = document.createElement('canvas')
  el.width = w
  el.height = h
  const ctx = el.getContext('2d')
  if (!ctx) throw new Error('export/png: 2D canvas context unavailable')
  return { el, ctx }
}
