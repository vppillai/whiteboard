/**
 * Compute and apply a zoom-to-fit camera transform: place all visible
 * strokes inside the viewport with a small margin. Centers the bounding
 * box of all non-deleted strokes; chooses the largest scale ≤ MAX that
 * still fits everything.
 *
 * If the board is empty (no non-deleted strokes), no-ops — there's nothing
 * to fit, so we leave the camera alone.
 */

import type { Stroke } from '@whiteboard/shared'
import type { Camera } from './camera'
import { MAX_SCALE, MIN_SCALE } from './camera'
import { getStrokeBBox } from './stroke'

const MARGIN_PX = 60

export interface Viewport {
  width: number
  height: number
}

export function fitToContent(camera: Camera, strokes: readonly Stroke[], view: Viewport): boolean {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let any = false
  for (const s of strokes) {
    if (s.deleted) continue
    const bb = getStrokeBBox(s)
    if (bb.minX < minX) minX = bb.minX
    if (bb.minY < minY) minY = bb.minY
    if (bb.maxX > maxX) maxX = bb.maxX
    if (bb.maxY > maxY) maxY = bb.maxY
    any = true
  }
  if (!any) return false

  const bboxW = Math.max(1, maxX - minX)
  const bboxH = Math.max(1, maxY - minY)
  const targetW = Math.max(1, view.width - MARGIN_PX * 2)
  const targetH = Math.max(1, view.height - MARGIN_PX * 2)
  const fitScale = Math.min(targetW / bboxW, targetH / bboxH)
  const scale = clamp(fitScale, MIN_SCALE, MAX_SCALE)
  camera.scale = scale

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  camera.x = cx - view.width / scale / 2
  camera.y = cy - view.height / scale / 2
  return true
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))
