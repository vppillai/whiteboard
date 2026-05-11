/**
 * StrokeStore — abstraction over stroke persistence. Decouples `main.ts`
 * from the concrete backend so a future sync implementation can swap in
 * a Y.Doc-backed store without rewriting the orchestrator.
 *
 * At v1, only the local IDB implementation exists. The original M3 sync
 * milestone (Y.Doc-backed shared store) was deferred per ADR 0012; the
 * full design is preserved at docs/superpowers/specs/2026-05-10-m3-sync-design.md.
 * This interface is the integration point — keeping it in v1 costs nothing
 * (one interface, one concrete implementation) and preserves the future
 * sharing option.
 *
 * The interface keeps the load/save/delete/clear surface narrow — the
 * same methods main.ts already used directly from storage.ts. The
 * `onRemoteChange` method is a stub: local store returns a no-op
 * unsubscribe (no remote source exists). A future sync implementation
 * will refine the event payload once Y.js observer semantics are committed.
 */

import type { Stroke } from '@whiteboard/shared'
import { clearAllStrokes, deleteStroke, loadAllStrokes, saveStroke } from './storage'

/**
 * Placeholder remote-change event. Intentionally untyped (`unknown`) at v1
 * because the local store never fires it. A future sync implementation
 * (deferred per ADR 0012) will replace this with a discriminated union of
 * remote ops (`remote-create`, `remote-delete`, `remote-stamp`, etc.)
 * once the Y.Doc structure is locked. The design archive at
 * docs/superpowers/specs/2026-05-10-m3-sync-design.md proposes the shape.
 */
export type StrokeStoreEvent = unknown

export interface StrokeStore {
  /** Load all persisted strokes. Sorted by startedAt asc. */
  load(): Promise<Stroke[]>
  /** Persist (or upsert) a single stroke. Idempotent. */
  save(stroke: Stroke): Promise<void>
  /** Hard-delete by id. */
  delete(id: string): Promise<void>
  /** Hard-delete everything. */
  clear(): Promise<void>
  /**
   * Subscribe to remote-peer changes. Local store: returns a no-op
   * unsubscribe (no remote source). A future sync store will invoke
   * the handler when the Y.Doc observes a change from another peer.
   */
  onRemoteChange(handler: (event: StrokeStoreEvent) => void): () => void
}

/**
 * IndexedDB-backed local store. The only implementation that exists at
 * v1 — wraps the existing storage.ts module verbatim. Has no remote
 * source, so `onRemoteChange` is a no-op.
 */
export function createLocalStrokeStore(): StrokeStore {
  return {
    load: loadAllStrokes,
    save: saveStroke,
    delete: deleteStroke,
    clear: clearAllStrokes,
    onRemoteChange: () => () => undefined,
  }
}
