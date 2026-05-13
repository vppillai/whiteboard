/**
 * Compute and apply a zoom-to-fit camera transform: place all visible
 * board content inside the viewport with a small margin. Centers the
 * combined bounding box of non-deleted strokes + images + texts; chooses
 * the largest scale ≤ MAX that still fits everything.
 *
 * If the board is empty (no non-deleted objects of any kind), no-ops —
 * there's nothing to fit, so we leave the camera alone.
 */

import type { ImageObject, Stroke, TextObject } from '@whiteboard/shared'
import type { Camera } from './camera'
import { MAX_SCALE, MIN_SCALE } from './camera'
import { imageAABB } from './imagegeom'
import { getStrokeBBox } from './stroke'
import { textAABB } from './textgeom'

const MARGIN_PX = 60

export interface Viewport {
  width: number
  height: number
}

export interface FitContent {
  strokes: readonly Stroke[]
  images?: readonly ImageObject[]
  texts?: readonly TextObject[]
}

export function fitToContent(camera: Camera, content: FitContent, view: Viewport): boolean {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let any = false

  const include = (bb: { minX: number; minY: number; maxX: number; maxY: number }): void => {
    if (bb.minX < minX) minX = bb.minX
    if (bb.minY < minY) minY = bb.minY
    if (bb.maxX > maxX) maxX = bb.maxX
    if (bb.maxY > maxY) maxY = bb.maxY
    any = true
  }

  for (const s of content.strokes) {
    if (s.deleted) continue
    include(getStrokeBBox(s))
  }
  if (content.images) {
    for (const img of content.images) {
      if (img.deleted) continue
      include(imageAABB(img))
    }
  }
  if (content.texts) {
    for (const t of content.texts) {
      if (t.deleted) continue
      include(textAABB(t))
    }
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
