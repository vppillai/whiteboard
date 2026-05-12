/**
 * Select tool — for manipulating non-stroke objects (images at v1; future
 * floating objects inherit). While Select is active:
 *
 *   - Click an image (reverse-z first-hit) → that image becomes selected.
 *   - Hover an image body → cursor changes to `move`; hover a handle →
 *     directional resize cursor.
 *   - Drag the body → translate. Drag a corner handle → resize from
 *     opposite corner. Drag an edge handle → 1-axis resize. Shift on a
 *     corner constrains the aspect ratio.
 *   - Click empty space → deselect.
 *   - Delete / Backspace removes (soft-delete) with undo.
 *
 * Pen / Eraser / Lasso treat images as inert — no hit-test, no handles.
 * Selection state is held inside the tool and discarded on tool switch.
 *
 * Rendering: outline + 8 handles on the live layer. Outline scales with
 * zoom (drawn in board space). Handles are constant *pixel* size so they
 * don't disappear when zoomed out — drawn in screen space, positioned
 * from board → screen via the camera transform.
 */

import type { ImageObject } from '@whiteboard/shared'
import { imageCenter, pointInImage, rotateAroundPoint } from '../imagegeom'
import type { Op } from '../ops'
import { applyCamera, clearLayer } from '../render'
import type { Tool, ToolContext } from './types'

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type DragKind =
  | 'move'
  /** Resize via a handle. `anchorBoard` is the OPPOSITE corner / edge midpoint
   *  in BOARD space, computed once at drag-start and invariant for the rest
   *  of the drag. Picking board-space (not local) makes the anchor stay at
   *  the same screen position throughout — which is the user-expected
   *  behavior on rotated images, where local-space drift previously
   *  showed up as the image "wandering" mid-resize. */
  | { resize: HandleId; anchorBoard: { x: number; y: number } }
  | { rotate: true; startRotation: number; startAngleFromCenter: number }

interface DragState {
  imageId: string
  kind: DragKind
  before: ImageObject['transform']
  beforeRotation: number
  /** Board-space coords of the pointer at pointerdown. */
  startBoard: { x: number; y: number }
}

interface SelectToolDeps {
  /** Read-only access; the tool mutates entries' `transform` in place during drag. */
  getImages: () => ImageObject[]
  /** Persist a single image's metadata after each move-tick. */
  saveImageMeta: (img: ImageObject) => void
  /** Push an op into the undo stack — fired on drag-end + on delete. */
  pushOp: (op: Op) => void
  /** Mark the committed layer dirty so the next frame re-renders. */
  markCommittedDirty: () => void
}

/** Distance from the top-center handle to the rotation handle, in screen
 *  pixels. Constant so it stays the same visual offset at every zoom. */
const ROTATE_HANDLE_OFFSET_PX = 24

/** Pixel size of selection handles (constant on screen, regardless of zoom). */
const HANDLE_PX = 8
/** Half a handle, plus padding, in screen pixels — hit-test tolerance. */
const HANDLE_HIT_PX = 10
/** Selection outline + handle stroke color. Matches the existing UI accent. */
const ACCENT = 'var(--whiteboard-accent, #2563eb)'

/**
 * Custom rotation cursor — a circular arrow drawn inline as an SVG data URL.
 * CSS doesn't have a built-in "rotate" cursor and `grab` reads as "I'm
 * holding something" rather than "I'm spinning something", which was the
 * specific UX complaint. The 24×24 SVG has a black stroke with a white
 * halo for visibility on both light and dark backgrounds. Hot-spot at the
 * center (12,12). The trailing `grab` is the fallback if the browser can't
 * load the data URL (very old browsers / restrictive CSP).
 */
const ROTATE_CURSOR =
  'url(\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M 12 4 A 8 8 0 1 1 4 12" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M 12 4 A 8 8 0 1 1 4 12" fill="none" stroke="black" stroke-width="2" stroke-linecap="round"/><polygon points="12,0 18,6 12,10" fill="black" stroke="white" stroke-width="1"/></svg>\') 12 12, grab'

