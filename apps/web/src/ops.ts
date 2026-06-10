/**
 * Operation-based undo. Replaces the per-stroke redo stack from M0 with a
 * uniform `Op` type that supports the operations M1+ needs (eraser delete,
 * eraser pixel-stamp, lasso move) without growing the undo logic.
 *
 * Conventions:
 *
 *   - Strokes are never removed from the in-memory array or IndexedDB;
 *     instead, `deleted: true` is set (whole-stroke removal — object-mode
 *     eraser, lasso-delete) or stamps are added to `erasedStamps`
 *     (segment-mode eraser, ADR 0009). Undo flips the flag or removes the
 *     same stamps — both cheap, both CRDT-friendly.
 *   - Operations identify strokes by id, not by reference. The strokes
 *     array is the single source of truth.
 *   - Persistence is fire-and-forget at apply / unapply time. The caller's
 *     `saveStroke` is expected to handle errors however it likes.
 *
 * Clear-board is *not* an Op (it's a destructive boundary by design — see
 * SPEC § 4.3 and the clearflow module). The undo / redo stacks are reset
 * when the user confirms a clear.
 */

import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import { addErasedStamps, invalidateStrokeBBox, removeErasedStamps } from './stroke'
import { invalidateTextMeasurement, resizeToFit as resizeTextRect } from './textgeom'

export interface StampEdit {
  strokeId: string
  /** Cursor disks added to the stroke's `erasedStamps` by this op. `unapply`
   *  removes the same `(x, y, r)` triples. */
  addedStamps: { x: number; y: number; r: number }[]
}

