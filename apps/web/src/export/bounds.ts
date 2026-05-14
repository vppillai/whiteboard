/**
 * Compute the bounding rectangle of all non-deleted strokes, plus a
 * 32 px margin. Returns null when there's nothing to export.
 *
 * Used by the export pipeline (PNG / SVG / PDF) to size the output canvas /
 * viewBox / PDF page to the actual drawn content rather than the viewport.
 */

import type { ImageObject, Stroke, TextObject } from '@whiteboard/shared'
import type { Camera } from '../camera'
import { imageAABB } from '../imagegeom'
import { getStrokeBBox } from '../stroke'
import { textAABB } from '../textgeom'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export const EXPORT_MARGIN = 32

export function computeBoardBounds(
  strokes: Stroke[],
  images: readonly ImageObject[] = [],
  texts: readonly TextObject[] = [],
): Bounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let any = false
  for (const s of strokes) {
    if (s.deleted) continue
    if (s.samples.length === 0) continue
    const bbox = getStrokeBBox(s)
    if (bbox.minX < minX) minX = bbox.minX
    if (bbox.minY < minY) minY = bbox.minY
    if (bbox.maxX > maxX) maxX = bbox.maxX
    if (bbox.maxY > maxY) maxY = bbox.maxY
    any = true
  }
  for (const img of images) {
    if (img.deleted) continue
    // Rotation-aware AABB so a rotated image's true on-screen extent
    // contributes to the export bounds.
    const bb = imageAABB(img)
    if (bb.minX < minX) minX = bb.minX
    if (bb.minY < minY) minY = bb.minY
    if (bb.maxX > maxX) maxX = bb.maxX
    if (bb.maxY > maxY) maxY = bb.maxY
    any = true
  }
  for (const t of texts) {
    if (t.deleted) continue
    const bb = textAABB(t)
    if (bb.minX < minX) minX = bb.minX
    if (bb.minY < minY) minY = bb.minY
    if (bb.maxX > maxX) maxX = bb.maxX
    if (bb.maxY > maxY) maxY = bb.maxY
    any = true
  }
  if (!any) return null
  return {
    x: minX - EXPORT_MARGIN,
    y: minY - EXPORT_MARGIN,
    width: maxX - minX + 2 * EXPORT_MARGIN,
    height: maxY - minY + 2 * EXPORT_MARGIN,
  }
}

/**
 * Compute the visible viewport's bounds in board coordinates. Returns the
 * rectangle the user can currently see on screen. Used for `scope: 'visible'`
 * exports — what you see is what you get. Never returns null (the viewport
 * always has dimensions); if there are no strokes inside, the export simply
 * captures the grid + background.
 */
export function computeViewportBounds(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
): Bounds {
  // Screen (0, 0) maps to board (camera.x, camera.y); screen (w, h) maps to
  // board (camera.x + w/scale, camera.y + h/scale).
  return {
    x: camera.x,
    y: camera.y,
    width: viewportWidth / camera.scale,
    height: viewportHeight / camera.scale,
  }
}
