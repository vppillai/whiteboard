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
 * Coupling to main.ts kept minimal: callers pass the images list, camera,
 * viewport bbox, and the batch-delete mark set (via a predicate). No
 * imports from main.ts.
 */

import type { ImageObject } from '@whiteboard/shared'
import type { Camera } from './camera'
import { getImageElement } from './imagecache'
import { imageAABB } from './imagegeom'
import type { CanvasLayer } from './render'

/** Axis-aligned viewport bbox in board coordinates. Matches the inline
 *  shape used by the main render loop so callers don't need a helper. */
export interface ViewBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface RenderImagesParams {
  /** All images (deleted ones are filtered here). Caller-owned order;
   *  expected to be paste-time monotonic (== z-order). */
  images: readonly ImageObject[]
  /** Committed layer with camera transform already applied. */
  layer: CanvasLayer
  /** Camera scale — used to keep batch-delete outline stroke width and
   *  dash pattern visually constant under zoom. */
  camera: Camera
  /** Board-space viewport bbox for culling. */
  viewBBox: ViewBBox
  /** Predicate identifying images that should render with the dashed
   *  batch-delete outline (Cmd+A flow). */
  isMarkedForBatchDelete: (id: string) => boolean
}

/**
 * Treat near-zero rotation as exact zero so float drift (rotate-to-zero
 * overshoot, `-0`, accumulated 1e-15) doesn't drop us into the slower
 * save/translate/rotate path for no visible difference. Mirrors the
 * imagegeom.ts ROTATION_EPSILON; kept local rather than imported to
 * avoid a cross-module dependency on a constant that may diverge if
 * the render fast-path tolerance ever differs from the geometry one.
 */
const ROTATION_EPSILON = 1e-9

const BATCH_OUTLINE_COLOR = '#2563eb'

export function renderImages(params: RenderImagesParams): void {
  const { images, layer, camera, viewBBox, isMarkedForBatchDelete } = params
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
    const isMarked = isMarkedForBatchDelete(img.id)
    if (Math.abs(r) < ROTATION_EPSILON) {
      ctx.drawImage(el, x, y, w, h)
      if (isMarked) drawBatchOutline(ctx, x, y, w, h, camera.scale)
    } else {
      ctx.save()
      ctx.translate(x + w / 2, y + h / 2)
      ctx.rotate(r)
      ctx.drawImage(el, -w / 2, -h / 2, w, h)
      if (isMarked) drawBatchOutline(ctx, -w / 2, -h / 2, w, h, camera.scale)
      ctx.restore()
    }
  }
}

/** Thin dashed outline drawn around a batch-marked image. Stroke width
 *  and dash pattern divide by camera.scale so the outline reads as ~2px
 *  thick at any zoom level — matches the way the Select tool draws its
 *  handles. */
function drawBatchOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  scale: number,
): void {
  ctx.save()
  ctx.strokeStyle = BATCH_OUTLINE_COLOR
  ctx.lineWidth = 2 / scale
  ctx.setLineDash([6 / scale, 4 / scale])
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}
