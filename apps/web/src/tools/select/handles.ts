/**
 * Pure handle geometry for the Select tool. Every function here is a
 * function of (transform, rotation, scale) only — no selection state,
 * no deps, no DOM — extracted from select.ts so the handle math is
 * readable (and testable) independently of the tool's interaction
 * state machine. See ADR 0014 for the ObjectView abstraction these
 * operate on.
 */

import type { ImageObject } from '@whiteboard/shared'
import { rotateAroundPoint } from '../../geom'
import type { ObjectView } from '../select'

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** Distance from the top-center handle to the rotation handle, in screen
 *  pixels. Constant so it stays the same visual offset at every zoom. */
const ROTATE_HANDLE_OFFSET_PX = 24

/** Half a handle, plus padding, in screen pixels — hit-test tolerance. */
const HANDLE_HIT_PX = 10

/** Returns the 8 handle positions in board space for a transform rect.
 *  Already rotated around the rect center when rotation is non-zero.
 *  Generalized over object kind — operates purely on transform + rotation. */
export function handlePositions(
  t: ImageObject['transform'],
  rotation: number,
): Record<HandleId, { x: number; y: number }> {
  const cx = t.x + t.w / 2
  const cy = t.y + t.h / 2
  const local: Record<HandleId, { x: number; y: number }> = {
    nw: { x: t.x, y: t.y },
    n: { x: cx, y: t.y },
    ne: { x: t.x + t.w, y: t.y },
    e: { x: t.x + t.w, y: cy },
    se: { x: t.x + t.w, y: t.y + t.h },
    s: { x: cx, y: t.y + t.h },
    sw: { x: t.x, y: t.y + t.h },
    w: { x: t.x, y: cy },
  }
  if (rotation === 0) return local
  const c = { x: cx, y: cy }
  const out = {} as Record<HandleId, { x: number; y: number }>
  for (const id of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
    out[id] = rotateAroundPoint(local[id], c, rotation)
  }
  return out
}

/** Rotation handle position in board space — `ROTATE_HANDLE_OFFSET_PX`
 *  above the N handle, then rotated. Pass scale so the screen-space
 *  offset stays constant regardless of zoom. Generalized over kind. */
export function rotationHandlePos(
  t: ImageObject['transform'],
  rotation: number,
  scale: number,
): { x: number; y: number } {
  const cx = t.x + t.w / 2
  const cy = t.y + t.h / 2
  const offsetBoard = ROTATE_HANDLE_OFFSET_PX / scale
  const local = { x: cx, y: t.y - offsetBoard }
  return rotation === 0 ? local : rotateAroundPoint(local, { x: cx, y: cy }, rotation)
}

/** Compute the anchor (opposite handle's position) in BOARD space at
 *  drag-start, accounting for rotation. The anchor stays fixed in board
 *  space throughout the resize drag — that invariance is what lets the
 *  resize feel correct on rotated images. */
export function anchorBoardFor(
  handle: HandleId,
  t: ImageObject['transform'],
  rotation: number,
): { x: number; y: number } {
  const cx = t.x + t.w / 2
  const cy = t.y + t.h / 2
  // Local offset of the anchor from the image center, where +x is the
  // image's right and +y is its down (pre-rotation). Anchor is the
  // OPPOSITE of the dragged handle.
  let ox = 0
  let oy = 0
  switch (handle) {
    case 'nw':
      ox = +t.w / 2
      oy = +t.h / 2
      break // anchor = SE corner
    case 'n':
      ox = 0
      oy = +t.h / 2
      break // anchor = S edge mid
    case 'ne':
      ox = -t.w / 2
      oy = +t.h / 2
      break // anchor = SW corner
    case 'e':
      ox = -t.w / 2
      oy = 0
      break // anchor = W edge mid
    case 'se':
      ox = -t.w / 2
      oy = -t.h / 2
      break // anchor = NW corner
    case 's':
      ox = 0
      oy = -t.h / 2
      break // anchor = N edge mid
    case 'sw':
      ox = +t.w / 2
      oy = -t.h / 2
      break // anchor = NE corner
    case 'w':
      ox = +t.w / 2
      oy = 0
      break // anchor = E edge mid
  }
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { x: cx + ox * cos - oy * sin, y: cy + ox * sin + oy * cos }
}

/**
 * Resize cursor that matches the handle's *effective* on-screen direction,
 * accounting for image rotation. Without this, the cursor stays
 * "↖↘ nwse-resize" even after the image is rotated 90°, where the NW
 * handle visually points up/down — bad UX feedback.
 *
 * The 4 built-in CSS resize cursors are at 45° increments; we bucket the
 * effective angle to the nearest one.
 */
export function cursorFor(handle: HandleId, rotationRad: number): string {
  // Base "outward" angle from image center to each handle, in degrees,
  // with 0° = north and increasing clockwise (matches CSS convention).
  const baseDeg: Record<HandleId, number> = {
    n: 0,
    ne: 45,
    e: 90,
    se: 135,
    s: 180,
    sw: 225,
    w: 270,
    nw: 315,
  }
  const effective = baseDeg[handle] + (rotationRad * 180) / Math.PI
  // Normalize to [0, 360) then bucket to nearest 45°. Opposite pairs
  // share a cursor (nw/se → nwse, etc.), so we take bucket mod 4.
  const normalized = ((effective % 360) + 360) % 360
  const bucket = Math.round(normalized / 45) % 4
  switch (bucket) {
    case 0:
      return 'ns-resize'
    case 1:
      return 'nesw-resize'
    case 2:
      return 'ew-resize'
    case 3:
      return 'nwse-resize'
  }
  return 'default'
}

/** Hit-test against the selected object's handles (board coords). Returns
 *  null if not over any handle. Considers an HANDLE_HIT_PX-radius hit
 *  zone *in screen pixels* converted back to board space via scale.
 *
 *  Per-kind handle availability:
 *    - Image: 4 corners + 4 edges (8 total). Corners do
 *      anchor-preserving rect resize; edges do 1-axis rect resize.
 *    - Text: 4 corners (resize = font-size scale) + 2 horizontal
 *      edges (`e`, `w`) for wrap-width adjustment. Vertical edges
 *      (`n`, `s`) are hidden because text height is content-derived
 *      (changing it doesn't have a useful semantic). */
export function handleAt(
  boardX: number,
  boardY: number,
  view: ObjectView,
  scale: number,
): HandleId | null {
  const tol = HANDLE_HIT_PX / scale
  const positions = handlePositions(view.transform, view.rotation)
  const enabled =
    view.selection.kind === 'text'
      ? (['nw', 'ne', 'se', 'sw', 'e', 'w'] as const)
      : (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const)
  for (const id of enabled) {
    const p = positions[id]
    if (Math.abs(p.x - boardX) <= tol && Math.abs(p.y - boardY) <= tol) return id
  }
  return null
}

/** Hit-test the rotation handle. Returns true if board pointer is within
 *  the rotation handle's hit zone. */
export function isOverRotationHandle(
  boardX: number,
  boardY: number,
  view: ObjectView,
  scale: number,
): boolean {
  const tol = HANDLE_HIT_PX / scale
  const p = rotationHandlePos(view.transform, view.rotation, scale)
  return Math.abs(p.x - boardX) <= tol && Math.abs(p.y - boardY) <= tol
}