export type Op =
  | { kind: 'create'; strokeId: string }
  | { kind: 'delete'; strokeIds: string[] }
  | { kind: 'delete-many'; imageIds: string[]; textIds: string[]; shapeIds: string[] }
  | { kind: 'move'; strokeIds: string[]; dx: number; dy: number }
  | { kind: 'eraseStamps'; edits: StampEdit[] }
  /**
   * Paste an image. Mirrors stroke 'create': the paste handler has already
   * inserted the ImageObject + Blob into IDB and added the metadata record
   * to `ctx.images` with `deleted: false`. Apply (= redo) flips deleted back
   * to false; unapply (= undo) sets deleted=true. Bytes stay in IDB across
   * undo cycles so redo is cheap.
   */
  | { kind: 'paste-image'; imageId: string }
  /**
   * Soft-delete a pasted image. Symmetric to 'paste-image' — the act-now
   * handler has already set deleted=true on the in-memory record and
   * persisted; the op just gives undo a hook.
   */
  | { kind: 'delete-image'; imageId: string }
  /**
   * Move or resize an image: swap the transform rect. Move + resize are
   * the same op kind because both ultimately overwrite the transform.
   * Coalesced at drag-end (one op per drag, not per pointermove tick).
   */
  | {
      kind: 'transform-image'
      imageId: string
      before: ImageObject['transform']
      after: ImageObject['transform']
    }
  /**
   * Rotate an image in place. Stored as before/after radians so undo /
   * redo can swap without recomputing. Coalesced at drag-end like
   * transform-image — one op per rotation drag.
   */
  | {
      kind: 'rotate-image'
      imageId: string
      before: number
      after: number
    }
  /**
   * Create a text object. Mirrors 'paste-image': by the time the op is
   * pushed the text record is already in `ctx.texts` with deleted=false
   * and persisted via TextStore. Apply (=redo) flips deleted→false;
   * unapply (=undo) flips deleted→true. The text bytes stay in IDB
   * across undo cycles so redo is cheap.
   */
  | { kind: 'create-text'; textId: string }
  /** Soft-delete a text. Symmetric to 'create-text'. */
  | { kind: 'delete-text'; textId: string }
  /**
   * Move or resize a text rect: swap the transform. Resize for text
   * happens implicitly on every edit (auto-fit to measured content),
   * which is its own 'edit-text' op — explicit `transform-text` is the
   * pure-move flow only. Coalesced at drag-end.
   */
  | {
      kind: 'transform-text'
      textId: string
      before: TextObject['transform']
      after: TextObject['transform']
    }
  /**
   * Edit a text's content / font / color / wrapWidth in one undoable
   * step. Coalesced across the whole edit session (typing N keys +
   * B/I/U toggles + font change + E/W edge drag collapses to a single
   * op pushed when edit mode exits). Stores the full before/after
   * payload because individual field deltas would multiply op kinds —
   * the payload is small (string + a few fields) so the simplicity is
   * worth the bytes. `wrapWidth` may be `undefined` (auto-width) or
   * a positive number; both round-trip through undo correctly.
   */
  | {
      kind: 'edit-text'
      textId: string
      before: {
        content: string
        font: TextObject['font']
        color: string
        wrapWidth: number | undefined
      }
      after: {
        content: string
        font: TextObject['font']
        color: string
        wrapWidth: number | undefined
      }
    }
  /**
   * Rotate a text in place. Symmetric with rotate-image — stores
   * before/after radians so undo / redo swap without recomputation.
   * v1.2: emitted by the Select tool when the rotation handle is
   * dragged on a selected text (text move-only previously).
   */
  | {
      kind: 'rotate-text'
      textId: string
      before: number
      after: number
    }
  /**
   * Create a shape (rect / ellipse / line / arrow). Mirrors
   * `create-text` / `paste-image`: by the time the op is pushed the
   * ShapeObject is already in `ctx.shapes` with `deleted=false` and
   * persisted via ShapeStore. Apply (= redo) flips `deleted` to
   * false; unapply (= undo) flips it to true. The shape stays in
   * IDB across undo cycles so redo is cheap.
   */
  | { kind: 'create-shape'; shapeId: string }
  /** Soft-delete a shape. Symmetric to `create-shape`. */
  | { kind: 'delete-shape'; shapeId: string }
  /**
   * Move or resize a shape: swap the transform rect. Move + resize
   * (both corner-drag and edge-drag) end up overwriting the same
   * `transform` field, so a single op kind covers both. Coalesced
   * at drag-end (one op per drag, not per pointermove tick). For
   * line / arrow kinds the transform's w/h encode the from→to
   * delta so the same op covers all four kinds uniformly.
   */
  | {
      kind: 'transform-shape'
      shapeId: string
      before: ShapeObject['transform']
      after: ShapeObject['transform']
    }
  /**
   * Rotate a shape in place. Symmetric with `rotate-image` /
   * `rotate-text` — stores before/after radians so undo / redo
   * swap without recomputation.
   */
  | {
      kind: 'rotate-shape'
      shapeId: string
      before: number
      after: number
    }
  /**
   * Edit a shape's style fields (color / strokeWidth / fill) in
   * one undoable step. Coalesced at the contextual-menu interaction
   * scope. Stores the full before/after payload because individual
   * field deltas would multiply op kinds — the payload is small
   * so simplicity wins. `fill` may be `undefined` (outline-only) or a
   * color token; both round-trip cleanly. `fillOpacity` may be
   * `undefined` (renderer applies its default alpha) or a number in
   * [0.05, 1.0]. Carrying it on the op is what makes the fill-opacity
   * slider in the Select-tool's shape menu fully undoable.
   */
  | {
      kind: 'edit-shape'
      shapeId: string
      before: {
        color: string
        strokeWidth: number
        fill: string | undefined
        fillOpacity: number | undefined
      }
      after: {
        color: string
        strokeWidth: number
        fill: string | undefined
        fillOpacity: number | undefined
      }
    }
  /**
   * Composite multi-object move: a single op carrying transforms for
   * every item displaced by one multi-drag gesture. Each item is one of
   * the three existing per-kind move shapes (transform-image,
   * transform-text, or per-stroke samples translation). The op exists
   * to coalesce what would otherwise be N separate per-item ops into a
   * single undo step and — critically for M3 sync — a single transaction
   * + a single wire message on N peers. Without this, a 30-object
   * multi-drag on a 16-peer board produces 480 update messages.
   *
   * Local-only behavior is also better: one Cmd+Z reverses the whole
   * group move instead of unwinding 30 separate per-item ops.
   *
   * Items are stored as a discriminated union so apply / unapply can
   * dispatch per kind without re-resolving the object kind from a
   * separate lookup.
   *
   * Resize / rotation are intentionally NOT batched into this op —
   * they're single-object operations even in multi-selection mode (see
   * Phase B4 of the Lasso → Select absorption, ADR 0016). When / if
   * multi-rotate lands, a parallel `rotate-many` op kind is the natural
   * shape; the same pattern from this op extends cleanly.
   */
  | {
      kind: 'transform-many'
      items: TransformManyItem[]
    }

/** One entry in a `transform-many` op's `items` array. Per-kind
 *  before/after payload mirrors the existing per-item op shapes:
 *    - image / text / shape: rect transform
 *    - stroke: dx/dy delta (matches `move` op's semantics — symmetric
 *      apply/unapply translate samples by ±(dx,dy)). */
