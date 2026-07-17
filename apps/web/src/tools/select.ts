/**
 * Select tool — universal pointer for manipulating any board object
 * (image, text, stroke), single or multi. While Select is active:
 *
 *   - Click an object (reverse-z first-hit, priority texts > images >
 *     strokes) → it becomes the sole selection.
 *   - **Shift+click** an object → toggles it in/out of the current
 *     selection (additive multi-select).
 *   - **Marquee drag** on empty canvas → draws a rectangle; release
 *     picks every non-deleted object whose bbox / sample falls inside
 *     and replaces the selection. `Shift+drag` is additive (extends
 *     the existing selection rather than replacing).
 *   - **Cmd/Ctrl+A** → selects every non-deleted object across all
 *     three kinds. Activates Select if not already active.
 *   - Hover an object body → cursor changes to `move`; hover a handle →
 *     directional resize cursor. Hover the rotation handle → rotate
 *     cursor. (Strokes have no handles — body hover only. Handles only
 *     drawn for single-selection.)
 *   - Drag the body of any selected object → translates the WHOLE
 *     selection (single or group). Single-selection of images / texts:
 *     drag a corner handle → resize from the opposite corner; image gets
 *     anchor-preserving rect resize, text gets font-size scaling.
 *     Drag an edge handle on a text (E/W only) → adjust wrapWidth; on
 *     an image (all 8) → 1-axis resize. Shift on a corner image
 *     constrains the aspect ratio.
 *   - Drag the rotation handle → rotate (single-selection only).
 *     Double-click rotation handle → reset to 0°. (Texts rotate too;
 *     strokes don't.)
 *   - Click empty space → deselects (replaces with `[]`).
 *   - **Esc** → clears selection, AND aborts any in-flight marquee
 *     (the latter detected via `hasPendingMarquee()`).
 *   - Delete / Backspace → soft-deletes every selected object across
 *     kinds via one composite `delete-many` op (single undo step).
 *
 * Pen / Eraser treat all objects as inert — no hit-test, no
 * handles. Selection state is held inside the tool and discarded on
 * tool switch (committing any in-flight drag op first — see
 * `cleanup()`).
 *
 * Rendering: live-layer paint dispatched per kind. Floating objects
 * (image, text) get an outline + 8/6 handles + rotation handle on
 * single-selection; multi-selection gets a dashed group bbox enclosing
 * the union AABB with NO handles (move + delete only). Strokes get a
 * perfect-freehand outline halo + dashed bbox. Outline scales with zoom
 * (drawn in board space). Handles are constant *pixel* size so they
 * don't disappear when zoomed out — drawn in screen space, positioned
 * from board → screen via the camera transform.
 *
 * Selection model: `selected: Selection[]` where `Selection = { kind,
 * id }` is a 3-variant discriminated union (image | text | stroke).
 * Single-selection is `selected.length === 1`; multi is `> 1`; nothing
 * is `[]`. A `getView()` helper resolves a single Selection to a live
 * `ObjectView` exposing `{ transform, rotation }` uniformly. Handle
 * math, rotate math, and hover-cursor logic operate on the view — they
 * don't care what kind of object is selected. See [ADR 0014] (selection
 * union) and [ADR 0016] (Lasso absorption that produced the array
 * form + marquee + multi-select).
 *
 * Drag state model: a single discriminated-union variable `activeDrag:
 * ActiveDrag | null` carries the three mutually-exclusive drag modes
 * (`{ kind: 'single' | 'multi' | 'marquee'; state }`). Switching modes
 * is one assignment; exclusion is structural rather than convention.
 * `commitDrag` dispatches on the union kind.
 *
 * Kind-specific code lives in two places: the per-kind
 * `ObjectBehavior<T>` vtable in ./select/behaviors.ts (live-object
 * resolution, view parts, drag commits, multi-drag lifecycle, delete-op
 * slots — the migration ADR 0014 promised at 4 kinds), and the
 * intentionally-local sites here (`objectAt` hit-test order, marquee
 * hit semantics, per-kind resize math in onPointerMove, per-kind
 * selection paint). Adding a 5th object kind is one behavior entry plus
 * those local sites, not a fan-out across every interaction handler.
 */

import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import { imageAABB, imageCenter, pointInImage } from '../imagegeom'
import type { Op, TransformManyItem } from '../ops'
import { applyCamera, clearLayer } from '../render'
import { pointInShape, shapeAABB } from '../rendershapes'
import { getStrokeBBox, getStrokePath } from '../stroke'
import {
  invalidateTextMeasurement,
  pointInText,
  resizeToFit,
  TEXT_PADDING_X,
  textAABB,
} from '../textgeom'
import {
  _applyStrokeMoveStep,
  type BehaviorDeps,
  behaviorFor,
  type DeleteManyIds,
  type MultiDragHandle,
} from './select/behaviors'
import {
  anchorBoardFor,
  cursorFor,
  enabledHandles,
  type HandleId,
  handleAt,
  handlePositions,
  isOverRotationHandle,
  rotationHandlePos,
} from './select/handles'
import { renderShapeContextualMenu, renderTextContextualMenu } from './select/menu'
import type { Tool, ToolContext } from './types'

/** Discriminated-union pointer to a single board object across the
 *  three v1.3 kinds. Exported so external callers (the clipboard
 *  paste path in `main.ts`, future history-panel UI, etc.) can name
 *  the shape directly rather than re-declaring a structural copy. */
export type Selection =
  | { kind: 'image'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'stroke'; id: string }
  | { kind: 'shape'; id: string }

/**
 * Live view of the currently-selected object. Both `obj` and `transform`
 * are LIVE references — mutating `transform.x/y` (and saving via the
 * matching `save*` callback) is the canonical way to move/resize during
 * a drag. Strokes don't carry a transform field of their own; their
 * "transform" is derived from the bbox of their samples.
 *
 * Exported (type-only) for `./select/handles.ts`, whose pure handle
 * hit-test functions take the view as input.
 */
export interface ObjectView {
  selection: Selection
  obj: ImageObject | TextObject | Stroke | ShapeObject
  transform: ImageObject['transform']
  rotation: number
}

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

/**
 * State for a multi-object move drag. Active when the user pointer-downs
 * on an object that's part of a multi-selection (length > 1); all
 * selected objects translate together.
 *
 * Per-item state lives inside the per-kind MultiDragHandle closures
 * built by the behavior registry (./select/behaviors.ts):
 *   - image / text / shape: snapshot the transform rect — each tick
 *     recomputes `transform.x/y` from before + total delta (matches the
 *     single-object move path).
 *   - stroke: track cumulative applied delta — each tick mutates
 *     samples + erasedStamps by the step delta (matches the single-
 *     stroke move path, which mutates in place rather than carrying a
 *     before-snapshot).
 *
 * Resize / rotation are intentionally not part of multi-drag: combined
 * resize across kinds (image rect resize vs text font-size scale)
 * doesn't have a single coherent UX, and multi-rotation around a shared
 * center is a power-user feature better deferred to a dedicated
 * marquee handle if/when needed.
 */
