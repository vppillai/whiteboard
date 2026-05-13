/**
 * Select tool — for manipulating non-stroke objects (images + texts at
 * v1.2; future floating objects inherit). While Select is active:
 *
 *   - Click an object (reverse-z first-hit, texts above images) → it
 *     becomes selected.
 *   - Hover an object body → cursor changes to `move`; hover a handle →
 *     directional resize cursor. Hover the rotation handle → rotate
 *     cursor.
 *   - Drag the body → translate. Drag a corner handle → resize from the
 *     opposite corner; image: anchor-preserving rect resize, text:
 *     font-size scaling (since text rect is content-derived, not
 *     directly set). Drag an edge handle (image only) → 1-axis resize.
 *     Shift on a corner image constrains the aspect ratio.
 *   - Drag the rotation handle → rotate. Double-click rotation handle →
 *     reset to 0°.
 *   - Click empty space → deselect.
 *   - Delete / Backspace removes (soft-delete) with undo.
 *
 * Pen / Eraser / Lasso treat objects as inert — no hit-test, no handles.
 * Selection state is held inside the tool and discarded on tool switch.
 *
 * Rendering: outline + 8 handles on the live layer. Outline scales with
 * zoom (drawn in board space). Handles are constant *pixel* size so they
 * don't disappear when zoomed out — drawn in screen space, positioned
 * from board → screen via the camera transform.
 *
 * Selection model: a discriminated union `Selection = { kind, id }`
 * works across images and texts. A `getView()` helper resolves it to a
 * live `ObjectView` that exposes `{ transform, rotation }` uniformly.
 * The handle math and rotate math operate on the view — they don't care
 * what kind of object is selected. Type-specific code (resize semantics,
 * op-kind emission, delete) branches on `selection.kind`.
 */

import type { ImageObject, TextFontFamily, TextObject } from '@whiteboard/shared'
import { CURATED_COLORS as PALETTE } from '../colorpicker'
import { imageCenter, pointInImage, rotateAroundPoint } from '../imagegeom'
import { paletteGrid, pill, pillRow, sectionLabel, separator, swatch } from '../menu-ui'
import type { Op } from '../ops'
import { applyCamera, clearLayer } from '../render'
import { pointInText, resizeToFit } from '../textgeom'
import type { Tool, ToolContext } from './types'

type Selection = { kind: 'image'; id: string } | { kind: 'text'; id: string }

/**
 * Live view of the currently-selected object. Both `obj` and `transform`
 * are LIVE references — mutating `transform.x/y` (and saving via the
 * matching `save*` callback) is the canonical way to move/resize during
 * a drag.
 */
interface ObjectView {
  selection: Selection
  obj: ImageObject | TextObject
  transform: ImageObject['transform']
  rotation: number
}

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
  selection: Selection
  kind: DragKind
  before: ImageObject['transform']
  beforeRotation: number
  /** Snapshot of the text's font.size at drag-start. Only set when the
   *  selection is a text and the drag is a corner-handle resize — used
   *  to compute the new font.size from a scale factor. Null otherwise. */
  beforeFontSize: number | null
  /** Snapshot of the text's full font / content / color at drag-start.
   *  Used to construct the `edit-text` op's `before` payload on resize
   *  commit (resize for text mutates font.size, so it's an edit-text op
   *  in the persistence model). */
  beforeTextSnapshot: {
    content: string
    font: TextObject['font']
    color: string
  } | null
  /** Board-space coords of the pointer at pointerdown. */
  startBoard: { x: number; y: number }
}

