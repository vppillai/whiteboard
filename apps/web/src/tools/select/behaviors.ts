/**
 * Per-kind object behaviors for the Select tool — the `ObjectBehavior<T>`
 * vtable that ADR 0014's migration trigger promised. With four object
 * kinds (image / text / shape / stroke), the Select tool's per-site
 * `kind === ...` dispatch had grown past the threshold where the
 * discriminated-union-with-inline-branches pattern stays readable; this
 * registry gives each kind ONE home for the operations the dispatch
 * sites actually need:
 *
 *   - `resolve`         — id → live (non-soft-deleted) object, used by
 *                         every site that fails closed on stale ids.
 *   - `viewParts`       — `{ transform, rotation }` for the single-
 *                         selection ObjectView. Rect kinds return the
 *                         LIVE transform reference; strokes derive a
 *                         fresh rect from their sample bbox.
 *   - `beginMultiDrag`  — per-item multi-move lifecycle as a closure
 *                         handle (`tick` / `commit`), so the rect kinds'
 *                         before-snapshot model and the stroke kind's
 *                         cumulative-applied-delta model coexist without
 *                         a false shared state shape.
 *   - `commitSingleDrag`— drag-end op emission (the former
 *                         `commitImageDrag` / `commitShapeDrag` /
 *                         `commitTextDrag` / `commitStrokeDrag` helpers).
 *   - `collectDeleteId` — which slot of the composite `delete-many` op
 *                         this kind's ids occupy.
 *
 * Strokes are deliberately NOT forced into the transform-shaped
 * abstraction: they have no `transform` field (position is per-sample
 * x/y), no resize / rotate semantics, and their move op is a dx/dy
 * samples translation (`move` / `transform-many`'s stroke arm). The
 * stroke behavior implements each slot faithfully in those terms — the
 * vtable's job is one dispatch point per concern, not uniformity.
 *
 * Kind-specific code that intentionally stays in select.ts: `objectAt`
 * hit-test ordering (a z-order policy, not a per-kind capability),
 * marquee hit semantics, per-kind resize math in onPointerMove (image
 * rect resize vs text font-size scaling vs shape endpoint resize), and
 * the per-kind selection paint.
 */

