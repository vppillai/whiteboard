/**
 * Local persistence via IndexedDB. The only persistence backend at v1.
 * Wrapped behind the `StrokeStore` interface (strokestore.ts) so a future
 * sync implementation can plug in without touching the orchestrator
 * (sharing is deferred per ADR 0012; design archive at
 * docs/superpowers/specs/2026-05-10-m3-sync-design.md).
 *
 * Single object store keyed on stroke id. Each stroke is written individually
 * on commit so a power-loss event at most loses the in-flight stroke.
 */

import type { Stroke } from '@whiteboard/shared'

const DB_NAME = 'whiteboard-local'
const DB_VERSION = 1
const STORE_STROKES = 'strokes'

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_STROKES)) {
          db.createObjectStore(STORE_STROKES, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

export async function saveStroke(stroke: Stroke): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STROKES, 'readwrite')
    tx.objectStore(STORE_STROKES).put(stroke)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

/**
 * Pure compaction predicate. A stroke loaded with `deleted === true` has
 * no undo path in the new session (the undo stack is empty on startup),
 * so it's safe to hard-delete from IDB. Exposed for unit testing
 * without an IDB polyfill — see storage.test.ts.
 */
export function partitionForCompaction(strokes: readonly Stroke[]): {
  kept: Stroke[]
  toCompact: string[]
} {
  const kept: Stroke[] = []
  const toCompact: string[] = []
  for (const s of strokes) {
    if (s.deleted === true) toCompact.push(s.id)
    else kept.push(s)
  }
  return { kept, toCompact }
}

export async function loadAllStrokes(): Promise<Stroke[]> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STROKES, 'readonly')
    const req = tx.objectStore(STORE_STROKES).getAll()
    req.onsuccess = () => {
      const all = req.result as Stroke[]
      const { kept, toCompact } = partitionForCompaction(all)
      kept.sort((a, b) => a.startedAt - b.startedAt)
      // Background compaction — fire-and-forget. A stroke with deleted=true
      // loaded from a previous session can never be restored via undo
      // (undo stack is reset on reload), so the IDB row is dead weight.
      // Errors are non-fatal; the compaction will retry on the next load.
      if (toCompact.length > 0) {
        void Promise.all(toCompact.map((id) => deleteStroke(id).catch(() => undefined)))
      }
      resolve(kept)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function deleteStroke(id: string): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STROKES, 'readwrite')
    tx.objectStore(STORE_STROKES).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearAllStrokes(): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STROKES, 'readwrite')
    tx.objectStore(STORE_STROKES).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