interface MultiDragState {
  startBoard: { x: number; y: number }
  items: MultiDragHandle[]
}

/**
 * Drag-rectangle selection state. Activated by pointer-down on EMPTY
 * canvas; the rectangle is painted on the live layer during the drag
 * and hit-tests against all objects on release. Shift held during
 * the drag makes the selection additive (unioned with existing
 * selection rather than replacing).
 *
 * `live` flips true only after the pointer moves past MARQUEE_NOOP_PX
 * — until then, the drag is a "candidate" that might still be a click
 * (which is the empty-space-deselect path). This avoids painting a
 * 1px marquee for tap-only intent.
 */
interface MarqueeDragState {
  startBoard: { x: number; y: number }
  currentBoard: { x: number; y: number }
  startScreen: { x: number; y: number }
  live: boolean
  additive: boolean
}

/** Screen-pixel distance threshold to upgrade marquee from candidate
 *  to live. Generous because pen-on-tablet drift is significant on
 *  Wacom Intuos at default sensitivity. */
const MARQUEE_NOOP_PX = 4

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
    wrapWidth: number | undefined
  } | null
  /** Cumulative board-space delta applied to a STROKE's samples during a
   *  move drag. Each onPointerMove tick computes the new desired total
   *  delta and applies the difference from this snapshot, so the per-
   *  tick sample translation stays incremental (avoids redundant work)
   *  and the commit op carries the final (dx, dy). */
  strokeMoveApplied: { dx: number; dy: number } | null
  /** Board-space coords of the pointer at pointerdown. */
  startBoard: { x: number; y: number }
}

/** The Select tool's full dependency surface: the per-kind object
 *  access / persistence / undo-push slice shared with the behavior
 *  vtable (see BehaviorDeps in ./select/behaviors.ts), plus the
 *  tool-level callbacks below that the behaviors never touch. */
interface SelectToolDeps extends BehaviorDeps {
  /** Apply an op (mutate in-memory state + persist). Used by the
   *  delete path so the single mutation surface is `applyOp`, matching
   *  the canonical pattern in `erasercallbacks.ts`. In-flight drag
   *  paths still mutate directly + save per tick (see `saveStroke`
   *  contract above) because they need fine-grained intermediate
   *  state, not one atomic apply. */
  applyOp: (op: Op) => void
  /** Mark the committed layer dirty so the next frame re-renders. */
  markCommittedDirty: () => void
  /** Fired when the user double-clicks a TEXT body. Caller (main.ts)
   *  switches to the Text tool and opens edit mode on the given text
   *  via the Text tool's `editTextById`. Decoupled from the Text tool
   *  reference itself so the Select tool stays unaware of its sibling. */
  onTextDoubleClick?: (id: string, ctx: ToolContext) => void
  /** Fired after EVERY selection mutation (single pick, multi-select
   *  toggle, marquee finalize, selectAll, clearSelection, delete,
   *  selectByIds, etc.). Lets external state derived from the
   *  selection refresh — main.ts wires this to the pinned tool menu's
   *  rebuild hook so the right-click contextual section reflects the
   *  newly-selected object's options (e.g. shape style row, text
   *  font row). v1.4 review fix. */
  onSelectionChange?: () => void
}

/** Pixel size of selection handles (constant on screen, regardless of zoom). */
const HANDLE_PX = 8
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
  /** Live reference to the currently-selected IMAGE when EXACTLY ONE
   *  image is selected. Null otherwise (nothing selected, multi-
   *  selection, or a non-image is selected). Kept narrow so existing
   *  main.ts Cmd+C / Cmd+X paths (which only handle a single image)
   *  stay unchanged. */
  getSelectedImage(): ImageObject | null
  /** Single-selection accessor. Returns the lone selection if exactly
   *  one object is selected; null otherwise (nothing OR multi). Use
   *  `getSelections()` for the multi-aware accessor. */
  getSelected(): Selection | null
  /** Multi-aware accessor — returns the full selection array (empty,
   *  one, or many). Order is insertion order; for marquee selection
   *  it's "topmost first." */
  getSelections(): readonly Selection[]
  /** Replace the selection with a single image by id (e.g. after paste
   *  so the user can immediately position it). Caller is responsible
   *  for marking the canvas dirty and switching the active tool to
   *  Select first; this method only updates internal selection state.
   *  Silently does nothing if no image with `id` exists or it is
   *  soft-deleted. */
  selectImageById(id: string): void
  /** Symmetric to selectImageById for text objects. Used by the
   *  Cmd+V text-paste path so the freshly-created TextObject is
   *  pre-selected for immediate positioning. */
  selectTextById(id: string): void
  /** Symmetric to selectImageById/selectTextById for strokes. Today the
   *  external selection-by-id callers are paste flows (no stroke
   *  equivalent), but the symmetric API is here so future callers
   *  (e.g. "jump to stroke from history panel") don't need a backdoor
   *  into module state. */
  selectStrokeById(id: string): void
  /** Symmetric selector for shapes. Used post-paste so freshly-pasted
   *  shapes are pre-selected for immediate positioning. */
  selectShapeById(id: string): void
  /** Replace the selection with EVERY non-deleted object across all
   *  kinds (strokes + images + texts). Used by Cmd+A. Caller is
   *  responsible for switching the active tool to Select first. */
  selectAll(): void
  /** Replace the selection with an explicit list. Used by the
   *  whiteboard-native paste flow so a freshly-pasted group of strokes
   *  is pre-selected for immediate positioning. Items whose underlying
   *  object is missing / deleted are silently skipped. */
  selectByIds(items: readonly Selection[]): void
  /** Drop any current selection AND abort any in-progress marquee /
   *  drag. Used by Esc to cancel either a committed selection or a
   *  selection gesture in progress. Distinct from cleanup() —
   *  clearSelection doesn't switch tools (use cleanup for that). */
  clearSelection(): void
  /** True when a live (past-threshold) marquee drag is in flight.
   *  Used by main.ts's Esc handler to detect "user is mid-marquee and
   *  wants to abort" — without this, Esc only fires `clearSelection()`
   *  when there are already selected objects, leaving a candidate
   *  marquee to commit on the next pointer-up. */
  hasPendingMarquee(): boolean
  /** Soft-delete every selected object via ONE composite `delete-many`
   *  op, so the whole group restores in a single undo step. Returns
   *  true if anything was deleted. Single and multi cases share the
   *  same path. */
  deleteSelected(): boolean
  /** Adjust the SELECTED text's font size by `delta` board pixels.
   *  No-op when no single text is selected (multi-selection or non-
   *  text). Emits one edit-text op per keystroke so Cmd+Z restores
   *  the prior size. Used by the Cmd/Ctrl+Shift+,/. keyboard shortcut
   *  for fine-grained size adjustment. v1.4. */
  adjustSelectedTextFontSize(delta: number): boolean
}