export type TransformManyItem =
  | {
      kind: 'image'
      imageId: string
      before: ImageObject['transform']
      after: ImageObject['transform']
    }
  | {
      kind: 'text'
      textId: string
      before: TextObject['transform']
      after: TextObject['transform']
    }
  | {
      kind: 'shape'
      shapeId: string
      before: ShapeObject['transform']
      after: ShapeObject['transform']
    }
  | {
      kind: 'stroke'
      strokeId: string
      dx: number
      dy: number
    }

export interface OpContext {
  /** All strokes (including soft-deleted ones). Mutated in place by ops. */
  strokes: Stroke[]
  /** Persist a single stroke. Called once per mutated stroke. */
  saveStroke: (s: Stroke) => void
  /** All images (including soft-deleted ones). Mutated in place by image ops. */
  images: ImageObject[]
  /** Persist a single image's metadata (transform / deleted flag changes).
   *  Bytes do not change after the initial paste, so this is the metadata-only
   *  fast path, not the binary-carrying saveImage from storage.ts. */
  saveImageMeta: (img: ImageObject) => void
  /** All texts (including soft-deleted ones). Mutated in place by text ops. */
  texts: TextObject[]
  /** Persist a single text record. */
  saveText: (t: TextObject) => void
  /** All shapes (including soft-deleted ones). Mutated in place by shape ops. */
  shapes: ShapeObject[]
  /** Persist a single shape record. */
  saveShape: (s: ShapeObject) => void
  /** Mark the committed canvas dirty for the next render. */
  markDirty: () => void
}

/** Applies the op (or re-applies it on redo). */
export function applyOp(op: Op, ctx: OpContext): void {
  switch (op.kind) {
    case 'create':
      flipStrokesDeleted(ctx, [op.strokeId], false)
      break
    case 'delete':
      flipStrokesDeleted(ctx, op.strokeIds, true)
      break
    case 'delete-many':
      for (const id of op.imageIds) flipImageDeleted(ctx, id, true)
      for (const id of op.textIds) flipTextDeleted(ctx, id, true)
      for (const id of op.shapeIds) flipShapeDeleted(ctx, id, true)
      break
    case 'move':
      translateStrokes(ctx, op.strokeIds, op.dx, op.dy)
      break
    case 'eraseStamps':
      applyStampEdits(ctx, op.edits, true)
      break
    case 'paste-image':
      flipImageDeleted(ctx, op.imageId, false)
      break
    case 'delete-image':
      flipImageDeleted(ctx, op.imageId, true)
      break
    case 'transform-image':
      setImageTransform(ctx, op.imageId, op.after)
      break
    case 'rotate-image':
      setImageRotation(ctx, op.imageId, op.after)
      break
    case 'create-text':
      flipTextDeleted(ctx, op.textId, false)
      break
    case 'delete-text':
      flipTextDeleted(ctx, op.textId, true)
      break
    case 'transform-text':
      setTextTransform(ctx, op.textId, op.after)
      break
    case 'edit-text':
      setTextEdit(ctx, op.textId, op.after)
      break
    case 'rotate-text':
      setTextRotation(ctx, op.textId, op.after)
      break
    case 'create-shape':
      flipShapeDeleted(ctx, op.shapeId, false)
      break
    case 'delete-shape':
      flipShapeDeleted(ctx, op.shapeId, true)
      break
    case 'transform-shape':
      setShapeTransform(ctx, op.shapeId, op.after)
      break
    case 'rotate-shape':
      setShapeRotation(ctx, op.shapeId, op.after)
      break
    case 'edit-shape':
      setShapeEdit(ctx, op.shapeId, op.after)
      break
    case 'transform-many':
      applyTransformMany(ctx, op.items, false)
      break
  }
  ctx.markDirty()
}