import type { BoardObject, ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import type { Op, TransformManyItem } from '../../ops'
import { getStrokeBBox, invalidateStrokeBBox } from '../../stroke'

/** The slice of the Select tool's deps the behaviors need: per-kind
 *  object access + persistence, and the undo-stack hook. `SelectToolDeps`
 *  in select.ts extends this with the tool-level callbacks (applyOp,
 *  markCommittedDirty, UI hooks) the behaviors never touch. */
export interface BehaviorDeps {
  /** Read-only access; the tool mutates entries' `transform` in place during drag. */
  getImages: () => ImageObject[]
  /** Persist a single image's metadata after each move-tick. */
  saveImageMeta: (img: ImageObject) => void
  /** Read-only access; same mutation pattern as images. */
  getTexts: () => TextObject[]
  /** Persist a single text after each move-tick. */
  saveText: (t: TextObject) => void
  /** Read-only access; same mutation pattern as images/texts. Shapes
   *  share the image transform model (rect + rotation), so move /
   *  resize / rotate paths reuse the image code paths almost verbatim. */
  getShapes: () => ShapeObject[]
  /** Persist a single shape after each move-tick. */
  saveShape: (s: ShapeObject) => void
  /** Read-only access. Used by the stroke hit-test path so clicking on
   *  a drawing in Select mode selects it (parallel to Lasso's tap-
   *  select). */
  getStrokes: () => Stroke[]
  /** Persist a single stroke after a move-tick / delete. The `move` op's
   *  apply/unapply semantics translate samples in place; mutation during
   *  drag is direct and saveStroke is fired per-tick, then the op is
   *  pushed (NOT applied — samples are already at the post-drag state)
   *  on drag-end. */
  saveStroke: (s: Stroke) => void
  /** Push an op into the undo stack — fired on drag-end + on delete. */
  pushOp: (op: Op) => void
}

/** Accumulator matching the composite `delete-many` op's per-kind id
 *  slots. `collectDeleteId` pushes into the slot its kind occupies. */
export interface DeleteManyIds {
  imageIds: string[]
  textIds: string[]
  shapeIds: string[]
  strokeIds: string[]
}

/** The drag-start snapshot fields `commitSingleDrag` reads. The Select
 *  tool's full DragState is structurally assignable (it carries these
 *  plus the gesture-tracking fields the behaviors don't need). */
export interface SingleDragSnapshot {
  before: BoardObject['transform']
  beforeRotation: number
  /** Snapshot of the text's full font / content / color at drag-start.
   *  Set only for text-resize drags; the text behavior's resize commit
   *  builds the `edit-text` op's `before` payload from it. */
  beforeTextSnapshot: {
    content: string
    font: TextObject['font']
    color: string
    wrapWidth: number | undefined
  } | null
  /** Cumulative board-space delta applied to a STROKE's samples during
   *  a move drag. Set only for stroke drags; the stroke behavior's
   *  commit emits a `move` op carrying the final (dx, dy). */
  strokeMoveApplied: { dx: number; dy: number } | null
}

/**
 * Per-item lifecycle of one object in a multi-move drag. Created at
 * drag-start (`beginMultiDrag`), ticked per pointermove, committed at
 * drag-end. The per-kind state (rect kinds: a `before` transform
 * snapshot; strokes: the cumulative applied delta) lives in the
 * closure, so the two state models never share a forced common shape.
 *
 * `tick` / `commit` re-resolve the live object on every call — an
 * object soft-deleted mid-drag (Cmd+A → Delete race, future remote
 * state) silently drops out, exactly as the previous inline per-kind
 * loops behaved.
 */
export interface MultiDragHandle {
  /** Apply this tick's TOTAL delta from drag start. Rect kinds re-derive
   *  transform.x/y from the before-snapshot (idempotent); strokes
   *  translate samples by the step vs the last applied total. */
  tick(totalDx: number, totalDy: number): void
  /** Guard (no net change → null) + persist + build this item's slot in
   *  the composite `transform-many` op. */
  commit(): TransformManyItem | null
}

/**
 * The vtable: what the Select tool's dispatch sites need from an object
 * kind. One implementation per selection kind, looked up via
 * `behaviorFor(sel.kind)` — adding a 5th object kind is one new entry
 * here (plus the intentionally-kind-specific sites listed in the module
 * docblock), not a branch in every interaction handler.
 */
export interface ObjectBehavior<T> {
  /** id → live object, or null when missing / soft-deleted. Every site
   *  that consumes a possibly-stale Selection fails closed through this. */
  resolve(deps: BehaviorDeps, id: string): T | null
  /** `{ transform, rotation }` for the ObjectView. Rect kinds return the
   *  LIVE transform reference (mutating it is the canonical drag path);
   *  strokes return a fresh bbox-derived rect + rotation 0. */
  viewParts(obj: T): { transform: BoardObject['transform']; rotation: number }
  /** Start this object's slot in a multi-move drag; null when the
   *  object is missing / deleted at drag-start (it's skipped). */
  beginMultiDrag(deps: BehaviorDeps, id: string): MultiDragHandle | null
  /** Drag-end op emission for a single-object drag. No-op pushes nothing
   *  (unchanged transform / rotation / zero stroke delta). Image / shape
   *  ignore `isResize` — their resize commits as a transform op, same as
   *  move. Strokes ignore both flags (move-only). */
  commitSingleDrag(
    deps: BehaviorDeps,
    snap: SingleDragSnapshot,
    obj: T,
    isRotation: boolean,
    isResize: boolean,
  ): void
  /** Push `id` into the `delete-many` slot this kind occupies. */
  collectDeleteId(ids: DeleteManyIds, id: string): void
}

/** Union of everything the Select tool can select. `behaviorFor` erases
 *  the per-kind T to this union so call sites can hold one behavior +
 *  one object without generic plumbing; the pairing is safe because both
 *  always come from the same registry lookup. */
export type SelectableObject = ImageObject | TextObject | ShapeObject | Stroke

export function _shouldPushStrokeTransformManyItem(
  stroke: { id?: string; deleted?: boolean } | undefined,
  dx: number,
  dy: number,
): boolean {
  if (dx === 0 && dy === 0) return false
  if (!stroke || stroke.deleted) return false
  return true
}

/** Translate a stroke's samples (and erasedStamps) by the STEP delta since
 *  the last applied total, then advance the `applied` tracker to the new
 *  total. Shared by the single-object stroke move (onPointerMove) and the
 *  stroke behavior's multi-drag tick — the only two byte-identical per-kind
 *  blocks in the Select tool. Step-delta (not absolute) keeps per-tick work
 *  bounded by the drag step, not the cumulative distance. No-op on a zero
 *  step. Exported underscored for unit testing; not part of the public Tool
 *  surface. */
export function _applyStrokeMoveStep(
  stroke: Stroke,
  applied: { dx: number; dy: number },
  totalDx: number,
  totalDy: number,
): void {
  const stepDx = totalDx - applied.dx
  const stepDy = totalDy - applied.dy
  if (stepDx === 0 && stepDy === 0) return
  for (const s of stroke.samples) {
    s.x += stepDx
    s.y += stepDy
  }
  if (stroke.erasedStamps) {
    for (const stamp of stroke.erasedStamps) {
      stamp.x += stepDx
      stamp.y += stepDy
    }
  }
  invalidateStrokeBBox(stroke)
  applied.dx = totalDx
  applied.dy = totalDy
}

/** Did the rect change between drag-start snapshot and current state? */
function transformChanged(
  before: BoardObject['transform'],
  after: BoardObject['transform'],
): boolean {
  return (
    before.x !== after.x || before.y !== after.y || before.w !== after.w || before.h !== after.h
  )
}

/** Shared resolve: find by id, fail closed on missing / soft-deleted. */
function resolveIn<T extends { id: string; deleted?: boolean }>(
  arr: readonly T[],
  id: string,
): T | null {
  const obj = arr.find((x) => x.id === id)
  if (!obj || obj.deleted) return null
  return obj
}

/** Multi-drag handle shared by the three rect-transform kinds: snapshot
 *  the transform at drag-start, re-derive x/y from before + total delta
 *  per tick, and commit a transform-shaped `transform-many` item when
 *  the rect actually changed. */
function rectMultiDragHandle<T extends BoardObject>(
  deps: BehaviorDeps,
  id: string,
  resolve: (deps: BehaviorDeps, id: string) => T | null,
  save: (deps: BehaviorDeps, obj: T) => void,
  makeItem: (
    id: string,
    before: BoardObject['transform'],
    after: BoardObject['transform'],
  ) => TransformManyItem,
): MultiDragHandle | null {
  const start = resolve(deps, id)
  if (!start) return null
  const before = { ...start.transform }
  return {
    tick(totalDx: number, totalDy: number): void {
      const obj = resolve(deps, id)
      if (!obj) return
      obj.transform = { ...before, x: before.x + totalDx, y: before.y + totalDy }
    },
    commit(): TransformManyItem | null {
      const obj = resolve(deps, id)
      if (!obj) return null
      const after = { ...obj.transform }
      if (!transformChanged(before, after)) return null
      save(deps, obj)
      return makeItem(id, before, after)
    },
  }
}

/** Single-drag commit shared by the rotate-and-transform kinds (image /
 *  shape, and text's non-resize paths): emit the kind's rotate op when
 *  the rotation drag actually changed the angle, else the kind's
 *  transform op when the rect changed (move AND resize both overwrite
 *  the rect, so one op kind covers both). No-op drags push nothing. */
function commitRotateOrTransform<T extends BoardObject>(
  deps: BehaviorDeps,
  snap: SingleDragSnapshot,
  obj: T,
  isRotation: boolean,
  save: (deps: BehaviorDeps, obj: T) => void,
  makeRotateOp: (id: string, before: number, after: number) => Op,
  makeTransformOp: (
    id: string,
    before: BoardObject['transform'],
    after: BoardObject['transform'],
  ) => Op,
): void {
  if (isRotation) {
    const afterR = obj.rotation ?? 0
    if (snap.beforeRotation !== afterR) {
      save(deps, obj)
      deps.pushOp(makeRotateOp(obj.id, snap.beforeRotation, afterR))
    }
    return
  }
  const after = { ...obj.transform }
  if (transformChanged(snap.before, after)) {
    save(deps, obj)
    deps.pushOp(makeTransformOp(obj.id, snap.before, after))
  }
}

const imageBehavior: ObjectBehavior<ImageObject> = {
  resolve(deps, id) {
    return resolveIn(deps.getImages(), id)
  },
  viewParts(obj) {
    return { transform: obj.transform, rotation: obj.rotation ?? 0 }
  },
  beginMultiDrag(deps, id) {
    return rectMultiDragHandle(
      deps,
      id,
      imageBehavior.resolve,
      (d, img) => d.saveImageMeta(img),
      (imageId, before, after) => ({ kind: 'image', imageId, before, after }),
    )
  },
  commitSingleDrag(deps, snap, img, isRotation) {
    commitRotateOrTransform(
      deps,
      snap,
      img,
      isRotation,
      (d, i) => d.saveImageMeta(i),
      (imageId, before, after) => ({ kind: 'rotate-image', imageId, before, after }),
      (imageId, before, after) => ({ kind: 'transform-image', imageId, before, after }),
    )
  },
  collectDeleteId(ids, id) {
    ids.imageIds.push(id)
  },
}

const textBehavior: ObjectBehavior<TextObject> = {
  resolve(deps, id) {
    return resolveIn(deps.getTexts(), id)
  },
  viewParts(obj) {
    return { transform: obj.transform, rotation: obj.rotation ?? 0 }
  },
  beginMultiDrag(deps, id) {
    return rectMultiDragHandle(
      deps,
      id,
      textBehavior.resolve,
      (d, t) => d.saveText(t),
      (textId, before, after) => ({ kind: 'text', textId, before, after }),
    )
  },
  /** Text drag commit covers three op shapes: rotate-text (rotation
   *  handle), edit-text (resize — corner drag scales font.size, E/W
   *  edge drag mutates wrapWidth; both are font/wrap payload changes,
   *  so the persistence model is an edit, not a transform), and
   *  transform-text (plain move). The resize change-predicate includes
   *  wrapWidth so the E/W drag's undo correctly restores the
   *  auto-width vs wrap-width layout. */
  commitSingleDrag(deps, snap, t, isRotation, isResize) {
    if (!isRotation && isResize) {
      if (!snap.beforeTextSnapshot) {
        throw new Error('select: text resize commit missing beforeTextSnapshot')
      }
      const after = {
        content: t.content,
        font: { ...t.font },
        color: t.color,
        wrapWidth: t.wrapWidth,
      }
      const before = snap.beforeTextSnapshot
      const changed =
        before.font.size !== after.font.size ||
        before.font.family !== after.font.family ||
        before.font.bold !== after.font.bold ||
        before.font.italic !== after.font.italic ||
        before.font.underline !== after.font.underline ||
        before.wrapWidth !== after.wrapWidth
      if (changed) {
        deps.saveText(t)
        deps.pushOp({ kind: 'edit-text', textId: t.id, before, after })
      }
      return
    }
    commitRotateOrTransform(
      deps,
      snap,
      t,
      isRotation,
      (d, x) => d.saveText(x),
      (textId, before, after) => ({ kind: 'rotate-text', textId, before, after }),
      (textId, before, after) => ({ kind: 'transform-text', textId, before, after }),
    )
  },
  collectDeleteId(ids, id) {
    ids.textIds.push(id)
  },
}

const shapeBehavior: ObjectBehavior<ShapeObject> = {
  resolve(deps, id) {
    return resolveIn(deps.getShapes(), id)
  },
  viewParts(obj) {
    return { transform: obj.transform, rotation: obj.rotation ?? 0 }
  },
  beginMultiDrag(deps, id) {
    return rectMultiDragHandle(
      deps,
      id,
      shapeBehavior.resolve,
      (d, sh) => d.saveShape(sh),
      (shapeId, before, after) => ({ kind: 'shape', shapeId, before, after }),
    )
  },
  /** Mirrors the image commit — same transform model (rect + rotation),
   *  same op semantics. Style edits (color / strokeWidth / fill) come
   *  through edit-shape from the contextual menu, not from a drag. */
  commitSingleDrag(deps, snap, sh, isRotation) {
    commitRotateOrTransform(
      deps,
      snap,
      sh,
      isRotation,
      (d, s) => d.saveShape(s),
      (shapeId, before, after) => ({ kind: 'rotate-shape', shapeId, before, after }),
      (shapeId, before, after) => ({ kind: 'transform-shape', shapeId, before, after }),
    )
  },
  collectDeleteId(ids, id) {
    ids.shapeIds.push(id)
  },
}

const strokeBehavior: ObjectBehavior<Stroke> = {
  resolve(deps, id) {
    return resolveIn(deps.getStrokes(), id)
  },
  /** Strokes don't carry a transform — derive one from the sample bbox
   *  so handle math / hover-cursor reuse the same fields. Strokes don't
   *  expose handles (corners / edges / rotation), so the only consumers
   *  are the body hit-test and the halo render. */
  viewParts(obj) {
    const bb = getStrokeBBox(obj)
    return {
      transform: { x: bb.minX, y: bb.minY, w: bb.maxX - bb.minX, h: bb.maxY - bb.minY },
      rotation: 0,
    }
  },
  /** Stroke multi-drag is a samples translation, not a transform swap:
   *  track the cumulative applied delta, translate by the per-tick step,
   *  and commit a dx/dy `transform-many` item (the stroke arm's shape). */
  beginMultiDrag(deps, id) {
    if (!strokeBehavior.resolve(deps, id)) return null
    const applied = { dx: 0, dy: 0 }
    return {
      tick(totalDx: number, totalDy: number): void {
        const stroke = strokeBehavior.resolve(deps, id)
        if (!stroke) return
        _applyStrokeMoveStep(stroke, applied, totalDx, totalDy)
      },
      commit(): TransformManyItem | null {
        const stroke = deps.getStrokes().find((x) => x.id === id)
        if (!_shouldPushStrokeTransformManyItem(stroke, applied.dx, applied.dy)) return null
        if (!stroke || stroke.deleted) return null
        deps.saveStroke(stroke)
        return { kind: 'stroke', strokeId: id, dx: applied.dx, dy: applied.dy }
      },
    }
  },
  /**
   * Only `move` is supported (no resize / rotate semantics for freehand
   * geometry) — both flags are ignored.
   *
   * Key invariant: samples were mutated directly during the drag (see
   * the onPointerMove stroke branch). The `move` op handler in ops.ts
   * ALSO translates samples on apply / unapply. Pushing the op via
   * deps.pushOp records it in the undo stack WITHOUT calling applyOp —
   * otherwise we'd double-translate on commit. Undo / redo work
   * correctly because the op's apply/unapply are symmetric (translate
   * by +dx vs -dx).
   */
  commitSingleDrag(deps, snap, stroke) {
    const applied = snap.strokeMoveApplied
    if (!applied || (applied.dx === 0 && applied.dy === 0)) return
    deps.saveStroke(stroke)
    deps.pushOp({
      kind: 'move',
      strokeIds: [stroke.id],
      dx: applied.dx,
      dy: applied.dy,
    })
  },
  collectDeleteId(ids, id) {
    ids.strokeIds.push(id)
  },
}

/** The registry, keyed by Selection kind. */
const objectBehaviors = {
  image: imageBehavior,
  text: textBehavior,
  shape: shapeBehavior,
  stroke: strokeBehavior,
} as const

/** Look up the behavior for a selection kind, type-erased to the
 *  SelectableObject union. Call sites pair the returned behavior with
 *  objects it resolved itself, so the erasure can't mismatch at runtime;
 *  erasing here spares every dispatch site from generic plumbing over a
 *  union of four ObjectBehavior<T> instantiations. */
export function behaviorFor(kind: keyof typeof objectBehaviors): ObjectBehavior<SelectableObject> {
  return objectBehaviors[kind] as ObjectBehavior<SelectableObject>
}
