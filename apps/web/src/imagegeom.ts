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
import { ROTATION_EPSILON, rotateAroundPoint, rotatedRectAABB } from './geom'

/** Center of the image rect in board coords. */
export function imageCenter(t: ImageObject['transform']): { x: number; y: number } {
  return { x: t.x + t.w / 2, y: t.y + t.h / 2 }
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
  const t = img.transform
  return rotatedRectAABB(t.x, t.y, t.x + t.w, t.y + t.h, t.x + t.w / 2, t.y + t.h / 2, r)
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
