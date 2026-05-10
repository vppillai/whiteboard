/**
 * Compute the bounding rectangle of all non-deleted strokes, plus a
 * 32 px margin. Returns null when there's nothing to export.
 *
 * Used by the export pipeline (PNG / SVG / PDF) to size the output canvas /
 * viewBox / PDF page to the actual drawn content rather than the viewport.
 */

import type { Stroke } from '@whiteboard/shared'
import { getStrokeBBox } from '../stroke'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export const EXPORT_MARGIN = 32

export function computeBoardBounds(strokes: Stroke[]): Bounds | null {
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
  if (!any) return null
  return {
    x: minX - EXPORT_MARGIN,
    y: minY - EXPORT_MARGIN,
    width: maxX - minX + 2 * EXPORT_MARGIN,
    height: maxY - minY + 2 * EXPORT_MARGIN,
  }
}
