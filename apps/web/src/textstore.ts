/**
 * TextStore — text-object persistence behind the generic `ObjectStore`
 * seam (objectstore.ts), same contract as StrokeStore / ShapeStore.
 * Decouples the orchestrator from the concrete backend so a future sync
 * implementation (deferred per ADR 0012) can swap a server-backed store
 * in without rewriting main.ts.
 *
 * v1 has one concrete implementation: a local IDB-backed store. Unlike
 * ImageStore, there's no metadata/binary split — text records carry their
 * payload inline (plain string `content`), so the single `upsert` covers
 * create / edit / soft-delete. `delete` (hard) is used by background
 * compaction on load.
 */

import type { TextObject } from '@whiteboard/shared'
import type { ObjectStore } from './objectstore'
import { clearAllTexts, deleteText, loadAllTexts, saveText } from './storage'

/** Text records implement the generic contract verbatim — `load` returns
 *  all records (deleted ones compacted away) sorted by z asc. */
export type TextStore = ObjectStore<TextObject>

export function createLocalTextStore(): TextStore {
  return {
    load: loadAllTexts,
    upsert: saveText,
    delete: deleteText,
    clear: clearAllTexts,
    onRemoteChange: () => () => undefined,
  }
}