/** Reverses the op (undo). */
export function unapplyOp(op: Op, ctx: OpContext): void {
  switch (op.kind) {
    case 'create':
      flipStrokesDeleted(ctx, [op.strokeId], true)
      break
    case 'delete':
      flipStrokesDeleted(ctx, op.strokeIds, false)
      break
    case 'delete-many':
      for (const id of op.imageIds) flipImageDeleted(ctx, id, false)
      for (const id of op.textIds) flipTextDeleted(ctx, id, false)
      for (const id of op.shapeIds) flipShapeDeleted(ctx, id, false)
      break
    case 'move':
      translateStrokes(ctx, op.strokeIds, -op.dx, -op.dy)
      break
    case 'eraseStamps':
      applyStampEdits(ctx, op.edits, false)
      break
    case 'paste-image':
      flipImageDeleted(ctx, op.imageId, true)
      break
    case 'delete-image':
      flipImageDeleted(ctx, op.imageId, false)
      break
    case 'transform-image':
      setImageTransform(ctx, op.imageId, op.before)
      break
    case 'rotate-image':
      setImageRotation(ctx, op.imageId, op.before)
      break
    case 'create-text':
      flipTextDeleted(ctx, op.textId, true)
      break
    case 'delete-text':
      flipTextDeleted(ctx, op.textId, false)
      break
    case 'transform-text':
      setTextTransform(ctx, op.textId, op.before)
      break
    case 'edit-text':
      setTextEdit(ctx, op.textId, op.before)
      break
    case 'rotate-text':
      setTextRotation(ctx, op.textId, op.before)
      break
    case 'create-shape':
      flipShapeDeleted(ctx, op.shapeId, true)
      break
    case 'delete-shape':
      flipShapeDeleted(ctx, op.shapeId, false)
      break
    case 'transform-shape':
      setShapeTransform(ctx, op.shapeId, op.before)
      break
    case 'rotate-shape':
      setShapeRotation(ctx, op.shapeId, op.before)
      break
    case 'edit-shape':
      setShapeEdit(ctx, op.shapeId, op.before)
      break
    case 'transform-many':
      applyTransformMany(ctx, op.items, true)
      break
  }
  ctx.markDirty()
}

/** Apply or unapply a `transform-many` op. `unapply=true` swaps the
 *  before/after roles per item, mirroring the convention every other
 *  symmetric op (transform-image / transform-text / move / rotate-*)
 *  uses. */
function applyTransformMany(
  ctx: OpContext,
  items: readonly TransformManyItem[],
  unapply: boolean,
): void {
  for (const item of items) {
    if (item.kind === 'image') {
      setImageTransform(ctx, item.imageId, unapply ? item.before : item.after)
    } else if (item.kind === 'text') {
      setTextTransform(ctx, item.textId, unapply ? item.before : item.after)
    } else if (item.kind === 'shape') {
      setShapeTransform(ctx, item.shapeId, unapply ? item.before : item.after)
    } else {
      const dx = unapply ? -item.dx : item.dx
      const dy = unapply ? -item.dy : item.dy
      translateStrokes(ctx, [item.strokeId], dx, dy)
    }
  }
}

/**
 * Generic soft-delete flip for any board-resident object kind. The three
 * earlier per-kind helpers (`flipDeleted` for strokes, `flipImageDeleted`,
 * `flipTextDeleted`) were 5-line copies of this same pattern — a 4th
 * object kind (shapes / sticky notes) would have added a 4th copy and a
 * 4th place that could drift on the `deleted || undefined` invariant.
 *
 * `deleted || undefined` is intentional: it stores `true` for deleted
 * and `undefined` (omitted on serialization) for live, keeping persisted
 * records compact and backward-compatible with rotation-less / delete-
 * less records.
 */
function flipDeletedOn<T extends { id: string; deleted?: boolean }>(
  arr: readonly T[],
  id: string,
  deleted: boolean,
  save: (obj: T) => void,
): void {
  const obj = arr.find((x) => x.id === id)
  if (!obj) return
  obj.deleted = deleted || undefined
  save(obj)
}

function flipStrokesDeleted(ctx: OpContext, ids: readonly string[], deleted: boolean): void {
  for (const id of ids) flipDeletedOn(ctx.strokes, id, deleted, ctx.saveStroke)
}

function translateStrokes(ctx: OpContext, ids: readonly string[], dx: number, dy: number): void {
  for (const id of ids) {
    const stroke = ctx.strokes.find((s) => s.id === id)
    if (!stroke) continue
    for (const sample of stroke.samples) {
      sample.x += dx
      sample.y += dy
    }
    // Erased pixels live at absolute board coords — translate alongside the
    // stroke they belong to so a partly-erased stroke keeps its holes in
    // the right place after a move.
    if (stroke.erasedStamps) {
      for (const stamp of stroke.erasedStamps) {
        stamp.x += dx
        stamp.y += dy
      }
    }
    invalidateStrokeBBox(stroke)
    ctx.saveStroke(stroke)
  }
}

function applyStampEdits(ctx: OpContext, edits: readonly StampEdit[], add: boolean): void {
  for (const edit of edits) {
    const stroke = ctx.strokes.find((s) => s.id === edit.strokeId)
    if (!stroke) continue
    if (add) addErasedStamps(stroke, edit.addedStamps)
    else removeErasedStamps(stroke, edit.addedStamps)
    ctx.saveStroke(stroke)
  }
}

function flipImageDeleted(ctx: OpContext, id: string, deleted: boolean): void {
  flipDeletedOn(ctx.images, id, deleted, ctx.saveImageMeta)
}