interface SelectToolDeps {
  /** Read-only access; the tool mutates entries' `transform` in place during drag. */
  getImages: () => ImageObject[]
  /** Persist a single image's metadata after each move-tick. */
  saveImageMeta: (img: ImageObject) => void
  /** Read-only access; same mutation pattern as images. */
  getTexts: () => TextObject[]
  /** Persist a single text after each move-tick. */
  saveText: (t: TextObject) => void
  /** Push an op into the undo stack — fired on drag-end + on delete. */
  pushOp: (op: Op) => void
  /** Mark the committed layer dirty so the next frame re-renders. */
  markCommittedDirty: () => void
  /** Fired when the user double-clicks a TEXT body. Caller (main.ts)
   *  switches to the Text tool and opens edit mode on the given text
   *  via the Text tool's `editTextById`. Decoupled from the Text tool
   *  reference itself so the Select tool stays unaware of its sibling. */
  onTextDoubleClick?: (id: string, ctx: ToolContext) => void
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
  /** Live reference to the currently-selected IMAGE, or null when the
   *  selection is a text / nothing. Kept narrow so existing main.ts
   *  Cmd+C / Cmd+X paths (which only handle images for now) stay
   *  unchanged. Use `getSelected()` for the generalized accessor. */
  getSelectedImage(): ImageObject | null
  /** Discriminated-union accessor for the current selection. Null when
   *  nothing is selected. */
  getSelected(): Selection | null
  /** Force-select an image by id (e.g. after paste so the user can
   *  immediately position it). Caller is responsible for marking the
   *  canvas dirty and switching the active tool to Select first;
   *  this method only updates internal selection state. Silently does
   *  nothing if no image with `id` exists or it is soft-deleted. */
  selectImageById(id: string): void
  /** Soft-delete the currently-selected object (image OR text) and emit
   *  the matching delete-image / delete-text op. Returns true if
   *  anything was deleted. */
  deleteSelected(): boolean
}

