/**
 * StrokeStore — stroke persistence behind the generic `ObjectStore` seam
 * (objectstore.ts). Decouples `main.ts` from the concrete backend so a
 * future sync implementation can swap in a Y.Doc-backed store without
 * rewriting the orchestrator.
 *
 * At v1, only the local IDB implementation exists. The original M3 sync
 * milestone (Y.Doc-backed shared store) was deferred per ADR 0012; the
 * full design is preserved at docs/superpowers/specs/2026-05-10-m3-sync-design.md.
 * This interface is the integration point — keeping it in v1 costs nothing
 * (one interface, one concrete implementation) and preserves the future
 * sharing option.
 */

import type { Stroke } from '@whiteboard/shared'
import type { ObjectStore } from './objectstore'
import { clearAllStrokes, deleteStroke, loadAllStrokes, saveStroke } from './storage'

/**
 * Strokes implement the generic contract verbatim — `load` returns all
 * persisted strokes sorted by startedAt asc.
 */
export type StrokeStore = ObjectStore<Stroke>

/**
 * IndexedDB-backed local store. The only implementation that exists at
 * v1 — wraps the existing storage.ts module verbatim. Has no remote
 * source, so `onRemoteChange` is a no-op.
 */
export function createLocalStrokeStore(): StrokeStore {
  return {
    load: loadAllStrokes,
    upsert: saveStroke,
    delete: deleteStroke,
    clear: clearAllStrokes,
    onRemoteChange: () => () => undefined,
  }
}