// The underscored stroke-move internals moved into ./select/behaviors
// with the vtable; re-exported here so existing unit-test imports
// (select.stroke-move.test.ts, select.transform-many.test.ts) stay valid.
export { _applyStrokeMoveStep, _shouldPushStrokeTransformManyItem } from './select/behaviors'

/**
 * The Select tool has three drag modes — single-object transform,
 * multi-object move, marquee selection. They are mutually exclusive
 * (at most one is active at a time). Earlier code modeled this as
 * three independent nullable variables, making the exclusion a runtime
 * invariant that every transition site had to remember to maintain
 * (null `drag` before assigning `multiDrag`, etc.). This discriminated-
 * union variant pushes the invariant into the type system:
 * `activeDrag = { kind, state }` is one variable; switching modes is
 * one assignment; exclusion is structural rather than convention.
 *
 * The per-mode state shapes are intentionally NOT merged — DragState,
 * MultiDragState, and MarqueeDragState carry different fields with
 * different lifetimes. Only the container is unified.
 *
 * Inside functions that operate on a specific drag mode, the convention
 * is to narrow `activeDrag.state` to a local `const` (`drag`,
 * `multiDrag`, `marquee`) so the body code stays the same shape as
 * before the refactor and reads naturally.
 */
type ActiveDrag =
  | { kind: 'single'; state: DragState }
  | { kind: 'multi'; state: MultiDragState }
  | { kind: 'marquee'; state: MarqueeDragState }

