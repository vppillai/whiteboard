/**
 * Rotation-aware geometry helpers for image objects. Centralized here so
 * the same math drives on-screen render, hit-test, handles, AABB for
 * export bounds, and the export formats themselves — drift in any one
 * of them shows up as visual desync, so one source of truth matters.
 *
 * Convention: rotation is in radians, around the image rect's CENTER.
 * Positive = clockwise (the canvas y-axis points down, so positive
 * rotation looks clockwise visually).
 */

import type { ImageObject } from '@whiteboard/shared'

/** Center of the image rect in board coords. */
export function imageCenter(t: ImageObject['transform']): { x: number; y: number } {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 }
}

/**
 * Epsilon under which a rotation is treated as "effectively zero" so the
 * fast unrotated path can be taken. Guards against float drift (e.g. a
 * rotate-to-zero reset that overshoots by 1e-15, `-0`, or accumulated
 * error from repeated transforms). 1e-9 rad ≈ 5.7e-8 degrees — well below
 * any visually perceptible rotation.
 */
const ROTATION_EPSILON = 1e-9

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

/** The four corners of the un-rotated rect, in board coords. NW, NE, SE, SW order. */
export function rectCorners(
  t: ImageObject['transform'],
): [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
] {
  return [
    { x: t.x, y: t.y },
    { x: t.x + t.w, y: t.y },
    { x: t.x + t.w, y: t.y + t.h },
    { x: t.x, y: t.y + t.h },
  ]
}

/** Axis-aligned bounding box of the image, accounting for rotation. */
export function imageAABB(img: ImageObject): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const r = img.rotation ?? 0
  if (Math.abs(r) < ROTATION_EPSILON) {
    return {
      minX: img.transform.x,
      minY: img.transform.y,
      maxX: img.transform.x + img.transform.w,
      maxY: img.transform.y + img.transform.h,
    }
  }
  const c = imageCenter(img.transform)
  const corners = rectCorners(img.transform).map((p) => rotateAroundPoint(p, c, r))
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of corners) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Point-in-rotated-rect test. The point is inverse-rotated around the
 * image center so the test becomes a plain AABB check against the
 * unrotated rect.
 */
export function pointInImage(p: { x: number; y: number }, img: ImageObject): boolean {
  const r = img.rotation ?? 0
  const c = imageCenter(img.transform)
  const local = Math.abs(r) < ROTATION_EPSILON ? p : rotateAroundPoint(p, c, -r)
  const t = img.transform
  return local.x >= t.x && local.x <= t.x + t.w && local.y >= t.y && local.y <= t.y + t.h
}
