/**
 * Per-frame image render pass. Extracted from main.ts so the orchestrator
 * stays focused on event wiring and tool dispatch — anything that touches
 * pixel-by-pixel image painting (viewport cull, rotation transform, batch-
 * delete dashed outline) lives here behind a single `renderImages` entry
 * point.
 *
 * Contract: callers must have already applied the camera transform to the
 * target layer (via `applyCamera`). The pass draws each non-deleted image
 * in z-order, viewport-culled by its rotation-aware AABB. Images whose
 * HTMLImageElement isn't yet in the runtime cache are skipped silently —
 * the cache's load promise will set `committedDirty` so they appear on a
 * later frame.
 *
 * Coupling to main.ts kept minimal: callers pass the images list,
 * camera, viewport bbox, and a predicate identifying images that are
 * part of a Select-tool multi-selection. No imports from main.ts.
 */

import type { ImageObject } from '@whiteboard/shared'
import type { Camera } from './camera'
import { ROTATION_EPSILON, type ViewBBox } from './geom'
import { getImageElement } from './imagecache'
import { imageAABB } from './imagegeom'
import type { CanvasLayer } from './render'
import { drawMultiSelectionOutline } from './selectionoutline'

export interface RenderImagesParams {
  /** All images (deleted ones are filtered here). Caller-owned order;
   *  expected to be paste-time monotonic (== z-order). */
  images: readonly ImageObject[]
  /** Committed layer with camera transform already applied. */
  layer: CanvasLayer
  /** Camera scale — used to keep the multi-selection outline stroke
   *  width and dash pattern visually constant under zoom. */
  camera: Camera
  /** Board-space viewport bbox for culling. */
  viewBBox: ViewBBox
  /** Predicate identifying images that are part of a Select-tool
   *  multi-selection (length > 1; the single-selection visual is
   *  painted by Select's own redraw with handles + outline). Used to
   *  decorate each image with a dashed accent outline. */
  isMultiSelected: (id: string) => boolean
}

export function renderImages(params: RenderImagesParams): void {
  const { images, layer, camera, viewBBox, isMultiSelected } = params
  const ctx = layer.ctx
  for (const img of images) {
    if (img.deleted) continue
    const el = getImageElement(img.blobRef)
    if (!el) continue
    // Viewport cull uses the rotation-aware AABB so a rotated image
    // poking into the viewport isn't culled when its un-rotated rect
    // happens to be off-screen.
    const bb = imageAABB(img)
    if (bb.maxX < viewBBox.minX || bb.minX > viewBBox.maxX) continue
    if (bb.maxY < viewBBox.minY || bb.minY > viewBBox.maxY) continue
    const { x, y, w, h } = img.transform
    const r = img.rotation ?? 0
    const inMultiSelection = isMultiSelected(img.id)
    if (Math.abs(r) < ROTATION_EPSILON) {
      ctx.drawImage(el, x, y, w, h)
      if (inMultiSelection) drawMultiSelectionOutline(ctx, x, y, w, h, camera.scale)
    } else {
      ctx.save()
      ctx.translate(x + w / 2, y + h / 2)
      ctx.rotate(r)
      ctx.drawImage(el, -w / 2, -h / 2, w, h)
      if (inMultiSelection) drawMultiSelectionOutline(ctx, -w / 2, -h / 2, w, h, camera.scale)
      ctx.restore()
    }
  }
}
