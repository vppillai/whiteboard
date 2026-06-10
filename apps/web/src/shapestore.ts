/**
 * ShapeStore — shape-object persistence behind the generic `ObjectStore`
 * seam (objectstore.ts), same contract as StrokeStore / TextStore.
 * Decouples the orchestrator from the concrete backend so a future sync
 * implementation (deferred per ADR 0012) can swap a server-backed store
 * in without rewriting main.ts.
 *
 * v1 has one concrete implementation: a local IDB-backed store. Like
 * TextStore, there's no metadata/binary split — shape records carry their
 * payload inline (transform + style fields), so the single `upsert` covers
 * create / edit / soft-delete. `delete` (hard) is used by background
 * compaction on load.
 */

import type { ShapeObject } from '@whiteboard/shared'
import type { ObjectStore } from './objectstore'
import { clearAllShapes, deleteShape, loadAllShapes, saveShape } from './storage'

/** Shape records implement the generic contract verbatim — `load` returns
 *  all records (deleted ones compacted away) sorted by z asc. */
export type ShapeStore = ObjectStore<ShapeObject>

export function createLocalShapeStore(): ShapeStore {
  return {
    load: loadAllShapes,
    upsert: saveShape,
    delete: deleteShape,
    clear: clearAllShapes,
    onRemoteChange: () => () => undefined,
  }
}