export interface SelectTool extends Tool {
  /** Currently-selected image id, or null. Read by main.ts for the
   *  Delete-key handler since image-delete is a tool-state action,
   *  not a stroke-selection action. */
  getSelectedImageId(): string | null
  /** Soft-delete the currently-selected image and emit a delete-image op.
   *  No-op if nothing is selected. Returns true if anything was deleted. */
  deleteSelected(): boolean
}

export function createSelectTool(deps: SelectToolDeps): SelectTool {
  let selectedImageId: string | null = null
  let drag: DragState | null = null
  // Timestamp of the most recent pointerdown on the rotation handle.
  // A second pointerdown on the same handle within DBLCLICK_MS resets
  // the image's rotation to 0 (and does NOT start a drag). Sentinel
  // `-Infinity` ensures the very first click after page load never trips
  // the double-click branch by virtue of `performance.now()` returning
  // a small value (a few hundred ms) early in the session.
  let lastRotateHandleDownAt = Number.NEGATIVE_INFINITY
  const ROTATE_DBLCLICK_MS = 350

  /** Top-most non-deleted image whose rotated rect contains the board-space
   *  point. Handles take priority — see hitTest. */
  function imageAt(
    boardX: number,
    boardY: number,
    imgs: readonly ImageObject[],
  ): ImageObject | null {
    // Reverse iterate so paste-time-latest wins (it's on top visually).
    const sorted = [...imgs].filter((i) => !i.deleted).sort((a, b) => b.z - a.z)
    for (const img of sorted) {
      if (pointInImage({ x: boardX, y: boardY }, img)) return img
    }
    return null
  }

  /** Returns the 8 handle positions in board space for a transform rect.
   *  Already rotated around the image center when img has rotation set. */
  function handlePositions(img: ImageObject): Record<HandleId, { x: number; y: number }> {
    const t = img.transform
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
    const r = img.rotation ?? 0
    if (r === 0) return local
    const c = { x: cx, y: cy }
    const out = {} as Record<HandleId, { x: number; y: number }>
    for (const id of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      out[id] = rotateAroundPoint(local[id], c, r)
    }
    return out
  }

  /** Rotation handle position in board space — `ROTATE_HANDLE_OFFSET_PX`
   *  above the N handle, then rotated. Pass scale so the screen-space
   *  offset stays constant regardless of zoom. */
  function rotationHandlePos(img: ImageObject, scale: number): { x: number; y: number } {
    const t = img.transform
    const cx = t.x + t.w / 2
    const cy = t.y + t.h / 2
    const offsetBoard = ROTATE_HANDLE_OFFSET_PX / scale
    const local = { x: cx, y: t.y - offsetBoard }
    const r = img.rotation ?? 0
    return r === 0 ? local : rotateAroundPoint(local, { x: cx, y: cy }, r)
  }

  /** Compute the anchor (opposite handle's position) in BOARD space at
   *  drag-start, accounting for rotation. The anchor stays fixed in board
   *  space throughout the resize drag — that invariance is what lets the
   *  resize feel correct on rotated images. */
  function anchorBoardFor(
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
  function cursorFor(handle: HandleId, rotationRad: number): string {
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

  /** Hit-test against the selected image's handles (board coords). Returns
   *  null if not over any handle. Considers an HANDLE_HIT_PX-radius hit
   *  zone *in screen pixels* converted back to board space via scale.
   *  Handles are already in rotated positions if the image is rotated. */
  function handleAt(
    boardX: number,
    boardY: number,
    sel: ImageObject,
    scale: number,
  ): HandleId | null {
    const tol = HANDLE_HIT_PX / scale
    const positions = handlePositions(sel)
    for (const id of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      const p = positions[id]
      if (Math.abs(p.x - boardX) <= tol && Math.abs(p.y - boardY) <= tol) return id
    }
    return null
  }

  /** Hit-test the rotation handle. Returns true if board pointer is within
   *  the rotation handle's hit zone. */
  function isOverRotationHandle(
    boardX: number,
    boardY: number,
    sel: ImageObject,
    scale: number,
  ): boolean {
    const tol = HANDLE_HIT_PX / scale
    const p = rotationHandlePos(sel, scale)
    return Math.abs(p.x - boardX) <= tol && Math.abs(p.y - boardY) <= tol
  }

  /**
   * Finalize the current drag — push the appropriate op (or skip if the
   * live state is identical to the snapshot) and clear `drag`. Called from
   * both onPointerUp (normal release) and pointercancel-style entry paths
   * (browser revoked the pointer mid-drag, window blur, OS gesture steal).
   * Without this shared path, a pointercancel left `drag` non-null and
   * the live transform mutations un-recorded in undo.
   */
  function commitDrag(e: PointerEvent | null): void {
    if (!drag) return
    const img = deps.getImages().find((i) => i.id === drag?.imageId)
    if (e) {
      ;(e.target as Element | null)?.releasePointerCapture?.(e.pointerId)
    }
    if (img) {
      const isRotation = typeof drag.kind === 'object' && 'rotate' in drag.kind
      if (isRotation) {
        const beforeR = drag.beforeRotation
        const afterR = img.rotation ?? 0
        if (beforeR !== afterR) {
          deps.pushOp({ kind: 'rotate-image', imageId: img.id, before: beforeR, after: afterR })
        }
      } else {
        const before = drag.before
        const after = { ...img.transform }
        if (
          before.x !== after.x ||
          before.y !== after.y ||
          before.w !== after.w ||
          before.h !== after.h
        ) {
          deps.pushOp({ kind: 'transform-image', imageId: img.id, before, after })
        }
      }
    }
    drag = null
  }

  function updateHoverCursor(ctx: ToolContext, boardX: number, boardY: number): void {
    const imgs = deps.getImages()
    const sel = selectedImageId ? imgs.find((i) => i.id === selectedImageId) : null

    if (sel) {
      if (isOverRotationHandle(boardX, boardY, sel, ctx.camera.scale)) {
        ctx.setCursor(ROTATE_CURSOR)
        return
      }
      const handle = handleAt(boardX, boardY, sel, ctx.camera.scale)
      if (handle) {
        ctx.setCursor(cursorFor(handle, sel.rotation ?? 0))
        return
      }
    }

    const hit = imageAt(boardX, boardY, imgs)
    ctx.setCursor(hit ? 'move' : 'default')
  }

  /** Resize the image in place. Keeps `anchorBoard` fixed in board space
   *  regardless of rotation, derives new local dimensions by projecting
   *  the pointer-vs-anchor delta onto the image's rotated axes, then
   *  computes the new board-space center from anchor + signed half-diagonal.
   *
   *  This replaces the prior local-space-resize-then-fudge approach which
   *  drifted on rotated images because the inverse-rotation pivot moved
   *  each tick. The current model has *zero* drift across the drag; the
   *  anchor stays put pixel-for-pixel.
   */
  function applyResize(
    before: ImageObject['transform'],
    rotation: number,
    handle: HandleId,
    anchorBoard: { x: number; y: number },
    pointerBoard: { x: number; y: number },
    naturalAspect: number,
    shift: boolean,
  ): ImageObject['transform'] {
    // Project (pointer - anchor) onto the image's local axes:
    //   xAxis_board = (cos, sin), yAxis_board = (-sin, cos)
    // localXDelta = projection onto xAxis; localYDelta = onto yAxis.
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const vx = pointerBoard.x - anchorBoard.x
    const vy = pointerBoard.y - anchorBoard.y
    const localXDelta = vx * cos + vy * sin
    const localYDelta = -vx * sin + vy * cos

    const isCorner = handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw'
    const isVerticalEdge = handle === 'n' || handle === 's' // height changes; width preserved
    const isHorizontalEdge = handle === 'e' || handle === 'w' // width changes; height preserved

    let newW: number
    let newH: number
    if (isCorner) {
      newW = Math.abs(localXDelta)
      newH = Math.abs(localYDelta)
      if (shift) {
        // Aspect-ratio constrain. Use the larger side (in aspect-normalized
        // units) to scale up the smaller — Figma-like "extend, don't shrink".
        if (newW > newH * naturalAspect) {
          newH = newW / naturalAspect
        } else {
          newW = newH * naturalAspect
        }
      }
    } else if (isVerticalEdge) {
      newH = Math.abs(localYDelta)
      newW = before.w
    } else if (isHorizontalEdge) {
      newW = Math.abs(localXDelta)
      newH = before.h
    } else {
      // Defensive — unreachable.
      newW = before.w
      newH = before.h
    }

    // Minimum side — 16 board-px. Prevents zero-sized images that
    // disappear and can't be hit-tested.
    const MIN_SIDE = 16
    if (newW < MIN_SIDE) newW = MIN_SIDE
    if (newH < MIN_SIDE) newH = MIN_SIDE

    // Direction signs in image-local coords for each handle. The dragged
    // corner / edge midpoint sits at (sx*newW/2, sy*newH/2) relative to
    // the new center. The anchor is the opposite, so the new center is
    // at anchor + (sx*newW/2, sy*newH/2) — rotated into board space.
    let sx = 0
    let sy = 0
    switch (handle) {
      case 'nw':
        sx = -1
        sy = -1
        break
      case 'n':
        sx = 0
        sy = -1
        break
      case 'ne':
        sx = +1
        sy = -1
        break
      case 'e':
        sx = +1
        sy = 0
        break
      case 'se':
        sx = +1
        sy = +1
        break
      case 's':
        sx = 0
        sy = +1
        break
      case 'sw':
        sx = -1
        sy = +1
        break
      case 'w':
        sx = -1
        sy = 0
        break
    }

    const halfX = (sx * newW) / 2
    const halfY = (sy * newH) / 2
    const centerX = anchorBoard.x + halfX * cos - halfY * sin
    const centerY = anchorBoard.y + halfX * sin + halfY * cos

    return {
      x: centerX - newW / 2,
      y: centerY - newH / 2,
      w: newW,
      h: newH,
    }
  }

  return {
    id: 'select',
    cursor: 'default',

    onPointerDown(e, ctx): void {
      // Defensive cleanup: if a previous drag's pointerup/cancel was
      // never delivered (window blur, OS gesture steal, missed event),
      // close it out properly so its op lands in undo before the next
      // gesture starts. commitDrag is a no-op if `drag` is null.
      commitDrag(null)
      const { x: bx, y: by } = ctx.toBoard(e.clientX, e.clientY)
      const imgs = deps.getImages()
      const sel = selectedImageId ? imgs.find((i) => i.id === selectedImageId) : null

      // Rotation handle takes top priority — sits above the image and could
      // overlap a resize handle on a tiny image, so we check it first.
      if (sel && isOverRotationHandle(bx, by, sel, ctx.camera.scale)) {
        // Double-click on the rotation handle resets rotation to 0.
        // Doesn't start a drag — just snaps and pushes one op.
        const now = performance.now()
        const isDoubleClick = now - lastRotateHandleDownAt < ROTATE_DBLCLICK_MS
        // Always record the click timestamp. Setting to -Infinity after a
        // double-click would let a third quick click trip the branch
        // again (because `now - (-Infinity)` is Infinity, > threshold —
        // so paradoxically setting it to 0 is what would re-trigger).
        // Recording the actual `now` is correct in both cases.
        lastRotateHandleDownAt = now
        if (isDoubleClick) {
          const before = sel.rotation ?? 0
          if (before !== 0) {
            sel.rotation = undefined
            deps.saveImageMeta(sel)
            deps.pushOp({ kind: 'rotate-image', imageId: sel.id, before, after: 0 })
            ctx.markCommittedDirty()
          }
          return
        }
        const center = imageCenter(sel.transform)
        const startAngle = Math.atan2(by - center.y, bx - center.x)
        drag = {
          imageId: sel.id,
          kind: {
            rotate: true,
            startRotation: sel.rotation ?? 0,
            startAngleFromCenter: startAngle,
          },
          before: { ...sel.transform },
          beforeRotation: sel.rotation ?? 0,
          startBoard: { x: bx, y: by },
        }
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        // Keep the rotate cursor through the drag so the gesture reads as
        // continuous (vs flipping to a generic grabbing).
        ctx.setCursor(ROTATE_CURSOR)
        return
      }

      // Resize handles next.
      if (sel) {
        const handle = handleAt(bx, by, sel, ctx.camera.scale)
        if (handle) {
          drag = {
            imageId: sel.id,
            kind: {
              resize: handle,
              anchorBoard: anchorBoardFor(handle, sel.transform, sel.rotation ?? 0),
            },
            before: { ...sel.transform },
            beforeRotation: sel.rotation ?? 0,
            startBoard: { x: bx, y: by },
          }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          return
        }
      }

      const hit = imageAt(bx, by, imgs)
      if (hit) {
        selectedImageId = hit.id
        drag = {
          imageId: hit.id,
          kind: 'move',
          before: { ...hit.transform },
          beforeRotation: hit.rotation ?? 0,
          startBoard: { x: bx, y: by },
        }
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        ctx.markCommittedDirty()
        return
      }

      // Clicked empty space → deselect.
      if (selectedImageId) {
        selectedImageId = null
        ctx.markCommittedDirty()
      }
    },

    onPointerMove(e, ctx): void {
      const { x: bx, y: by } = ctx.toBoard(e.clientX, e.clientY)

      if (!drag) {
        updateHoverCursor(ctx, bx, by)
        return
      }

      const img = deps.getImages().find((i) => i.id === drag?.imageId)
      if (!img) return

      if (drag.kind === 'move') {
        const dx = bx - drag.startBoard.x
        const dy = by - drag.startBoard.y
        img.transform.x = drag.before.x + dx
        img.transform.y = drag.before.y + dy
      } else if ('rotate' in drag.kind) {
        // Rotation drag: angle is the polar angle from the image's *current*
        // center to the pointer. Delta from the start angle is added to the
        // start rotation. (Using current center means the image rotates
        // around its own center even if it was moved during a previous
        // drag — though we don't allow nested drags.)
        const center = imageCenter(img.transform)
        const angle = Math.atan2(by - center.y, bx - center.x)
        const delta = angle - drag.kind.startAngleFromCenter
        img.rotation = normalizeRotation(drag.kind.startRotation + delta)
      } else {
        // Resize. The anchor (opposite corner / edge midpoint) is in BOARD
        // space and was captured at drag-start, so rotation-aware resize
        // math can keep that point pinned pixel-for-pixel throughout the
        // drag (vs the prior local-pivot approach which drifted across
        // ticks because the local pivot moved with the rect each tick).
        const naturalAspect = img.natural.w / img.natural.h
        const next = applyResize(
          drag.before,
          drag.beforeRotation,
          drag.kind.resize,
          drag.kind.anchorBoard,
          { x: bx, y: by },
          naturalAspect,
          e.shiftKey,
        )
        img.transform = next
      }

      // Live-render: mutating the in-memory transform; mark dirty so the
      // committed layer re-composites on the next frame.
      deps.saveImageMeta(img)
      ctx.markCommittedDirty()
    },

    onPointerUp(e, ctx): void {
      commitDrag(e)
      ctx.markCommittedDirty()
    },

    redraw(ctx): void {
      clearLayer(ctx.liveLayer)
      const id = selectedImageId
      if (!id) return
      const img = deps.getImages().find((i) => i.id === id)
      if (!img || img.deleted) return

      const { x, y, w, h } = img.transform
      const r = img.rotation ?? 0
      const c = ctx.liveLayer.ctx
      const accent = resolveAccent(c)

      // Outline — drawn rotated around image center. Use save/translate/
      // rotate to keep the rect path in local coords while applying the
      // image's rotation in board space. Stroke width is counter-scaled
      // to stay 1 screen px regardless of zoom.
      applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
      c.save()
      if (r !== 0) {
        c.translate(x + w / 2, y + h / 2)
        c.rotate(r)
        c.translate(-(x + w / 2), -(y + h / 2))
      }
      c.strokeStyle = accent
      c.lineWidth = 1 / ctx.camera.scale
      c.strokeRect(x, y, w, h)
      c.restore()

      // Handles in screen space — constant pixel size regardless of zoom.
      // We use the already-rotated positions from handlePositions().
      c.save()
      c.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0)
      const positions = handlePositions(img)
      const boardToScreen = (p: { x: number; y: number }): { x: number; y: number } => ({
        x: (p.x - ctx.camera.x) * ctx.camera.scale,
        y: (p.y - ctx.camera.y) * ctx.camera.scale,
      })
      for (const hid of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
        const s = boardToScreen(positions[hid])
        c.fillStyle = '#ffffff'
        c.fillRect(s.x - HANDLE_PX / 2 - 1, s.y - HANDLE_PX / 2 - 1, HANDLE_PX + 2, HANDLE_PX + 2)
        c.fillStyle = accent
        c.fillRect(s.x - HANDLE_PX / 2, s.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX)
      }

      // Rotation handle + connecting line. The handle sits
      // ROTATE_HANDLE_OFFSET_PX above the N handle (along the image's
      // top-edge normal, which itself rotates with the image).
      const rotPos = boardToScreen(rotationHandlePos(img, ctx.camera.scale))
      const nPos = boardToScreen(positions.n)
      c.strokeStyle = accent
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(nPos.x, nPos.y)
      c.lineTo(rotPos.x, rotPos.y)
      c.stroke()
      // Round-ish rotation handle: filled circle with white outer ring.
      c.fillStyle = '#ffffff'
      c.beginPath()
      c.arc(rotPos.x, rotPos.y, HANDLE_PX / 2 + 1.5, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = accent
      c.beginPath()
      c.arc(rotPos.x, rotPos.y, HANDLE_PX / 2, 0, Math.PI * 2)
      c.fill()
      c.restore()
    },

    cleanup(): void {
      selectedImageId = null
      drag = null
    },

    getSelectedImageId(): string | null {
      return selectedImageId
    },

    deleteSelected(): boolean {
      if (!selectedImageId) return false
      const id = selectedImageId
      const img = deps.getImages().find((i) => i.id === id)
      // Guard against double-delete: if the image was already removed
      // (e.g. by the Cmd+A batch path running first, or by remote undo /
      // future sync), don't fire a second delete-image op against it —
      // that would push a redundant op and corrupt the undo sequence.
      if (!img || img.deleted) {
        selectedImageId = null
        return false
      }
      img.deleted = true
      deps.saveImageMeta(img)
      deps.pushOp({ kind: 'delete-image', imageId: id })
      selectedImageId = null
      deps.markCommittedDirty()
      return true
    },
  }
}

/** Resolve the accent CSS variable to a concrete color for canvas draws.
 *  CanvasRenderingContext2D doesn't read CSS variables, so we fetch the
 *  computed value off the canvas element each redraw. Cheap (single
 *  getComputedStyle call per redraw, only when a selection exists). */
function resolveAccent(c: CanvasRenderingContext2D): string {
  const css = getComputedStyle(c.canvas).getPropertyValue('--whiteboard-accent').trim()
  return css || '#2563eb'
}

/** Normalize a rotation angle to (-π, π] so undo/redo records stay tidy
 *  and accumulated drag deltas don't grow unbounded over many spins. */
function normalizeRotation(r: number): number {
  const TWO_PI = Math.PI * 2
  let n = r % TWO_PI
  if (n > Math.PI) n -= TWO_PI
  if (n <= -Math.PI) n += TWO_PI
  return n
}