export function createSelectTool(deps: SelectToolDeps): SelectTool {
  let selected: Selection | null = null
  let drag: DragState | null = null
  // Double-click-text-body tracking: most recent pointerdown timestamp +
  // text id, used to dispatch the Text tool handoff when the user clicks
  // the same text twice within the threshold. Strict same-id matching
  // (not just "any recent click") so dragging from text A to text B
  // doesn't trip the handoff.
  let lastTextDownAt = Number.NEGATIVE_INFINITY
  let lastTextDownId: string | null = null
  const TEXT_DBLCLICK_MS = 400
  // Timestamp of the most recent pointerdown on the rotation handle.
  // A second pointerdown on the same handle within DBLCLICK_MS resets
  // the image's rotation to 0 (and does NOT start a drag). Sentinel
  // `-Infinity` ensures the very first click after page load never trips
  // the double-click branch by virtue of `performance.now()` returning
  // a small value (a few hundred ms) early in the session.
  let lastRotateHandleDownAt = Number.NEGATIVE_INFINITY
  const ROTATE_DBLCLICK_MS = 350

  /** Resolve the current `selected` to a live view of the underlying
   *  object, or null if the selection no longer exists (deleted, gone).
   *  Used everywhere the prior code consulted `selectedImageId` + a
   *  `getImages().find` lookup. */
  function getView(): ObjectView | null {
    // Local snapshot so TypeScript's narrowing survives the closures
    // below (arrow callbacks inside `.find(...)` lose narrowing of a
    // mutable module-scope variable across the call boundary).
    const sel = selected
    if (!sel) return null
    if (sel.kind === 'image') {
      const img = deps.getImages().find((i) => i.id === sel.id)
      if (!img || img.deleted) return null
      return {
        selection: sel,
        obj: img,
        transform: img.transform,
        rotation: img.rotation ?? 0,
      }
    }
    const t = deps.getTexts().find((x) => x.id === sel.id)
    if (!t || t.deleted) return null
    return {
      selection: sel,
      obj: t,
      transform: t.transform,
      rotation: t.rotation ?? 0,
    }
  }

  /** Top-most non-deleted object (text OR image) whose rotated rect
   *  contains the board-space point. Texts render above images on-screen
   *  (per the per-frame render passes), so the hit-test walks texts
   *  first; within each kind, reverse-z so paste-time-latest wins.
   *  Handles take priority — see hitTest. */
  function objectAt(boardX: number, boardY: number): Selection | null {
    const texts = [...deps.getTexts()].filter((t) => !t.deleted).sort((a, b) => b.z - a.z)
    for (const t of texts) {
      if (pointInText({ x: boardX, y: boardY }, t)) {
        return { kind: 'text', id: t.id }
      }
    }
    const imgs = [...deps.getImages()].filter((i) => !i.deleted).sort((a, b) => b.z - a.z)
    for (const img of imgs) {
      if (pointInImage({ x: boardX, y: boardY }, img)) {
        return { kind: 'image', id: img.id }
      }
    }
    return null
  }

  /** Returns the 8 handle positions in board space for a transform rect.
   *  Already rotated around the rect center when rotation is non-zero.
   *  Generalized over object kind — operates purely on transform + rotation. */
  function handlePositions(
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
  function rotationHandlePos(
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

  /** Hit-test against the selected object's handles (board coords). Returns
   *  null if not over any handle. Considers an HANDLE_HIT_PX-radius hit
   *  zone *in screen pixels* converted back to board space via scale.
   *  Texts only get the 4 CORNER handles for resize — edge handles
   *  don't make sense for text (since w/h are content-derived, an
   *  edge drag has no clean visual semantic). Images get all 8. */
  function handleAt(
    boardX: number,
    boardY: number,
    view: ObjectView,
    scale: number,
  ): HandleId | null {
    const tol = HANDLE_HIT_PX / scale
    const positions = handlePositions(view.transform, view.rotation)
    // Texts only expose the 4 CORNERS (resize = font-size scale; edge
    // drags don't have a sensible visual semantic for content-driven
    // rect dimensions). Images get the full 8.
    const enabled =
      view.selection.kind === 'text'
        ? (['nw', 'ne', 'se', 'sw'] as const)
        : (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const)
    for (const id of enabled) {
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
    view: ObjectView,
    scale: number,
  ): boolean {
    const tol = HANDLE_HIT_PX / scale
    const p = rotationHandlePos(view.transform, view.rotation, scale)
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
    const d = drag
    drag = null
    if (e) {
      ;(e.target as Element | null)?.releasePointerCapture?.(e.pointerId)
    }
    const view = getView()
    if (!view) return
    const isRotation = typeof d.kind === 'object' && 'rotate' in d.kind
    const isResize = typeof d.kind === 'object' && 'resize' in d.kind

    if (view.selection.kind === 'image') {
      const img = view.obj as ImageObject
      if (isRotation) {
        const afterR = img.rotation ?? 0
        if (d.beforeRotation !== afterR) {
          deps.pushOp({
            kind: 'rotate-image',
            imageId: img.id,
            before: d.beforeRotation,
            after: afterR,
          })
        }
      } else {
        // Move or resize → transform-image
        const after = { ...img.transform }
        if (
          d.before.x !== after.x ||
          d.before.y !== after.y ||
          d.before.w !== after.w ||
          d.before.h !== after.h
        ) {
          deps.pushOp({
            kind: 'transform-image',
            imageId: img.id,
            before: d.before,
            after,
          })
        }
      }
      return
    }

    // Text branch
    const t = view.obj as TextObject
    if (isRotation) {
      const afterR = t.rotation ?? 0
      if (d.beforeRotation !== afterR) {
        deps.pushOp({
          kind: 'rotate-text',
          textId: t.id,
          before: d.beforeRotation,
          after: afterR,
        })
      }
      return
    }
    if (isResize) {
      // Resize for text mutates font.size (and re-fits transform) — that's
      // an edit-text op in the persistence model, not transform-text.
      // d.beforeTextSnapshot captures content + font + color at drag-start.
      if (d.beforeTextSnapshot) {
        const after = {
          content: t.content,
          font: { ...t.font },
          color: t.color,
        }
        const changed =
          d.beforeTextSnapshot.font.size !== after.font.size ||
          d.beforeTextSnapshot.font.family !== after.font.family ||
          d.beforeTextSnapshot.font.bold !== after.font.bold ||
          d.beforeTextSnapshot.font.italic !== after.font.italic ||
          d.beforeTextSnapshot.font.underline !== after.font.underline
        if (changed) {
          deps.pushOp({
            kind: 'edit-text',
            textId: t.id,
            before: d.beforeTextSnapshot,
            after,
          })
        }
      }
      return
    }
    // Move → transform-text
    const after = { ...t.transform }
    if (
      d.before.x !== after.x ||
      d.before.y !== after.y ||
      d.before.w !== after.w ||
      d.before.h !== after.h
    ) {
      deps.pushOp({
        kind: 'transform-text',
        textId: t.id,
        before: d.before,
        after,
      })
    }
  }

  function updateHoverCursor(ctx: ToolContext, boardX: number, boardY: number): void {
    const view = getView()

    if (view) {
      if (isOverRotationHandle(boardX, boardY, view, ctx.camera.scale)) {
        ctx.setCursor(ROTATE_CURSOR)
        return
      }
      const handle = handleAt(boardX, boardY, view, ctx.camera.scale)
      if (handle) {
        ctx.setCursor(cursorFor(handle, view.rotation))
        return
      }
    }

    const hit = objectAt(boardX, boardY)
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
      const view = getView()

      // Rotation handle takes top priority — it sits above the rect and
      // could overlap a resize handle on a small selection.
      if (view && isOverRotationHandle(bx, by, view, ctx.camera.scale)) {
        const now = performance.now()
        const isDoubleClick = now - lastRotateHandleDownAt < ROTATE_DBLCLICK_MS
        lastRotateHandleDownAt = now
        if (isDoubleClick) {
          const before = view.rotation
          if (before !== 0) {
            // Reset rotation to 0; dispatch the matching op kind by
            // selection type.
            if (view.selection.kind === 'image') {
              const img = view.obj as ImageObject
              img.rotation = undefined
              deps.saveImageMeta(img)
              deps.pushOp({ kind: 'rotate-image', imageId: img.id, before, after: 0 })
            } else {
              const t = view.obj as TextObject
              t.rotation = undefined
              deps.saveText(t)
              deps.pushOp({ kind: 'rotate-text', textId: t.id, before, after: 0 })
            }
            ctx.markCommittedDirty()
          }
          return
        }
        const center = imageCenter(view.transform)
        const startAngle = Math.atan2(by - center.y, bx - center.x)
        drag = {
          selection: view.selection,
          kind: {
            rotate: true,
            startRotation: view.rotation,
            startAngleFromCenter: startAngle,
          },
          before: { ...view.transform },
          beforeRotation: view.rotation,
          beforeFontSize: null,
          beforeTextSnapshot: null,
          startBoard: { x: bx, y: by },
        }
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        ctx.setCursor(ROTATE_CURSOR)
        return
      }

      // Resize handles next.
      if (view) {
        const handle = handleAt(bx, by, view, ctx.camera.scale)
        if (handle) {
          // Text-resize uses a separate code path (font.size scaling); we
          // still cache the anchor + a text snapshot for the commit-time
          // op build.
          const beforeFontSize =
            view.selection.kind === 'text' ? (view.obj as TextObject).font.size : null
          const beforeTextSnapshot =
            view.selection.kind === 'text'
              ? {
                  content: (view.obj as TextObject).content,
                  font: { ...(view.obj as TextObject).font },
                  color: (view.obj as TextObject).color,
                }
              : null
          drag = {
            selection: view.selection,
            kind: {
              resize: handle,
              anchorBoard: anchorBoardFor(handle, view.transform, view.rotation),
            },
            before: { ...view.transform },
            beforeRotation: view.rotation,
            beforeFontSize,
            beforeTextSnapshot,
            startBoard: { x: bx, y: by },
          }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          return
        }
      }

      // Hit-test against ALL objects (text + image, topmost wins).
      const hit = objectAt(bx, by)
      if (hit) {
        // Double-click on a text body → handoff to the Text tool so the
        // user can immediately edit. Image double-click has no special
        // semantic (currently). Strict same-id matching so dragging
        // from text A to text B can't trigger the handoff.
        if (hit.kind === 'text' && deps.onTextDoubleClick) {
          const now = performance.now()
          const isDouble = lastTextDownId === hit.id && now - lastTextDownAt < TEXT_DBLCLICK_MS
          lastTextDownAt = now
          lastTextDownId = hit.id
          if (isDouble) {
            // Hand off to Text tool. Don't start a drag — the caller's
            // setTool('text') call will cleanup() us anyway and any
            // drag state would just be discarded.
            deps.onTextDoubleClick(hit.id, ctx)
            return
          }
        } else {
          // Reset on a non-text hit so a future text click doesn't
          // double-fire from a stale prior text id.
          lastTextDownAt = Number.NEGATIVE_INFINITY
          lastTextDownId = null
        }
        selected = hit
        const fresh = getView()
        if (fresh) {
          drag = {
            selection: hit,
            kind: 'move',
            before: { ...fresh.transform },
            beforeRotation: fresh.rotation,
            beforeFontSize: null,
            beforeTextSnapshot: null,
            startBoard: { x: bx, y: by },
          }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          ctx.markCommittedDirty()
          return
        }
      }

      // Clicked empty space → deselect.
      if (selected) {
        selected = null
        ctx.markCommittedDirty()
      }
    },

    onPointerMove(e, ctx): void {
      const { x: bx, y: by } = ctx.toBoard(e.clientX, e.clientY)

      if (!drag) {
        updateHoverCursor(ctx, bx, by)
        return
      }

      const view = getView()
      if (!view) return

      if (drag.kind === 'move') {
        const dx = bx - drag.startBoard.x
        const dy = by - drag.startBoard.y
        view.obj.transform.x = drag.before.x + dx
        view.obj.transform.y = drag.before.y + dy
      } else if ('rotate' in drag.kind) {
        // Rotation drag: angle is the polar angle from the object's
        // current center to the pointer. Delta from the start angle is
        // added to the start rotation.
        const center = imageCenter(view.transform)
        const angle = Math.atan2(by - center.y, bx - center.x)
        const delta = angle - drag.kind.startAngleFromCenter
        const nextRotation = normalizeRotation(drag.kind.startRotation + delta)
        if (view.selection.kind === 'image') {
          ;(view.obj as ImageObject).rotation = nextRotation
        } else {
          ;(view.obj as TextObject).rotation = nextRotation
        }
      } else {
        // Resize. Two code paths by selection kind:
        //   - image: anchor-preserving rect resize (existing math).
        //   - text: scale font.size by the diagonal ratio (pointer
        //     distance from anchor vs original diagonal); re-fit
        //     transform to the new measured content, then position so
        //     the anchor stays pinned in board space.
        if (view.selection.kind === 'image') {
          const img = view.obj as ImageObject
          const naturalAspect = img.natural.w / img.natural.h
          img.transform = applyResize(
            drag.before,
            drag.beforeRotation,
            drag.kind.resize,
            drag.kind.anchorBoard,
            { x: bx, y: by },
            naturalAspect,
            e.shiftKey,
          )
        } else {
          const t = view.obj as TextObject
          if (drag.beforeFontSize !== null && drag.beforeTextSnapshot !== null) {
            const next = applyTextResize(
              drag.before,
              drag.beforeFontSize,
              drag.beforeTextSnapshot,
              drag.beforeRotation,
              drag.kind.resize,
              drag.kind.anchorBoard,
              { x: bx, y: by },
            )
            t.font = { ...drag.beforeTextSnapshot.font, size: next.newSize }
            t.transform = next.newTransform
          }
        }
      }

      // Live-render: mutating the in-memory transform; persist via the
      // matching save callback so reloads pick up the in-progress state.
      if (view.selection.kind === 'image') {
        deps.saveImageMeta(view.obj as ImageObject)
      } else {
        deps.saveText(view.obj as TextObject)
      }
      ctx.markCommittedDirty()
    },

    onPointerUp(e, ctx): void {
      commitDrag(e)
      ctx.markCommittedDirty()
    },

    redraw(ctx): void {
      clearLayer(ctx.liveLayer)
      const view = getView()
      if (!view) return

      const { x, y, w, h } = view.transform
      const r = view.rotation
      const c = ctx.liveLayer.ctx
      const accent = resolveAccent(c)

      // Outline — drawn rotated around rect center. Same code path for
      // image + text since the math is identical (transform + rotation).
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
      c.save()
      c.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0)
      const positions = handlePositions(view.transform, view.rotation)
      const boardToScreen = (p: { x: number; y: number }): { x: number; y: number } => ({
        x: (p.x - ctx.camera.x) * ctx.camera.scale,
        y: (p.y - ctx.camera.y) * ctx.camera.scale,
      })
      // Texts get the 4 corners only (no edges — those don't have a
      // sensible visual semantic when the rect is content-driven). The
      // hit-test filters with the same predicate so visual ↔ interactive
      // stay in sync.
      const visibleHandles =
        view.selection.kind === 'text'
          ? (['nw', 'ne', 'se', 'sw'] as const)
          : (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const)
      for (const hid of visibleHandles) {
        const s = boardToScreen(positions[hid])
        c.fillStyle = '#ffffff'
        c.fillRect(s.x - HANDLE_PX / 2 - 1, s.y - HANDLE_PX / 2 - 1, HANDLE_PX + 2, HANDLE_PX + 2)
        c.fillStyle = accent
        c.fillRect(s.x - HANDLE_PX / 2, s.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX)
      }

      // Rotation handle + connecting line, anchored above the N (top-
      // center) of the rect. For texts (which don't render the N handle
      // itself), the connecting line still starts at the top-center
      // position — visually consistent.
      const rotPos = boardToScreen(
        rotationHandlePos(view.transform, view.rotation, ctx.camera.scale),
      )
      const nPos = boardToScreen(positions.n)
      c.strokeStyle = accent
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(nPos.x, nPos.y)
      c.lineTo(rotPos.x, rotPos.y)
      c.stroke()
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

    renderContextualMenu(host, dismiss): void {
      // Right-click contextual menu — content depends on what's selected.
      // Currently only text gets a rich menu (Color / Font / Size /
      // B / I / U). Image-selection / no-selection both fall through
      // to the static TOOL / VIEW / EXPORT rows that toolmenu.ts adds
      // outside this hook.
      const sel = selected
      if (!sel || sel.kind !== 'text') return
      const t = deps.getTexts().find((x) => x.id === sel.id)
      if (!t || t.deleted) return

      const applyEdit = (mutate: (text: TextObject) => void): void => {
        const before = {
          content: t.content,
          font: { ...t.font },
          color: t.color,
        }
        mutate(t)
        // Re-fit the rect to any font-affecting changes so the rendered
        // bbox stays correct.
        const fitted = resizeToFit(t)
        t.transform = fitted.transform
        deps.saveText(t)
        const after = {
          content: t.content,
          font: { ...t.font },
          color: t.color,
        }
        deps.pushOp({ kind: 'edit-text', textId: t.id, before, after })
        deps.markCommittedDirty()
      }

      // COLOR
      host.appendChild(sectionLabel('Color'))
      const palette = paletteGrid()
      for (const c of PALETTE) {
        palette.appendChild(
          swatch({
            color: c,
            active: t.color === c,
            onClick: () => {
              applyEdit((x) => {
                x.color = c
              })
              dismiss()
            },
          }),
        )
      }
      host.appendChild(palette)

      // FONT
      host.appendChild(separator())
      host.appendChild(sectionLabel('Font'))
      const fontRow = pillRow()
      const families: { id: TextFontFamily; label: string }[] = [
        { id: 'mono', label: 'Mono' },
        { id: 'sans', label: 'Sans' },
        { id: 'serif', label: 'Serif' },
      ]
      for (const f of families) {
        fontRow.appendChild(
          pill({
            label: f.label,
            active: t.font.family === f.id,
            onClick: () => {
              applyEdit((x) => {
                x.font = { ...x.font, family: f.id }
              })
              dismiss()
            },
          }),
        )
      }
      host.appendChild(fontRow)

      // SIZE
      host.appendChild(separator())
      host.appendChild(sectionLabel('Size'))
      const sizeRow = pillRow()
      for (const s of [12, 14, 18, 24, 36]) {
        sizeRow.appendChild(
          pill({
            label: String(s),
            active: t.font.size === s,
            onClick: () => {
              applyEdit((x) => {
                x.font = { ...x.font, size: s }
              })
              dismiss()
            },
          }),
        )
      }
      host.appendChild(sizeRow)

      // STYLE (B / I / U)
      host.appendChild(separator())
      host.appendChild(sectionLabel('Style'))
      const styleRow = pillRow()
      styleRow.appendChild(
        pill({
          label: 'B',
          active: t.font.bold,
          onClick: () => {
            applyEdit((x) => {
              x.font = { ...x.font, bold: !x.font.bold }
            })
            dismiss()
          },
        }),
      )
      styleRow.appendChild(
        pill({
          label: 'I',
          active: t.font.italic,
          onClick: () => {
            applyEdit((x) => {
              x.font = { ...x.font, italic: !x.font.italic }
            })
            dismiss()
          },
        }),
      )
      styleRow.appendChild(
        pill({
          label: 'U',
          active: t.font.underline,
          onClick: () => {
            applyEdit((x) => {
              x.font = { ...x.font, underline: !x.font.underline }
            })
            dismiss()
          },
        }),
      )
      host.appendChild(styleRow)
    },

    cleanup(): void {
      selected = null
      drag = null
    },

    getSelectedImage(): ImageObject | null {
      // Backward-compat narrow accessor: returns the selected image only
      // when an IMAGE is currently selected. main.ts uses this for the
      // image-clipboard copy/cut paths (which don't apply to texts).
      const sel = selected
      if (!sel || sel.kind !== 'image') return null
      const img = deps.getImages().find((i) => i.id === sel.id)
      if (!img || img.deleted) return null
      return img
    },

    getSelected(): Selection | null {
      return selected
    },

    selectImageById(id: string): void {
      const img = deps.getImages().find((i) => i.id === id)
      if (!img || img.deleted) return
      selected = { kind: 'image', id }
      // Any in-flight drag from a prior pointer interaction is stale
      // when the selection is force-changed externally; drop it so the
      // next pointerdown starts cleanly.
      drag = null
      deps.markCommittedDirty()
    },

    deleteSelected(): boolean {
      if (!selected) return false
      // Guard against double-delete: if the object was already removed
      // (e.g. by a Cmd+A batch path racing the Delete key, or future
      // remote / sync state), don't fire a redundant op that would
      // corrupt the undo sequence.
      if (selected.kind === 'image') {
        const id = selected.id
        const img = deps.getImages().find((i) => i.id === id)
        if (!img || img.deleted) {
          selected = null
          return false
        }
        img.deleted = true
        deps.saveImageMeta(img)
        deps.pushOp({ kind: 'delete-image', imageId: id })
      } else {
        const id = selected.id
        const t = deps.getTexts().find((x) => x.id === id)
        if (!t || t.deleted) {
          selected = null
          return false
        }
        t.deleted = true
        deps.saveText(t)
        deps.pushOp({ kind: 'delete-text', textId: id })
      }
      selected = null
      deps.markCommittedDirty()
      return true
    },
  }
}

/**
 * Resize math for a text object — different from image resize because
 * text width/height are content-derived (via measureText). The user
 * grabs a CORNER and drags; we compute a scale factor from the diagonal
 * of (pointer - anchor) in the rect's local frame, apply that to
 * font.size, then re-fit. The anchor stays pinned in board space.
 *
 * Only corner handles produce a valid scale (the diagonal needs both
 * x and y components). Edge handles are excluded by the handle picker.
 */
function applyTextResize(
  beforeTransform: ImageObject['transform'],
  beforeFontSize: number,
  beforeTextSnapshot: { content: string; font: TextObject['font']; color: string },
  rotation: number,
  handle: HandleId,
  anchorBoard: { x: number; y: number },
  pointerBoard: { x: number; y: number },
): { newSize: number; newTransform: ImageObject['transform'] } {
  // Project (pointer - anchor) into the rect's local frame.
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const vx = pointerBoard.x - anchorBoard.x
  const vy = pointerBoard.y - anchorBoard.y
  const localXDelta = vx * cos + vy * sin
  const localYDelta = -vx * sin + vy * cos

  // Scale factor = local diagonal / original diagonal. Floor at 1/8 so
  // a wild drag toward the anchor doesn't shrink the font below a
  // legible threshold; cap at 10x so an outward fling doesn't produce
  // an unmeasurable monster rect.
  const originalDiag = Math.hypot(beforeTransform.w, beforeTransform.h)
  const newDiag = Math.hypot(localXDelta, localYDelta)
  const rawScale = newDiag / Math.max(originalDiag, 1)
  const scale = Math.max(0.125, Math.min(10, rawScale))

  // Apply to font.size. Floor at 6 so single-character glyphs remain
  // selectable; the menu offers 12 as the smallest default size, but
  // dragged resizes can land below that.
  const newSize = Math.max(6, beforeFontSize * scale)

  // Re-fit the rect to the new measured content. Use a synthetic
  // TextObject with the new size for measurement; we only need the
  // transform.w/h out of it.
  const tempText: TextObject = {
    id: '__tmp__',
    content: beforeTextSnapshot.content,
    font: { ...beforeTextSnapshot.font, size: newSize },
    color: beforeTextSnapshot.color,
    transform: { x: 0, y: 0, w: 0, h: 0 },
    z: 0,
    createdAt: 0,
  }
  const fitted = resizeToFit(tempText)
  const newW = fitted.transform.w
  const newH = fitted.transform.h

  // Direction signs of the DRAGGED handle in local coords. Anchor is
  // the opposite, so the new center sits at anchor + (sx*newW/2,
  // sy*newH/2) rotated into board space — keeps the anchor pinned
  // pixel-for-pixel.
  let sx = 0
  let sy = 0
  switch (handle) {
    case 'nw':
      sx = -1
      sy = -1
      break
    case 'ne':
      sx = +1
      sy = -1
      break
    case 'se':
      sx = +1
      sy = +1
      break
    case 'sw':
      sx = -1
      sy = +1
      break
    default:
      // Edge handles don't apply to text — defensive.
      sx = +1
      sy = +1
  }
  const halfX = (sx * newW) / 2
  const halfY = (sy * newH) / 2
  const centerX = anchorBoard.x + halfX * cos - halfY * sin
  const centerY = anchorBoard.y + halfX * sin + halfY * cos

  return {
    newSize,
    newTransform: {
      x: centerX - newW / 2,
      y: centerY - newH / 2,
      w: newW,
      h: newH,
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