function setImageTransform(ctx: OpContext, id: string, transform: ImageObject['transform']): void {
  const img = ctx.images.find((i) => i.id === id)
  if (!img) return
  img.transform = { ...transform }
  ctx.saveImageMeta(img)
}

function setImageRotation(ctx: OpContext, id: string, rotation: number): void {
  const img = ctx.images.find((i) => i.id === id)
  if (!img) return
  // Store `undefined` for exactly-zero so persisted records stay compact
  // and back-compat with rotation-less records. Deliberately NOT
  // `rotation || undefined`: that would also map NaN to `undefined`,
  // silently masking a corrupted rotation as "no rotation".
  img.rotation = rotation === 0 ? undefined : rotation
  ctx.saveImageMeta(img)
}

function flipTextDeleted(ctx: OpContext, id: string, deleted: boolean): void {
  flipDeletedOn(ctx.texts, id, deleted, ctx.saveText)
}

function setTextTransform(ctx: OpContext, id: string, transform: TextObject['transform']): void {
  const t = ctx.texts.find((x) => x.id === id)
  if (!t) return
  t.transform = { ...transform }
  ctx.saveText(t)
}

/** Apply an edit-text op's payload to the matching text. Recomputes the
 *  transform.w/h via measureText so the rect always matches content +
 *  wrapWidth; the op stores only the content / font / color / wrapWidth,
 *  not the derived size. wrapWidth is restored explicitly so an edge-
 *  handle drag's undo correctly puts the wrap layout back. */
function setTextEdit(
  ctx: OpContext,
  id: string,
  payload: {
    content: string
    font: TextObject['font']
    color: string
    wrapWidth: number | undefined
  },
): void {
  const t = ctx.texts.find((x) => x.id === id)
  if (!t) return
  t.content = payload.content
  t.font = { ...payload.font }
  t.color = payload.color
  t.wrapWidth = payload.wrapWidth
  // Drop the per-text measurement cache before re-fitting; the cache is
  // keyed by TextObject identity and the new payload changes the inputs
  // (content / font / wrapWidth) the cached measurement was derived from.
  invalidateTextMeasurement(t)
  // Re-fit the rect to the new content + font + wrapWidth so move/
  // resize stay in sync with edit. `resizeTextRect` measures via a
  // detached canvas and falls back to a heuristic when no DOM is
  // present (e.g. bun:test).
  const measured = resizeTextRect(t)
  t.transform = measured.transform
  ctx.saveText(t)
}

function setTextRotation(ctx: OpContext, id: string, rotation: number): void {
  const t = ctx.texts.find((x) => x.id === id)
  if (!t) return
  // Symmetric with setImageRotation: store `undefined` for the zero case
  // so persisted records don't carry an explicit `rotation: 0` field
  // (cheaper schema; backward-compat with rotation-less records).
  // `=== 0` (not `||`) so NaN isn't silently masked as "no rotation".
  t.rotation = rotation === 0 ? undefined : rotation
  ctx.saveText(t)
}
function flipShapeDeleted(ctx: OpContext, id: string, deleted: boolean): void {
  flipDeletedOn(ctx.shapes, id, deleted, ctx.saveShape)
}

function setShapeTransform(ctx: OpContext, id: string, transform: ShapeObject['transform']): void {
  const s = ctx.shapes.find((x) => x.id === id)
  if (!s) return
  s.transform = { ...transform }
  ctx.saveShape(s)
}

function setShapeRotation(ctx: OpContext, id: string, rotation: number): void {
  const s = ctx.shapes.find((x) => x.id === id)
  if (!s) return
  // Symmetric with setImageRotation / setTextRotation: store `undefined`
  // for the zero case so persisted records stay compact and back-compat
  // with rotation-less records.
  // `=== 0` (not `||`) so NaN isn't silently masked as "no rotation".
  s.rotation = rotation === 0 ? undefined : rotation
  ctx.saveShape(s)
}

/** Apply an edit-shape op's payload (color / strokeWidth / fill /
 *  fillOpacity) to the matching shape. Mirrors `setTextEdit` — stores
 *  the full payload because the field count is small and field-deltas
 *  would multiply op kinds. */
function setShapeEdit(
  ctx: OpContext,
  id: string,
  payload: {
    color: string
    strokeWidth: number
    fill: string | undefined
    fillOpacity: number | undefined
  },
): void {
  const s = ctx.shapes.find((x) => x.id === id)
  if (!s) return
  s.color = payload.color
  s.strokeWidth = payload.strokeWidth
  s.fill = payload.fill
  s.fillOpacity = payload.fillOpacity
  ctx.saveShape(s)
}