export function createSelectTool(deps: SelectToolDeps): SelectTool {
  // Multi-aware selection: empty array = nothing selected; one element =
  // single-object mode (handles + rotate + transform UI); >1 elements =
  // multi-object mode (only move + delete; no per-object handles). The
  // single-object code paths read this via `singleSelection()` which
  // returns the lone item or null.
  let selected: Selection[] = []
  // Active drag — at most one of (single transform, multi move,
  // marquee selection) at any moment. Discriminated union enforces
  // mutual exclusion at the type level; see comment block above.
  let activeDrag: ActiveDrag | null = null

  /** Update the selection array and fire deps.onSelectionChange.
   *  Every site that mutates the selection routes through this helper
   *  so external state (e.g. the pinned right-click menu's contextual
   *  section, which depends on what's selected) stays in sync without
   *  manual notification at each callsite. Cheap to call — the
   *  callback is a no-op when external state has no derived view. */
  function setSelection(next: Selection[]): void {
    selected = next
    deps.onSelectionChange?.()
  }

  /** Returns the single-selected item when exactly one object is
   *  selected; null when empty or multi. Used by all paths that need
   *  single-object semantics (handles, contextual menu, image-clipboard
   *  copy). Cached at the top of any function that uses it so the
   *  closure-captured value survives nested callbacks. */
  function singleSelection(): Selection | null {
    return selected.length === 1 ? (selected[0] ?? null) : null
  }

  /** Shared implementation for `selectImageById` / `selectTextById` /
   *  `selectStrokeById`. Verifies the object exists + isn't deleted,
   *  commits any in-flight drag (matching `selectAll` / `selectByIds` /
   *  `clearSelection` for drag-state consistency), and replaces the
   *  selection with the single item. Silent no-op when the underlying
   *  object is missing or deleted. */
  function selectSingleById(sel: Selection): void {
    if (!behaviorFor(sel.kind).resolve(deps, sel.id)) return
    commitDrag(null)
    setSelection([sel])
    activeDrag = null
    deps.markCommittedDirty()
  }
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

  /** Resolve the SINGLE-selected object to a live ObjectView, or null
   *  if nothing is selected, multiple objects are selected, or the
   *  selected object has been deleted out from under the selection.
   *  Multi-selection deliberately returns null here so single-object
   *  code paths (handles, rotate UI, contextual menu) don't accidentally
   *  fire on the first of a multi-selection — the multi case is
   *  handled by dedicated render + drag paths. */
  function getView(): ObjectView | null {
    const sel = singleSelection()
    if (!sel) return null
    const b = behaviorFor(sel.kind)
    const obj = b.resolve(deps, sel.id)
    if (!obj) return null
    // Rect kinds expose their LIVE transform reference (mutating it is
    // the canonical drag path); strokes get a fresh bbox-derived rect.
    const { transform, rotation } = b.viewParts(obj)
    return { selection: sel, obj, transform, rotation }
  }

  /** Top-most non-deleted object whose rotated rect (image / text /
   *  shape) or per-sample tolerance ring (stroke) contains the
   *  board-space point. Priority order matches the visual stack
   *  (top → bottom):
   *    1. Shapes — render ABOVE texts per renderShapes.ts ordering, so
   *       a circle drawn over a label is clickable as the circle, not
   *       the label underneath. The original v1.4 ordering checked
   *       texts first; that contradicted the render stack and was
   *       fixed during the v1.4 review pass.
   *    2. Texts (above images per the render order)
   *    3. Images
   *    4. Strokes (drawn on top of images + texts on the composite, but
   *       semantically "behind" the floating objects for selection
   *       purposes — clicking a text-on-top-of-stroke should select the
   *       text, not the stroke beneath)
   *  Within each kind, reverse-z so paste-time-latest wins. Stroke hit-
   *  test uses a per-sample tolerance ring (matches Lasso's tap-select
   *  tolerance) — a pixel-perfect stroke-outline test would be more
   *  expensive without meaningfully improving the UX. */
  function objectAt(boardX: number, boardY: number, scale: number): Selection | null {
    // Shapes — same screen-tolerance as strokes so thin lines / arrows
    // are reliably tap-selectable at any zoom. Rect / ellipse with fill
    // hit the whole interior; outline-only hit near the boundary.
    const SHAPE_TOL_PX = 10
    const shapeTol = SHAPE_TOL_PX / scale
    const shapes = [...deps.getShapes()].filter((s) => !s.deleted).sort((a, b) => b.z - a.z)
    for (const sh of shapes) {
      if (pointInShape({ x: boardX, y: boardY }, sh, shapeTol)) {
        return { kind: 'shape', id: sh.id }
      }
    }
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
    // Stroke tap-select. Tolerance scales with zoom so a 10-screen-px
    // ring around each sample point is the effective hit zone. Same
    // tolerance as Lasso's findStrokeAt so the two tools feel
    // consistent.
    const TOL_PX = 10
    const tol = TOL_PX / scale
    const tol2 = tol * tol
    const strokes = deps.getStrokes()
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i]
      if (!s || s.deleted) continue
      const bb = getStrokeBBox(s)
      if (
        boardX < bb.minX - tol ||
        boardX > bb.maxX + tol ||
        boardY < bb.minY - tol ||
        boardY > bb.maxY + tol
      ) {
        continue
      }
      for (const sample of s.samples) {
        const dx = sample.x - boardX
        const dy = sample.y - boardY
        if (dx * dx + dy * dy <= tol2) return { kind: 'stroke', id: s.id }
      }
    }
    return null
  }

  /** Paint the live marquee rectangle on the live layer. Dashed accent
   *  outline + a faint accent fill. Drawn in board space so it scales
   *  with the camera (the rect is always 1px-stroke at any zoom). */
  function drawMarquee(m: MarqueeDragState, ctx: ToolContext): void {
    const box = marqueeAABB(m)
    const c = ctx.liveLayer.ctx
    const accent = resolveAccent(c)
    applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
    const scale = ctx.camera.scale
    c.save()
    c.fillStyle = accent
    c.globalAlpha = 0.08
    c.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
    c.globalAlpha = 1
    c.strokeStyle = accent
    c.lineWidth = 1 / scale
    c.setLineDash([4 / scale, 4 / scale])
    c.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
    c.restore()
  }

  /** Normalize a marquee rect (allowing drag in any direction) into an
   *  AABB in board space. */
  function marqueeAABB(m: MarqueeDragState): {
    minX: number
    minY: number
    maxX: number
    maxY: number
  } {
    return {
      minX: Math.min(m.startBoard.x, m.currentBoard.x),
      minY: Math.min(m.startBoard.y, m.currentBoard.y),
      maxX: Math.max(m.startBoard.x, m.currentBoard.x),
      maxY: Math.max(m.startBoard.y, m.currentBoard.y),
    }
  }

  /** Does any sample of the stroke fall inside the marquee AABB? Mirrors
   *  the Lasso tool's hit semantics for consistency — a stroke that
   *  passes through the rect counts as selected, even if its sample
   *  cloud isn't fully enclosed. */
  function strokeIntersectsMarquee(
    stroke: Stroke,
    box: { minX: number; minY: number; maxX: number; maxY: number },
  ): boolean {
    for (const p of stroke.samples) {
      if (p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY) {
        return true
      }
    }
    return false
  }

  /** Does the object's AABB intersect the marquee AABB? Used for images
   *  and texts (rect-vs-rect overlap). Partial overlap is enough —
   *  matches the user expectation that "the marquee touched it." */
  function aabbIntersects(
    a: { minX: number; minY: number; maxX: number; maxY: number },
    b: { minX: number; minY: number; maxX: number; maxY: number },
  ): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
  }

  /** Finalize a live marquee: hit-test every object and merge with the
   *  current selection (additive) or replace it. */
  function finalizeMarquee(m: MarqueeDragState): void {
    const box = marqueeAABB(m)
    const hits: Selection[] = []
    for (const s of deps.getStrokes()) {
      if (s.deleted) continue
      if (strokeIntersectsMarquee(s, box)) hits.push({ kind: 'stroke', id: s.id })
    }
    for (const img of deps.getImages()) {
      if (img.deleted) continue
      const ib = imageAABB(img)
      if (aabbIntersects(ib, box)) hits.push({ kind: 'image', id: img.id })
    }
    for (const t of deps.getTexts()) {
      if (t.deleted) continue
      const tb = textAABB(t)
      if (aabbIntersects(tb, box)) hits.push({ kind: 'text', id: t.id })
    }
    for (const sh of deps.getShapes()) {
      if (sh.deleted) continue
      const sb = shapeAABB(sh)
      if (aabbIntersects(sb, box)) hits.push({ kind: 'shape', id: sh.id })
    }
    if (m.additive) {
      // Union with existing selection — dedupe by kind+id.
      const seen = new Set(selected.map((s) => `${s.kind}:${s.id}`))
      const next = [...selected]
      for (const h of hits) {
        const key = `${h.kind}:${h.id}`
        if (!seen.has(key)) {
          next.push(h)
          seen.add(key)
        }
      }
      setSelection(next)
    } else {
      setSelection(hits)
    }
  }

  /** Build the per-item multi-drag handles via the behavior registry
   *  (rect kinds snapshot their transform; strokes initialize the
   *  applied-delta tracker). Items whose object is missing / deleted at
   *  drag-start are skipped. */
  function startMultiDrag(startBoard: { x: number; y: number }): MultiDragState {
    const items: MultiDragHandle[] = []
    for (const sel of selected) {
      const h = behaviorFor(sel.kind).beginMultiDrag(deps, sel.id)
      if (h) items.push(h)
    }
    return { startBoard, items }
  }

  /** Per-tick multi-move translation. Each handle re-resolves its live
   *  object and applies the total delta in its own kind's terms (rect
   *  kinds overwrite transform.x/y from before + delta; strokes mutate
   *  samples + erasedStamps by the incremental step). */
  function tickMultiDrag(d: MultiDragState, bx: number, by: number): void {
    const dx = bx - d.startBoard.x
    const dy = by - d.startBoard.y
    for (const h of d.items) h.tick(dx, dy)
  }

  /** Commit a multi-move drag: emit ONE composite `transform-many` op
   *  carrying every displaced item, rather than N per-item ops.
   *  Items with zero net translation are skipped — clicking through
   *  a multi-selection without actually moving doesn't pollute undo.
   *
   *  The composite-op shape:
   *   - One Cmd+Z reverses the whole group move (rather than N
   *     undos to unwind a 30-item drag).
   *   - Under M3 sync, one Y.Doc transaction → one wire update per
   *     peer (rather than N transactions × N peers = N² messages).
   *
   *  When zero items qualify (e.g. all selected objects were deleted
   *  between drag-start and drag-end, or the drag-step was below
   *  noop), no op is pushed at all. */
  function commitMultiDrag(d: MultiDragState): void {
    const items: TransformManyItem[] = []
    for (const h of d.items) {
      const item = h.commit()
      if (item) items.push(item)
    }
    if (items.length === 0) return
    deps.pushOp({ kind: 'transform-many', items })
  }

  /**
   * Finalize the current drag — dispatch to the selection kind's
   * behavior commit and clear drag state. Called from both onPointerUp (normal release)
   * and pointercancel-style entry paths (browser revoked the pointer
   * mid-drag, window blur, OS gesture steal). Without this shared path,
   * a pointercancel left `drag` non-null and the live transform
   * mutations un-recorded in undo.
   *
   * Dispatching through the behavior registry (instead of branching
   * inline) means adding an object kind is one behavior entry rather
   * than another ~30-line branch in a 130-line function.
   *
   * IMPORTANT: dispatch is on `d.selection.kind` (the snapshot captured
   * at drag-start) rather than re-resolving via `getView()`. Two
   * reasons:
   *   1. If the object was soft-deleted between drag-start and drag-
   *      end (Cmd+A → Delete race, or future remote/sync state),
   *      `getView()` returns null and the op would be silently
   *      dropped despite the per-tick mutations already being live.
   *   2. If the selection was replaced mid-drag (e.g. Shift+click
   *      adding to the selection set), `view.selection.kind` could
   *      differ from `d.selection.kind`, sending the commit down the
   *      wrong branch and casting an ImageObject to TextObject.
   *
   * The resolve below guards the deleted case (fails closed when the
   * object is gone) and the behavior commits push an op only when the
   * object's state actually changed during the drag. Pushing the op IS
   * the only correctness-critical action; missing the dispatch is what
   * loses the undo record.
   */
  function commitDrag(e: PointerEvent | null): void {
    if (!activeDrag) return
    // Marquee has no op to commit (it's a selection-set operation,
    // finalized in onPointerUp not commit). If commitDrag is called
    // while a marquee is live (e.g. tool-switch mid-drag), just drop
    // the marquee — no op needed.
    if (activeDrag.kind === 'marquee') {
      activeDrag = null
      if (e) {
        ;(e.target as Element | null)?.releasePointerCapture?.(e.pointerId)
      }
      return
    }
    // Multi-move commit path.
    if (activeDrag.kind === 'multi') {
      const md = activeDrag.state
      activeDrag = null
      if (e) {
        ;(e.target as Element | null)?.releasePointerCapture?.(e.pointerId)
      }
      commitMultiDrag(md)
      return
    }
    // Single-object drag.
    const d = activeDrag.state
    activeDrag = null
    if (e) {
      ;(e.target as Element | null)?.releasePointerCapture?.(e.pointerId)
    }
    const isRotation = typeof d.kind === 'object' && 'rotate' in d.kind
    const isResize = typeof d.kind === 'object' && 'resize' in d.kind

    // Dispatch on the drag-start selection snapshot via the behavior
    // registry. Resolve fails closed if the object was deleted out from
    // under the drag.
    const b = behaviorFor(d.selection.kind)
    const obj = b.resolve(deps, d.selection.id)
    if (obj) b.commitSingleDrag(deps, d, obj, isRotation, isResize)
  }

  /** Paint the stroke-selection affordance: a perfect-freehand outline
   *  halo in the accent color + a dashed bounding box. No handles —
   *  strokes don't carry rect-shaped affordances and the underlying
   *  geometry is the per-sample freehand outline. Matches Lasso's
   *  selection visual so the two tools feel consistent. */
  function drawStrokeSelection(view: ObjectView, ctx: ToolContext): void {
    const c = ctx.liveLayer.ctx
    const accent = resolveAccent(c)
    applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
    const stroke = view.obj as Stroke
    const path = getStrokePath(stroke, [], true)
    const scale = ctx.camera.scale
    c.save()
    if (path) {
      c.strokeStyle = accent
      c.lineWidth = 3 / scale
      c.lineJoin = 'round'
      c.lineCap = 'round'
      c.stroke(path)
    }
    // Dashed bbox so the user has a clear "selected" rectangle even
    // for thin strokes whose halo blends with the stroke ink.
    const { x: bx, y: by, w: bw, h: bh } = view.transform
    c.strokeStyle = accent
    c.lineWidth = 1 / scale
    c.setLineDash([6 / scale, 4 / scale])
    c.strokeRect(bx, by, bw, bh)
    c.restore()
  }

  /** Paint the image/text-selection affordance: rotated outline, the
   *  appropriate handle set (8 for image, 6 for text), and the rotation
   *  handle. Image and text share this code because the math is
   *  identical — both reduce to `{ transform, rotation }` via ObjectView. */
  function drawFloatingObjectSelection(view: ObjectView, ctx: ToolContext): void {
    const c = ctx.liveLayer.ctx
    const accent = resolveAccent(c)
    const { x, y, w, h } = view.transform
    const r = view.rotation

    // Outline — drawn rotated around rect center.
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
    // Per-kind handle set — shared with the hit-test via
    // `enabledHandles` (handles.ts) so what's drawn and what's
    // grabbable can never drift apart. Texts: 4 corners + E/W edges.
    // Lines/arrows: the two true endpoints only. Everything else: 8.
    for (const hid of enabledHandles(view)) {
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
    const rotPos = boardToScreen(rotationHandlePos(view.transform, view.rotation, ctx.camera.scale))
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
  }

  function updateHoverCursor(ctx: ToolContext, boardX: number, boardY: number): void {
    const view = getView()

    // Strokes don't expose handles (no resize / rotate UI — strokes are
    // freehand geometry, not rect-shaped objects). Skip the handle
    // lookup entirely for stroke selections so we don't waste cycles
    // hit-testing handles that aren't drawn.
    if (view && view.selection.kind !== 'stroke') {
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

    const hit = objectAt(boardX, boardY, ctx.camera.scale)
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
    minSide = 16,
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

    // Minimum side prevents zero-sized objects from collapsing into a
    // hit-test dead zone. Default 16 for images/texts; shapes (esp.
    // lines & arrows) pass a smaller value because a near-horizontal
    // line legitimately has near-zero height in its transform.
    if (newW < minSide) newW = minSide
    if (newH < minSide) newH = minSide

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

  /** Endpoint-based resize for line / arrow shapes. The dragged
   *  corner becomes the new endpoint; the opposite corner (the
   *  anchor) stays put in board space. Returns a transform with
   *  `{ x, y }` at the anchor and `{ w, h }` as the pointer-relative
   *  offset — sign-preserved, so dragging past the anchor flips the
   *  line direction naturally. Rotation is honored by stashing the
   *  anchor and pointer in the rotated-local frame, computing the
   *  axis-aligned line there, and re-rotating the result.
   *
   *  Why this is different from the rect/ellipse `applyResize`:
   *  lines/arrows encode direction in the sign of `transform.w/h`,
   *  but `applyResize` takes `Math.abs` of the deltas. That throws
   *  away the sign and locks the line at a minSide nub when the
   *  user drags an end past its origin. Endpoint-based math avoids
   *  the abs entirely. v1.4 fix. */
  function applyLineResize(
    rotation: number,
    anchorBoard: { x: number; y: number },
    pointerBoard: { x: number; y: number },
  ): ImageObject['transform'] {
    // For non-rotated lines the math is trivial: transform.{x,y} =
    // anchor, transform.{w,h} = pointer - anchor.
    if (rotation === 0) {
      return {
        x: anchorBoard.x,
        y: anchorBoard.y,
        w: pointerBoard.x - anchorBoard.x,
        h: pointerBoard.y - anchorBoard.y,
      }
    }
    // For rotated lines we need to express the endpoint as the
    // pre-rotation offset from the anchor. Compute the delta in
    // world coords, then inverse-rotate it into the shape's local
    // frame. transform.{x,y} stays at the anchor; transform.{w,h}
    // is the LOCAL offset to the new endpoint.
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const vx = pointerBoard.x - anchorBoard.x
    const vy = pointerBoard.y - anchorBoard.y
    return {
      x: anchorBoard.x,
      y: anchorBoard.y,
      w: vx * cos + vy * sin,
      h: -vx * sin + vy * cos,
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
      // could overlap a resize handle on a small selection. Strokes have
      // no handles (no rect-shaped affordance), so they're skipped.
      if (
        view &&
        view.selection.kind !== 'stroke' &&
        isOverRotationHandle(bx, by, view, ctx.camera.scale)
      ) {
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
            } else if (view.selection.kind === 'shape') {
              const sh = view.obj as ShapeObject
              sh.rotation = undefined
              deps.saveShape(sh)
              deps.pushOp({ kind: 'rotate-shape', shapeId: sh.id, before, after: 0 })
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
        activeDrag = {
          kind: 'single',
          state: {
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
            strokeMoveApplied: null,
            startBoard: { x: bx, y: by },
          },
        }
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
        ctx.setCursor(ROTATE_CURSOR)
        return
      }

      // Resize handles next (image / text only — strokes have none).
      if (view && view.selection.kind !== 'stroke') {
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
                  wrapWidth: (view.obj as TextObject).wrapWidth,
                }
              : null
          activeDrag = {
            kind: 'single',
            state: {
              selection: view.selection,
              kind: {
                resize: handle,
                anchorBoard: anchorBoardFor(handle, view.transform, view.rotation),
              },
              before: { ...view.transform },
              beforeRotation: view.rotation,
              beforeFontSize,
              beforeTextSnapshot,
              strokeMoveApplied: null,
              startBoard: { x: bx, y: by },
            },
          }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          return
        }
      }

      // Hit-test against ALL objects (text → image → stroke, topmost wins).
      const hit = objectAt(bx, by, ctx.camera.scale)
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
        // Shift+click toggles the hit object in/out of the current
        // selection without starting a drag — pen-friendly equivalent
        // of marquee-multi-select for one-at-a-time picking.
        if (e.shiftKey) {
          const idx = selected.findIndex((s) => s.kind === hit.kind && s.id === hit.id)
          if (idx >= 0) {
            setSelection([...selected.slice(0, idx), ...selected.slice(idx + 1)])
          } else {
            setSelection([...selected, hit])
          }
          ctx.markCommittedDirty()
          return
        }

        // Is the hit object already part of a MULTI-selection? If so,
        // start a multi-move drag — every selected object translates
        // together. The selection itself isn't replaced, so the user
        // keeps their N-object set.
        const isHitInMulti =
          selected.length > 1 && selected.some((s) => s.kind === hit.kind && s.id === hit.id)
        if (isHitInMulti) {
          activeDrag = { kind: 'multi', state: startMultiDrag({ x: bx, y: by }) }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          ctx.markCommittedDirty()
          return
        }

        // Hit a single (or different) object: replace selection with
        // just that one and start the regular single-object drag.
        setSelection([hit])
        const fresh = getView()
        if (fresh) {
          activeDrag = {
            kind: 'single',
            state: {
              selection: hit,
              kind: 'move',
              before: { ...fresh.transform },
              beforeRotation: fresh.rotation,
              beforeFontSize: null,
              beforeTextSnapshot: null,
              // For stroke moves, track cumulative dx/dy applied to the
              // sample array so each tick only translates by the delta.
              // Null for image/text moves (they re-derive position from
              // `before` + startBoard each tick).
              strokeMoveApplied: hit.kind === 'stroke' ? { dx: 0, dy: 0 } : null,
              startBoard: { x: bx, y: by },
            },
          }
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          ctx.markCommittedDirty()
          return
        }
      }

      // Empty-space pointer-down — could be either (a) a click that
      // means "deselect," or (b) the start of a marquee drag. We defer
      // the decision: start a candidate marquee. If the pointer moves
      // past MARQUEE_NOOP_PX before release, it becomes a live marquee
      // and finalizes on release. If not, onPointerUp treats it as a
      // click and deselects.
      lastTextDownAt = Number.NEGATIVE_INFINITY
      lastTextDownId = null
      activeDrag = {
        kind: 'marquee',
        state: {
          startBoard: { x: bx, y: by },
          currentBoard: { x: bx, y: by },
          startScreen: { x: e.clientX, y: e.clientY },
          live: false,
          additive: e.shiftKey,
        },
      }
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    },

    onPointerMove(e, ctx): void {
      const { x: bx, y: by } = ctx.toBoard(e.clientX, e.clientY)

      // Marquee drag — promote candidate to live once past threshold,
      // then update the live rect each tick.
      if (activeDrag?.kind === 'marquee') {
        const marquee = activeDrag.state
        if (!marquee.live) {
          const ddx = e.clientX - marquee.startScreen.x
          const ddy = e.clientY - marquee.startScreen.y
          if (Math.hypot(ddx, ddy) > MARQUEE_NOOP_PX) {
            marquee.live = true
          }
        }
        marquee.currentBoard = { x: bx, y: by }
        if (marquee.live) ctx.markCommittedDirty()
        return
      }

      // Multi-object move tick — translate every selected object by the
      // running delta from drag start.
      if (activeDrag?.kind === 'multi') {
        tickMultiDrag(activeDrag.state, bx, by)
        ctx.markCommittedDirty()
        return
      }

      if (!activeDrag || activeDrag.kind !== 'single') {
        updateHoverCursor(ctx, bx, by)
        return
      }
      const drag = activeDrag.state

      const view = getView()
      if (!view) return

      if (drag.kind === 'move') {
        const totalDx = bx - drag.startBoard.x
        const totalDy = by - drag.startBoard.y
        if (view.selection.kind === 'stroke') {
          // Strokes don't carry a `transform` field — their position is
          // the per-sample x/y. Translate each sample by the DELTA from
          // the last applied total (not absolute) so the per-tick work
          // is bounded by the drag-step size, not the cumulative drag
          // distance. erasedStamps (which live at absolute board coords)
          // move with the stroke so partly-erased holes stay in the
          // right place. Bbox cache invalidated so the next render uses
          // the fresh extent.
          const stroke = view.obj as Stroke
          const applied = drag.strokeMoveApplied
          if (applied) _applyStrokeMoveStep(stroke, applied, totalDx, totalDy)
        } else {
          // Image / text / shape: rect-transform objects. Move = re-derive
          // transform.x/y from `before` + total delta (single in-place
          // mutation per tick; idempotent).
          ;(view.obj as ImageObject | TextObject | ShapeObject).transform.x =
            drag.before.x + totalDx
          ;(view.obj as ImageObject | TextObject | ShapeObject).transform.y =
            drag.before.y + totalDy
        }
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
        } else if (view.selection.kind === 'shape') {
          ;(view.obj as ShapeObject).rotation = nextRotation
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
        } else if (view.selection.kind === 'shape') {
          const sh = view.obj as ShapeObject
          if (sh.shape === 'line' || sh.shape === 'arrow') {
            // Line / arrow resize is endpoint-based, not AABB-based:
            // the dragged corner becomes the new endpoint, the
            // opposite corner stays at the anchor. This is the only
            // resize math that lets a user drag a line end PAST its
            // origin and have the line flip direction (negative w/h
            // in the transform). The AABB-based applyResize would
            // take Math.abs of the deltas and lose the direction.
            sh.transform = applyLineResize(drag.beforeRotation, drag.kind.anchorBoard, {
              x: bx,
              y: by,
            })
          } else {
            // Rect / ellipse — AABB-based resize like images, but
            // with no natural aspect (shift = preserve drag-start
            // aspect) and minSide=1 so very thin rects don't get
            // clamped up.
            const beforeAspect = drag.before.h !== 0 ? drag.before.w / drag.before.h : 1
            sh.transform = applyResize(
              drag.before,
              drag.beforeRotation,
              drag.kind.resize,
              drag.kind.anchorBoard,
              { x: bx, y: by },
              beforeAspect,
              e.shiftKey,
              1,
            )
          }
        } else {
          const t = view.obj as TextObject
          if (drag.beforeFontSize !== null && drag.beforeTextSnapshot !== null) {
            const handle = drag.kind.resize
            const isHorizontalEdge = handle === 'e' || handle === 'w'
            if (isHorizontalEdge) {
              // Horizontal edge drag on a text → adjust `wrapWidth`. The
              // wrap width is the LOCAL-x projection of (pointer -
              // opposite-edge anchor); content wraps to fit, height
              // grows naturally. Floor at a sensible minimum so the
              // user can't shrink wrap below readability.
              const cos = Math.cos(drag.beforeRotation)
              const sin = Math.sin(drag.beforeRotation)
              const vx = bx - drag.kind.anchorBoard.x
              const vy = by - drag.kind.anchorBoard.y
              const localXDelta = vx * cos + vy * sin
              const MIN_WRAP_WIDTH = 40
              const newWrapWidth = Math.max(
                MIN_WRAP_WIDTH,
                Math.abs(localXDelta) - 2 * TEXT_PADDING_X,
              )
              t.wrapWidth = newWrapWidth
              // Re-fit to refresh the rect from the new wrapped content.
              const fitted = resizeToFit(t)
              t.transform = fitted.transform
              // Anchor-preserve the W-edge or E-edge: reposition so the
              // OPPOSITE edge stays pinned in board space.
              // The handle direction sign in local coords:
              const sx = handle === 'e' ? +1 : -1
              const halfX = (sx * t.transform.w) / 2
              const halfY = 0 // edge handles only move along their axis
              const centerX = drag.kind.anchorBoard.x + halfX * cos - halfY * sin
              const centerY = drag.kind.anchorBoard.y + halfX * sin + halfY * cos
              t.transform.x = centerX - t.transform.w / 2
              t.transform.y = centerY - t.transform.h / 2
            } else {
              // Corner drag → font-size scaling (existing path).
              const next = applyTextResize(
                drag.before,
                drag.beforeFontSize,
                drag.beforeTextSnapshot,
                drag.beforeRotation,
                handle,
                drag.kind.anchorBoard,
                { x: bx, y: by },
              )
              t.font = { ...drag.beforeTextSnapshot.font, size: next.newSize }
              t.transform = next.newTransform
              // applyTextResize refits a TEMP object internally, so the
              // shared invalidate-inside-resizeToFit never sees `t` —
              // drop `t`'s cached measurement here or the live drag
              // renders the pre-drag font size all the way through.
              invalidateTextMeasurement(t)
            }
          }
        }
      }

      // Live-render mutates in-memory state; persistence is committed once
      // per completed drag in commitDrag/commitMultiDrag.
      ctx.markCommittedDirty()
    },

    onPointerUp(e, ctx): void {
      // Marquee finalize: pick hit objects (or clear if it was a tap).
      if (activeDrag?.kind === 'marquee') {
        const m = activeDrag.state
        activeDrag = null
        ;(e.target as Element | null)?.releasePointerCapture?.(e.pointerId)
        if (m.live) {
          finalizeMarquee(m)
        } else {
          // Pointer-down + immediate release on empty space = click
          // intent → deselect. Route through setSelection so the
          // onSelectionChange hook (which the pinned tool menu uses
          // to drop the prior selection's contextual section) fires.
          // Shift+tap keeps the selection: Shift means "extend, don't
          // replace" everywhere else in this tool (shift+click toggles,
          // shift+marquee unions), so an additive tap that hit nothing
          // must be a no-op, not a wipe.
          if (!m.additive && selected.length > 0) setSelection([])
        }
        ctx.markCommittedDirty()
        return
      }
      commitDrag(e)
      ctx.markCommittedDirty()
    },

    redraw(ctx): void {
      clearLayer(ctx.liveLayer)

      // Live marquee rect — painted regardless of selection state so
      // the user sees the drag-rectangle even on an empty board.
      if (activeDrag?.kind === 'marquee' && activeDrag.state.live) {
        drawMarquee(activeDrag.state, ctx)
      }

      if (selected.length === 0) return

      // Single-selection (the common case): full transform UI on the
      // one selected object — handles, rotation, outline.
      const view = getView()
      if (view) {
        if (view.selection.kind === 'stroke') {
          drawStrokeSelection(view, ctx)
        } else {
          drawFloatingObjectSelection(view, ctx)
        }
        return
      }

      // Multi-selection (Cmd+A, future marquee). Paint a halo per
      // selected stroke here on the live layer. Images / texts get
      // their multi-selection outline via the renderer predicate in
      // main.ts (renderImages / renderTexts), which avoids re-walking
      // the image bytes here. No per-object handles in multi —
      // transform UI is single-only.
      const accent = resolveAccent(ctx.liveLayer.ctx)
      applyCamera(ctx.liveLayer, ctx.camera, ctx.dpr)
      const c = ctx.liveLayer.ctx
      const scale = ctx.camera.scale
      c.save()
      c.strokeStyle = accent
      c.lineWidth = 3 / scale
      c.lineJoin = 'round'
      c.lineCap = 'round'
      for (const sel of selected) {
        if (sel.kind !== 'stroke') continue
        const stroke = deps.getStrokes().find((x) => x.id === sel.id)
        if (!stroke || stroke.deleted) continue
        const path = getStrokePath(stroke, [], true)
        if (path) c.stroke(path)
      }
      c.restore()
    },

    renderContextualMenu(host, dismiss, rebuild, anchor): void {
      // Right-click contextual menu — content depends on what's selected.
      // Text gets the rich Color / Font / Size / B / I / U menu. Shape
      // gets a compact Color / Stroke width / Fill toggle (mirrors the
      // Shape tool's own menu so style edits work in either mode).
      // Image-selection / stroke-selection / no-selection fall through
      // to the static TOOL / VIEW / EXPORT rows that toolmenu.ts adds
      // outside this hook.
      //
      // This method is the dispatcher: it resolves the selection to a
      // live object, then delegates the DOM construction to the pure
      // builders in ./select/menu.ts, injecting the tool internals they
      // need (drag commit, persistence, op push) as explicit deps.
      const sel = singleSelection()

      if (sel?.kind === 'shape') {
        const sh = deps.getShapes().find((x) => x.id === sel.id)
        if (!sh || sh.deleted) return
        renderShapeContextualMenu(
          host,
          sh,
          {
            commitActiveDrag: () => commitDrag(null),
            saveShape: (s) => deps.saveShape(s),
            pushOp: (op) => deps.pushOp(op),
            markCommittedDirty: () => deps.markCommittedDirty(),
          },
          dismiss,
          rebuild,
          anchor,
        )
        return
      }

      if (!sel || sel.kind !== 'text') return
      const t = deps.getTexts().find((x) => x.id === sel.id)
      if (!t || t.deleted) return
      renderTextContextualMenu(
        host,
        t,
        {
          commitActiveDrag: () => commitDrag(null),
          saveText: (x) => deps.saveText(x),
          pushOp: (op) => deps.pushOp(op),
          markCommittedDirty: () => deps.markCommittedDirty(),
        },
        dismiss,
        rebuild,
        anchor,
      )
    },

    cleanup(): void {
      // Commit any in-flight drag (single or multi) BEFORE clearing
      // state so the op(s) land in the undo stack. Without this, a
      // tool-switch (or OS gesture-steal) mid-drag silently dropped the
      // move/transform/rotate ops — the objects were mutated and
      // persisted per-tick but never recorded in undo. commitDrag is a
      // no-op when activeDrag is null, so this is safe on every
      // cleanup call.
      commitDrag(null)
      setSelection([])
      // commitDrag clears activeDrag for single/multi modes. The
      // marquee branch also clears it. This re-null is defensive in
      // case a future commitDrag path forgets — cheap insurance.
      activeDrag = null
    },

    getSelectedImage(): ImageObject | null {
      // Backward-compat narrow accessor: returns the selected image only
      // when EXACTLY ONE image is selected. main.ts uses this for the
      // image-clipboard copy/cut paths (which only handle a single image
      // at v1.2). Multi-selection clipboard will route through the
      // multi-aware path added in Phase B5.
      const sel = singleSelection()
      if (!sel || sel.kind !== 'image') return null
      const img = deps.getImages().find((i) => i.id === sel.id)
      if (!img || img.deleted) return null
      return img
    },

    getSelected(): Selection | null {
      return singleSelection()
    },

    getSelections(): readonly Selection[] {
      return selected
    },

    selectImageById(id: string): void {
      selectSingleById({ kind: 'image', id })
    },

    selectTextById(id: string): void {
      selectSingleById({ kind: 'text', id })
    },

    selectStrokeById(id: string): void {
      selectSingleById({ kind: 'stroke', id })
    },

    selectShapeById(id: string): void {
      selectSingleById({ kind: 'shape', id })
    },

    selectAll(): void {
      // Commit any pending drag before replacing selection wholesale.
      commitDrag(null)
      const next: Selection[] = []
      // Order: strokes → images → texts → shapes (matches the render
      // z-order composite, gives a stable order callers can rely on).
      for (const s of deps.getStrokes()) {
        if (!s.deleted) next.push({ kind: 'stroke', id: s.id })
      }
      for (const img of deps.getImages()) {
        if (!img.deleted) next.push({ kind: 'image', id: img.id })
      }
      for (const t of deps.getTexts()) {
        if (!t.deleted) next.push({ kind: 'text', id: t.id })
      }
      for (const sh of deps.getShapes()) {
        if (!sh.deleted) next.push({ kind: 'shape', id: sh.id })
      }
      setSelection(next)
      activeDrag = null
      deps.markCommittedDirty()
    },

    selectByIds(items: readonly Selection[]): void {
      commitDrag(null)
      const next: Selection[] = []
      for (const item of items) {
        if (behaviorFor(item.kind).resolve(deps, item.id)) next.push(item)
      }
      setSelection(next)
      activeDrag = null
      deps.markCommittedDirty()
    },

    clearSelection(): void {
      // Bail if there's truly nothing to clear (no selection, no
      // active drag/marquee). Otherwise commit any in-flight drag and
      // abort everything — including a live marquee, so Esc-mid-
      // marquee cancels the gesture before it can finalize on the
      // next pointer-up.
      if (selected.length === 0 && !activeDrag) return
      commitDrag(null)
      setSelection([])
      activeDrag = null
      deps.markCommittedDirty()
    },

    hasPendingMarquee(): boolean {
      return activeDrag?.kind === 'marquee'
    },

    deleteSelected(): boolean {
      if (selected.length === 0) return false
      // Commit any in-flight drag BEFORE deleting so its op lands in
      // undo. Without this, a Delete key fired while a move-drag is
      // still capturing the pointer (two-device path, or keyboard
      // shortcut during a touch drag) would leave `drag` non-null
      // pointing at a now-deleted object; the next pointer-up's
      // commitDrag then no-ops because the object is gone — the
      // move op silently drops. Matches the pattern selectAll /
      // selectByIds / clearSelection already use.
      commitDrag(null)
      // Accumulate live ids per kind and emit ONE composite `delete-many`
      // op for the whole selection — one Cmd+Z restores the group
      // (mirrors `commitMultiDrag`'s single `transform-many`). Single-
      // selection takes the same path with N=1. The mutation surface
      // stays `applyOp(op); pushOp(op)` (canonical pattern shared with
      // `erasercallbacks.ts`); per-object persistence fires inside
      // applyOp via the per-kind save callbacks, exactly as the earlier
      // per-kind ops did.
      //
      // Guards: already-deleted / missing objects are skipped (a delete
      // key racing external state must not flip them back on undo), and
      // `seen` drops duplicate selection entries so each object's save
      // callback fires at most once.
      const ids: DeleteManyIds = { imageIds: [], textIds: [], shapeIds: [], strokeIds: [] }
      const seen = new Set<string>()
      for (const sel of selected) {
        if (seen.has(sel.id)) continue
        seen.add(sel.id)
        const b = behaviorFor(sel.kind)
        if (b.resolve(deps, sel.id)) b.collectDeleteId(ids, sel.id)
      }
      const didDelete =
        ids.imageIds.length + ids.textIds.length + ids.shapeIds.length + ids.strokeIds.length > 0
      if (didDelete) {
        const op: Op = { kind: 'delete-many', ...ids }
        deps.applyOp(op)
        deps.pushOp(op)
      }
      setSelection([])
      deps.markCommittedDirty()
      return didDelete
    },
    adjustSelectedTextFontSize(delta: number): boolean {
      const sel = singleSelection()
      if (!sel || sel.kind !== 'text') return false
      const t = deps.getTexts().find((x) => x.id === sel.id)
      if (!t || t.deleted) return false
      const MIN_SIZE = 6
      const MAX_SIZE = 200
      const nextSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, t.font.size + delta))
      if (nextSize === t.font.size) return false
      // Snapshot before mutating so the edit-text op gets accurate
      // before/after payloads. Same pattern as the contextual-menu
      // size pills: mutate font + re-fit transform + persist + push op.
      const before = {
        content: t.content,
        font: { ...t.font },
        color: t.color,
        wrapWidth: t.wrapWidth,
      }
      t.font = { ...t.font, size: nextSize }
      const fitted = resizeToFit(t)
      t.transform = fitted.transform
      deps.saveText(t)
      const after = {
        content: t.content,
        font: { ...t.font },
        color: t.color,
        wrapWidth: t.wrapWidth,
      }
      deps.pushOp({ kind: 'edit-text', textId: t.id, before, after })
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
