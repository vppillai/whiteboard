# 0006. Operation-based undo + soft-delete strokes

Date: 2026-05-09

## Status

Accepted

## Context

Through M0 / M1.5 the undo / redo stacks held `Stroke` objects directly: undo did `strokes.pop()`, pushed the stroke onto a redo stack, and hard-deleted it from IndexedDB; redo was the inverse. That worked for the only operation we had — "create stroke" — but doesn't compose with what M1 needs:

| Operation | Strokes touched | Reversal |
|---|---|---|
| Pen create | 1 | Hide that stroke |
| Eraser sweep | N (intersected by sweep) | Re-show those N |
| Lasso delete | N (selected) | Re-show those N |
| Lasso move | N (selected) | Translate by `(-dx, -dy)` |

A per-stroke redo stack can't represent "delete these 50". Each user action needs to be a single atomic unit with its own apply / unapply.

Separately: the spec (§ 6 and [ADR 0003](0003-yjs-collaboration.md)) calls for a `deleted?: boolean` field on `Stroke` for soft delete — friendly to undo (a flag flip is cheaper than data restoration), CRDT-friendly when M3 sync lands (no tombstone confusion), and rendering-friendly (no array churn). The field was specified but unused; the previous undo path hard-deleted from IDB instead.

The two changes are tightly coupled — op-based undo is much simpler with soft delete than without — so they land together in this ADR.

## Decision

### Op type

Defined in `apps/web/src/ops.ts`:

```ts
type Op =
  | { kind: 'create'; strokeId: string }
  | { kind: 'delete'; strokeIds: string[] }
  | { kind: 'move'; strokeIds: string[]; dx: number; dy: number }
```

Apply / unapply are uniform — they look up strokes by id from the in-memory array (the single source of truth) and mutate in place via `deleted` flips or sample translation.

### Soft delete

`Stroke.deleted = true` hides a stroke. The committed-canvas render filters them. Undo of a stroke creation flips `deleted: true`; redo flips it back to `false`. The stroke is never removed from the in-memory array or from IDB.

### Persistence

Fire-and-forget. The op caller's `OpContext.saveStroke` is called once per mutated stroke; the caller chooses the error policy (today: log a warning).

### Clear-board is *not* an op

It's an explicit destructive boundary — empties the strokes array, both undo / redo stacks, and the IDB store. Documented in `clearflow.ts` and SPEC § 4.3. The two-step confirmation toast remains.

## Consequences

**Easier.**

- Adding the eraser at M1: emits `{ kind: 'delete', strokeIds }`. Undo / redo work for free.
- Adding lasso-move: `{ kind: 'move', ... }`. Same.
- The undo / redo stack is uniform — no per-op-kind branching at call sites; just `apply` / `unapply`.
- M3 CRDT sync: ops translate cleanly into Y.js mutations later.
- Position preservation: strokes never leave the array, so z-order (if it ever matters) is stable across undo / redo cycles.

**Harder.**

- Strokes accumulate over a session even when "deleted" — they linger in memory and IDB. Acceptable for personal-use whiteboards with hundreds of strokes per board; M3+ may want a GC or compaction story (e.g. rewrite the IDB store on app load if more than X% are deleted).
- `Stroke.deleted` is now part of the persistence shape. Any future schema migration has to carry it.

**Risks.**

- A stale stroke reference on the undo stack: if something else removes a stroke (a future CRDT remote delete, say), the undo op would silently no-op when its `strokeIds.find()` returns undefined. That's tolerable — the user just sees "nothing happened" — but worth a watch.
- Bulk ops (eraser sweep over 50 strokes) push *one* op with 50 ids. That's the right shape; the alternative (50 ops) would force 50 undos. If a sweep ever produces too-many-ops we'll need an upper bound or a "merge consecutive ops" pass.
