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
import { getImageElement } from '../imagecache'
import type { Op } from '../ops'
import { applyCamera, clearLayer } from '../render'
import type { Tool, ToolContext } from './types'

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface DragState {
  imageId: string
  kind: 'move' | { resize: HandleId; anchor: { x: number; y: number } }
  before: ImageObject['transform']
  /** Board-space coords of the pointer at pointerdown. */
  startBoard: { x: number; y: number }
  /** Whether Shift is being held during a resize drag (proportional). */
  shiftConstrained: boolean
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

/** Pixel size of selection handles (constant on screen, regardless of zoom). */
const HANDLE_PX = 8
/** Half a handle, plus padding, in screen pixels — hit-test tolerance. */
const HANDLE_HIT_PX = 10
/** Selection outline + handle stroke color. Matches the existing UI accent. */
const ACCENT = 'var(--whiteboard-accent, #2563eb)'

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
  let hoveredHandle: HandleId | null = null
  let hoveredImage: string | null = null

  /** Top-most non-deleted image whose rect contains the board-space point.
   *  Handles take priority — see hitTest. */
  function imageAt(
    boardX: number,
    boardY: number,
    imgs: readonly ImageObject[],
  ): ImageObject | null {
    // Reverse iterate so paste-time-latest wins (it's on top visually).
    const sorted = [...imgs].filter((i) => !i.deleted).sort((a, b) => b.z - a.z)
    for (const img of sorted) {
      const { x, y, w, h } = img.transform
      if (boardX >= x && boardX <= x + w && boardY >= y && boardY <= y + h) return img
    }
    return null
  }

  /** Returns the 8 handle positions in board space for a transform rect. */
  function handlePositions(
    t: ImageObject['transform'],
  ): Record<HandleId, { x: number; y: number }> {
    const cx = t.x + t.w / 2
    const cy = t.y + t.h / 2
    return {
      nw: { x: t.x, y: t.y },
      n: { x: cx, y: t.y },
      ne: { x: t.x + t.w, y: t.y },
      e: { x: t.x + t.w, y: cy },
      se: { x: t.x + t.w, y: t.y + t.h },
      s: { x: cx, y: t.y + t.h },
      sw: { x: t.x, y: t.y + t.h },
      w: { x: t.x, y: cy },
    }
  }

  /** The anchor (opposite handle) for resize math. */
  function anchorFor(handle: HandleId, t: ImageObject['transform']): { x: number; y: number } {
    const p = handlePositions(t)
    switch (handle) {
      case 'nw':
        return p.se
      case 'n':
        return p.s
      case 'ne':
        return p.sw
      case 'e':
        return p.w
      case 'se':
        return p.nw
      case 's':
        return p.n
      case 'sw':
        return p.ne
      case 'w':
        return p.e
    }
  }

  function cursorFor(handle: HandleId): string {
    switch (handle) {
      case 'nw':
      case 'se':
        return 'nwse-resize'
      case 'ne':
      case 'sw':
        return 'nesw-resize'
      case 'n':
      case 's':
        return 'ns-resize'
      case 'e':
      case 'w':
        return 'ew-resize'
    }
  }

  /** Convert board distance to screen distance using the camera scale. */
  function screenDistance(boardDelta: number, scale: number): number {
    return boardDelta * scale
  }

  /** Hit-test against the selected image's handles (board coords). Returns
   *  null if not over any handle. Considers an HANDLE_HIT_PX-radius hit
   *  zone *in screen pixels* converted back to board space via scale. */
  function handleAt(
    boardX: number,
    boardY: number,
    sel: ImageObject,
    scale: number,
  ): HandleId | null {
    const tol = HANDLE_HIT_PX / scale
    const positions = handlePositions(sel.transform)
    for (const id of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      const p = positions[id]
      if (Math.abs(p.x - boardX) <= tol && Math.abs(p.y - boardY) <= tol) return id
    }
    return null
  }

  function updateHoverCursor(ctx: ToolContext, boardX: number, boardY: number): void {
    const imgs = deps.getImages()
    const sel = selectedImageId ? imgs.find((i) => i.id === selectedImageId) : null

    if (sel) {
      const handle = handleAt(boardX, boardY, sel, ctx.camera.scale)
      if (handle) {
        hoveredHandle = handle
        hoveredImage = null
        ctx.liveLayer.el.style.cursor = cursorFor(handle)
        return
      }
    }

    hoveredHandle = null
    const hit = imageAt(boardX, boardY, imgs)
    hoveredImage = hit?.id ?? null
    ctx.liveLayer.el.style.cursor = hit ? 'move' : 'default'
  }

  function applyResize(
    t: ImageObject['transform'],
    handle: HandleId,
    anchor: { x: number; y: number },
    pointerBoard: { x: number; y: number },
    naturalAspect: number,
    shift: boolean,
  ): void {
    // Compute the new rect from anchor + opposite corner = pointer.
    let nx = Math.min(anchor.x, pointerBoard.x)
    let ny = Math.min(anchor.y, pointerBoard.y)
    let nw = Math.abs(pointerBoard.x - anchor.x)
    let nh = Math.abs(pointerBoard.y - anchor.y)

    // Edge handles lock one axis to the existing extent so resize is 1-axis.
    const isVerticalEdge = handle === 'n' || handle === 's'
    const isHorizontalEdge = handle === 'e' || handle === 'w'
    if (isVerticalEdge) {
      nx = t.x
      nw = t.w
    }
    if (isHorizontalEdge) {
      ny = t.y
      nh = t.h
    }

    // Shift-constrain: corner handles preserve aspect ratio. Edge handles
    // ignore Shift (1-axis resize doesn't have an aspect to preserve).
    const isCorner = handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw'
    if (shift && isCorner) {
      // Fit to the longer side. Aspect = w/h; preserve natural ratio.
      const targetH = nw / naturalAspect
      const targetW = nh * naturalAspect
      if (targetH > nh) {
        // Width is the limiting axis: keep nw, derive nh.
        nh = targetH
      } else {
        nw = targetW
      }
      // Re-anchor the constrained rect to the anchor corner.
      if (handle === 'nw') {
        nx = anchor.x - nw
        ny = anchor.y - nh
      } else if (handle === 'ne') {
        nx = anchor.x
        ny = anchor.y - nh
      } else if (handle === 'sw') {
        nx = anchor.x - nw
        ny = anchor.y
      } else {
        // 'se'
        nx = anchor.x
        ny = anchor.y
      }
    }

    // Minimum size — 16 board-px in either axis. Prevents zero-sized
    // images that disappear and can't be hit-tested.
    const MIN_SIDE = 16
    if (nw < MIN_SIDE) nw = MIN_SIDE
    if (nh < MIN_SIDE) nh = MIN_SIDE

    t.x = nx
    t.y = ny
    t.w = nw
    t.h = nh
  }

  return {
    id: 'select',
    cursor: 'default',

    onPointerDown(e, ctx): void {
      const { x: bx, y: by } = ctx.toBoard(e.clientX, e.clientY)
      const imgs = deps.getImages()
      const sel = selectedImageId ? imgs.find((i) => i.id === selectedImageId) : null

      // Handle takes priority — only if there's a selection.
      if (sel) {
        const handle = handleAt(bx, by, sel, ctx.camera.scale)
        if (handle) {
          drag = {
            imageId: sel.id,
            kind: { resize: handle, anchor: anchorFor(handle, sel.transform) },
            before: { ...sel.transform },
            startBoard: { x: bx, y: by },
            shiftConstrained: e.shiftKey,
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
          startBoard: { x: bx, y: by },
          shiftConstrained: false,
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

      const dx = bx - drag.startBoard.x
      const dy = by - drag.startBoard.y

      if (drag.kind === 'move') {
        img.transform.x = drag.before.x + dx
        img.transform.y = drag.before.y + dy
      } else {
        const naturalAspect = img.natural.w / img.natural.h
        applyResize(
          img.transform,
          drag.kind.resize,
          drag.kind.anchor,
          { x: bx, y: by },
          naturalAspect,
          e.shiftKey,
        )
      }

      // Live-render: mutating the in-memory transform; mark dirty so the
      // committed layer re-composites on the next frame.
      deps.saveImageMeta(img)
      ctx.markCommittedDirty()
    },

    onPointerUp(e, ctx): void {
      if (!drag) return
      const img = deps.getImages().find((i) => i.id === drag?.imageId)
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
      if (img) {
        const before = drag.before
        const after = { ...img.transform }
        // Only push an op if the transform actually changed (a tap-and-
        // release is a click, not a no-op drag).
        if (
          before.x !== after.x ||
          before.y !== after.y ||
          before.w !== after.w ||
          before.h !== after.h
        ) {
          deps.pushOp({ kind: 'transform-image', imageId: img.id, before, after })
        }
      }
      drag = null
      ctx.markCommittedDirty()
    },

    redraw(ctx): void {
      clearLayer(ctx.liveLayer)
      const id = selectedImageId
      if (!id) return
      const img = deps.getImages().find((i) => i.id === id)
      if (!img || img.deleted) return

      applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
      const { x, y, w, h } = img.transform
      const c = ctx.liveLayer.ctx

      // Outline in board space — scales with zoom for the rectangle, but
      // we counter-scale the stroke width so it stays at 1 screen px.
      c.save()
      c.strokeStyle = resolveAccent(c)
      c.lineWidth = 1 / ctx.camera.scale
      c.strokeRect(x, y, w, h)
      c.restore()

      // Handles in screen space — constant pixel size regardless of zoom.
      // Switch to identity transform; compute handle screen positions from
      // board → screen via camera.
      c.save()
      c.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0)
      const positions = handlePositions(img.transform)
      for (const hid of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
        const p = positions[hid]
        const sx = (p.x - ctx.camera.x) * ctx.camera.scale
        const sy = (p.y - ctx.camera.y) * ctx.camera.scale
        c.fillStyle = '#ffffff'
        c.fillRect(sx - HANDLE_PX / 2 - 1, sy - HANDLE_PX / 2 - 1, HANDLE_PX + 2, HANDLE_PX + 2)
        c.fillStyle = resolveAccent(c)
        c.fillRect(sx - HANDLE_PX / 2, sy - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX)
      }
      c.restore()
    },

    cleanup(): void {
      selectedImageId = null
      drag = null
      hoveredHandle = null
      hoveredImage = null
    },

    getSelectedImageId(): string | null {
      return selectedImageId
    },

    deleteSelected(): boolean {
      if (!selectedImageId) return false
      const id = selectedImageId
      const img = deps.getImages().find((i) => i.id === id)
      if (!img) {
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
