/**
 * TextStore — abstraction over text-object persistence, mirroring
 * StrokeStore / ImageStore. Decouples the orchestrator from the concrete
 * backend so a future sync implementation (deferred per ADR 0012) can
 * swap a server-backed store in without rewriting main.ts.
 *
 * v1 has one concrete implementation: a local IDB-backed store. Unlike
 * ImageStore, there's no metadata/binary split — text records carry
 * their payload inline (plain string `content`), so `insert` and
 * `updateMeta` collapse to the same single-store write.
 */

import type { TextObject } from '@whiteboard/shared'
import { clearAllTexts, deleteText, loadAllTexts, saveText } from './storage'

export type TextStoreEvent = unknown

export interface TextStore {
  /** Load all text records (deleted ones compacted away). Sorted by z asc. */
  load(): Promise<TextObject[]>
  /** Insert a new text record. */
  insert(text: TextObject): Promise<void>
  /** Update an existing record (move / resize / edit / soft-delete). */
  update(text: TextObject): Promise<void>
  /** Hard-delete by id. Used by background compaction on load. */
  hardDelete(id: string): Promise<void>
  /** Hard-delete every text record. Used by clear-board. */
  clear(): Promise<void>
  /** Reserved for a future sync implementation; local store is a no-op.
   *  TODO(M5.1): replace TextStoreEvent with a discriminated union of
   *  remote ops once Y.Doc semantics are committed. */
  onRemoteChange(handler: (event: TextStoreEvent) => void): () => void
}

export function createLocalTextStore(): TextStore {
  return {
    load: loadAllTexts,
    insert: saveText,
    update: saveText,
    hardDelete: deleteText,
    clear: clearAllTexts,
    onRemoteChange: () => () => undefined,
  }
}
