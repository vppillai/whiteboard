/**
 * Shared rotation-aware geometry primitives. Single source of truth for
 * the epsilon, point rotation, and rotated-rect AABB math that the
 * per-kind geometry modules (`imagegeom.ts`, `textgeom.ts`,
 * `rendershapes.ts`) previously each re-implemented — drift in any one
 * of them shows up as visual desync between render, hit-test, cull,
 * and export bounds, so one source of truth matters.
 *
 * Convention: rotation is in radians, around a rect's CENTER. Positive =
 * clockwise (the canvas y-axis points down, so positive rotation looks
 * clockwise visually).
 *
 * This module is intentionally DOM-free (no canvas types) so it can be
 * consumed from bun:test and the export serializers without a browser.
 */

/**
 * Epsilon under which a rotation is treated as "effectively zero" so the
 * fast unrotated path can be taken. Guards against float drift (e.g. a
 * rotate-to-zero reset that overshoots by 1e-15, `-0`, or accumulated
 * error from repeated transforms). 1e-9 rad ≈ 5.7e-8 degrees — well below
 * any visually perceptible rotation.
 */
export const ROTATION_EPSILON = 1e-9

/** Axis-aligned bbox in board coordinates. Used both for object AABBs
 *  and for the viewport cull rect the render passes receive. */
export interface ViewBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Rotate `p` by `rad` around the pivot `c`. */
export function rotateAroundPoint(
  p: { x: number; y: number },
  c: { x: number; y: number },
  rad: number,
): { x: number; y: number } {
  if (Math.abs(rad) < ROTATION_EPSILON) return { x: p.x, y: p.y }
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return {
    x: c.x + dx * cos - dy * sin,
    y: c.y + dx * sin + dy * cos,
  }
}

/**
 * Axis-aligned bounding box of the rect [minX..maxX]×[minY..maxY] after
 * rotating it by `rad` around the pivot (cx, cy). Near-zero rotations
 * (|rad| < ROTATION_EPSILON) return the input rect unchanged.
 *
 * The pivot is passed explicitly (rather than derived from the rect)
 * because callers rotate around the UN-padded / UN-normalized rect
 * center — e.g. `shapeAABB` pads the rect by stroke width but still
 * pivots on the raw transform center.
 */
export function rotatedRectAABB(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  cx: number,
  cy: number,
  rad: number,
): ViewBBox {
  if (Math.abs(rad) < ROTATION_EPSILON) {
    return { minX, minY, maxX, maxY }
  }
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  // NW, NE, SE, SW corner order.
  const corners: Array<[number, number]> = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ]
  let oMinX = Number.POSITIVE_INFINITY
  let oMinY = Number.POSITIVE_INFINITY
  let oMaxX = Number.NEGATIVE_INFINITY
  let oMaxY = Number.NEGATIVE_INFINITY
  for (const [px, py] of corners) {
    const dx = px - cx
    const dy = py - cy
    const rx = cx + dx * cos - dy * sin
    const ry = cy + dx * sin + dy * cos
    if (rx < oMinX) oMinX = rx
    if (rx > oMaxX) oMaxX = rx
    if (ry < oMinY) oMinY = ry
    if (ry > oMaxY) oMaxY = ry
  }
  return { minX: oMinX, minY: oMinY, maxX: oMaxX, maxY: oMaxY }
}
