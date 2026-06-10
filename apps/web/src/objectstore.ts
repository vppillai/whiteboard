/**
 * ObjectStore<T> — the single generic persistence seam shared by all four
 * object stores (stroke / text / shape / image). Decouples `main.ts` from
 * the concrete backend so a future sync implementation (deferred per
 * ADR 0012) can swap in ONE Y.Doc-backed implementation — rather than four
 * bespoke adapters — without rewriting the orchestrator.
 *
 * At v1, the only implementations are the local IDB-backed stores in
 * strokestore.ts / textstore.ts / shapestore.ts / imagestore.ts. Stroke,
 * text, and shape stores implement this interface verbatim; ImageStore
 * extends it with a blob side-channel (see imagestore.ts header for the
 * documented deviations).
 *
 * The surface is intentionally narrow — the same operations main.ts
 * already used directly from storage.ts, under one name each:
 * load / upsert / delete / clear / onRemoteChange.
 */

/**
 * Placeholder remote-change event. Intentionally untyped (`unknown`) at v1
 * because the local stores never fire it. A future sync implementation
 * (deferred per ADR 0012) will replace this with a discriminated union of
 * remote ops (`remote-create`, `remote-delete`, `remote-stamp`, etc.)
 * once the Y.Doc structure is locked. The design archive at
 * docs/superpowers/specs/2026-05-10-m3-sync-design.md proposes the shape.
 */
export type ObjectStoreEvent = unknown

/**
 * Generic store contract. `T` is constrained to `{ id: string }` (not
 * `BoardObject`) because strokes are sample-driven, not rect-driven, and
 * deliberately do NOT extend `BoardObject` — `id` is the only field all
 * four persisted record types share.
 */
export interface ObjectStore<T extends { id: string }> {
  /** Load all persisted records (soft-deleted ones compacted away). */
  load(): Promise<T[]>
  /** Upsert a single record — create, edit / move / resize, or soft-delete. Idempotent. */
  upsert(obj: T): Promise<void>
  /** Hard-delete by id. */
  delete(id: string): Promise<void>
  /** Hard-delete every record. Used by clear-board / factory reset. */
  clear(): Promise<void>
  /**
   * Subscribe to remote-peer changes. Local stores: returns a no-op
   * unsubscribe (no remote source exists). A future sync store will invoke
   * the handler when the Y.Doc observes a change from another peer.
   * TODO(M5.1): replace ObjectStoreEvent with a discriminated union of
   * remote ops once Y.Doc semantics are committed.
   */
  onRemoteChange(handler: (event: ObjectStoreEvent) => void): () => void
}
