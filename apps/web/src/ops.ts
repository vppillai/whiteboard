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

import type { Stroke } from '@whiteboard/shared'
import { addErasedStamps, invalidateStrokeBBox, removeErasedStamps } from './stroke'

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

export interface OpContext {
  /** All strokes (including soft-deleted ones). Mutated in place by ops. */
  strokes: Stroke[]
  /** Persist a single stroke. Called once per mutated stroke. */
  saveStroke: (s: Stroke) => void
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
