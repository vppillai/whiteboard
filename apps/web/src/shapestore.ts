/**
 * ShapeStore — abstraction over shape-object persistence, mirroring
 * StrokeStore / ImageStore / TextStore. Decouples the orchestrator from
 * the concrete backend so a future sync implementation (deferred per
 * ADR 0012) can swap a server-backed store in without rewriting main.ts.
 *
 * v1 has one concrete implementation: a local IDB-backed store. Like
 * TextStore, there's no metadata/binary split — shape records carry
 * their payload inline (transform + style fields), so `insert` and
 * `update` collapse to the same single-store write.
 */

import type { ShapeObject } from '@whiteboard/shared'
import { clearAllShapes, deleteShape, loadAllShapes, saveShape } from './storage'

export type ShapeStoreEvent = unknown

export interface ShapeStore {
  /** Load all shape records (deleted ones compacted away). Sorted by z asc. */
  load(): Promise<ShapeObject[]>
  /** Insert a new shape record. */
  insert(shape: ShapeObject): Promise<void>
  /** Update an existing record (move / resize / rotate / edit / soft-delete). */
  update(shape: ShapeObject): Promise<void>
  /** Hard-delete by id. Used by background compaction on load. */
  hardDelete(id: string): Promise<void>
  /** Hard-delete every shape record. Used by clear-board. */
  clear(): Promise<void>
  /** Reserved for a future sync implementation; local store is a no-op.
   *  TODO(M5.1): replace ShapeStoreEvent with a discriminated union of
   *  remote ops once Y.Doc semantics are committed. */
  onRemoteChange(handler: (event: ShapeStoreEvent) => void): () => void
}

export function createLocalShapeStore(): ShapeStore {
  return {
    load: loadAllShapes,
    insert: saveShape,
    update: saveShape,
    hardDelete: deleteShape,
    clear: clearAllShapes,
    onRemoteChange: () => () => undefined,
  }
}
