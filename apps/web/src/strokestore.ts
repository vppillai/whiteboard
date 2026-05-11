/**
 * StrokeStore — abstraction over stroke persistence. Decouples `main.ts`
 * from the concrete backend so the M3 sync milestone can swap in a
 * Y.Doc-backed implementation without rewriting the orchestrator.
 *
 * M2.1: only the local IDB implementation exists. M3 will add a remote
 * implementation that wraps a Y.Doc + provider and emits remote-change
 * events.
 *
 * The interface keeps the load/save/delete/clear surface narrow — the
 * same methods main.ts already used directly from storage.ts. The
 * `onRemoteChange` method is a stub: local store returns a no-op
 * unsubscribe (no remote source exists). M3 refines the event payload
 * once Y.js observer semantics are committed to.
 */

import type { Stroke } from '@whiteboard/shared'
import { clearAllStrokes, deleteStroke, loadAllStrokes, saveStroke } from './storage'

/**
 * Placeholder remote-change event. Intentionally untyped (`unknown`) for
 * M2.1 because the local store never fires it. M3 will replace this
 * with a discriminated union of remote ops (`remote-create`, `remote-delete`,
 * `remote-stamp`, etc.) once the Y.Doc structure is locked.
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
   * Subscribe to remote-peer changes. M2.1 local store: returns a no-op
   * unsubscribe. M3 sync store: invokes handler when the Y.Doc observes
   * a change from another peer.
   */
  onRemoteChange(handler: (event: StrokeStoreEvent) => void): () => void
}

/**
 * IndexedDB-backed local store. The only implementation that exists in
 * M2.1 — wraps the existing storage.ts module verbatim. Has no remote
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
