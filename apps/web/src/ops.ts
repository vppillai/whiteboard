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

import type { ImageObject, Stroke, TextObject } from '@whiteboard/shared'
import { addErasedStamps, invalidateStrokeBBox, removeErasedStamps } from './stroke'
import { resizeToFit as resizeTextRect } from './textgeom'

export interface StampEdit {
  strokeId: string
  /** Cursor disks added to the stroke's `erasedStamps` by this op. `unapply`
   *  removes the same `(x, y, r)` triples. */
  addedStamps: { x: number; y: number; r: number }[]
}

export type Op =
  | { kind: 'create'; strokeId: string }
  | { kind: 'delete'; strokeIds: string[] }
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
   * Edit a text's content / font / color in one undoable step. Coalesced
   * across the whole edit session (typing N keys + B/I/U toggles + font
   * change collapses to a single op pushed when edit mode exits). Stores
   * the full before/after object payload because individual field deltas
   * would multiply op kinds — the payload is small (string + a few
   * fields) so the simplicity is worth the bytes.
   */
  | {
      kind: 'edit-text'
      textId: string
      before: { content: string; font: TextObject['font']; color: string }
      after: { content: string; font: TextObject['font']; color: string }
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
  /** Mark the committed canvas dirty for the next render. */
  markDirty: () => void
}

/** Applies the op (or re-applies it on redo). */
export function applyOp(op: Op, ctx: OpContext): void {
  switch (op.kind) {
    case 'create':
      flipDeleted(ctx, [op.strokeId], false)
      break
    case 'delete':
      flipDeleted(ctx, op.strokeIds, true)
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
  }
  ctx.markDirty()
}

/** Reverses the op (undo). */
export function unapplyOp(op: Op, ctx: OpContext): void {
  switch (op.kind) {
    case 'create':
      flipDeleted(ctx, [op.strokeId], true)
      break
    case 'delete':
      flipDeleted(ctx, op.strokeIds, false)
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
  }
  ctx.markDirty()
}

function flipDeleted(ctx: OpContext, ids: readonly string[], deleted: boolean): void {
  for (const id of ids) {
    const stroke = ctx.strokes.find((s) => s.id === id)
    if (!stroke) continue
    stroke.deleted = deleted || undefined
    ctx.saveStroke(stroke)
  }
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
  const img = ctx.images.find((i) => i.id === id)
  if (!img) return
  img.deleted = deleted || undefined
  ctx.saveImageMeta(img)
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
  img.rotation = rotation || undefined
  ctx.saveImageMeta(img)
}

function flipTextDeleted(ctx: OpContext, id: string, deleted: boolean): void {
  const t = ctx.texts.find((x) => x.id === id)
  if (!t) return
  t.deleted = deleted || undefined
  ctx.saveText(t)
}

function setTextTransform(ctx: OpContext, id: string, transform: TextObject['transform']): void {
  const t = ctx.texts.find((x) => x.id === id)
  if (!t) return
  t.transform = { ...transform }
  ctx.saveText(t)
}

/** Apply an edit-text op's payload to the matching text. Recomputes the
 *  transform.w/h via measureText so the rect always matches content;
 *  the op stores only the content + font + color, not the derived size. */
function setTextEdit(
  ctx: OpContext,
  id: string,
  payload: { content: string; font: TextObject['font']; color: string },
): void {
  const t = ctx.texts.find((x) => x.id === id)
  if (!t) return
  t.content = payload.content
  t.font = { ...payload.font }
  t.color = payload.color
  // Re-fit the rect to the new content + font so move/resize stay in sync
  // with edit. `resizeTextRect` measures via a detached canvas and falls
  // back to a heuristic when no DOM is present (e.g. bun:test).
  const measured = resizeTextRect(t)
  t.transform = measured.transform
  ctx.saveText(t)
}
