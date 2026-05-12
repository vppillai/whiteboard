/**
 * Local persistence via IndexedDB. The only persistence backend at v1.
 * Wrapped behind the `StrokeStore` / `ImageStore` interfaces (strokestore.ts,
 * imagestore.ts) so a future sync implementation can plug in without
 * touching the orchestrator (sharing is deferred per ADR 0012; design
 * archive at docs/superpowers/specs/2026-05-10-m3-sync-design.md).
 *
 * Schema (single database, multiple object stores):
 *   - strokes      — stroke records keyed on Stroke.id
 *   - images       — image metadata records keyed on ImageObject.id
 *   - images-blob  — raw image Blobs keyed on ImageObject.blobRef
 *
 * The images split (metadata vs binary) keeps the metadata store cheap to
 * scan in the render loop and the heavy bytes pageable independently.
 */

import type { ImageObject, Stroke } from '@whiteboard/shared'

const DB_NAME = 'whiteboard-local'
/**
 * v2 bump introduces 'images' and 'images-blob' stores for the image-paste
 * feature. Existing databases at v1 upgrade in place — the onupgradeneeded
 * branch creates only the missing stores so stroke data is preserved.
 */
const DB_VERSION = 2
const STORE_STROKES = 'strokes'
const STORE_IMAGES = 'images'
const STORE_IMAGES_BLOB = 'images-blob'

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
        // images and images-blob are added in v2. Idempotent guards
        // because onupgradeneeded fires once per version step but the
        // contains-check is cheap and forward-compat if we ever do
        // a v3 + downgrade-then-upgrade rerun.
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORE_IMAGES_BLOB)) {
          // blob store is keyed manually — the Blob itself can't carry
          // an in-band key the way records do.
          db.createObjectStore(STORE_IMAGES_BLOB)
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

// ─── Image persistence ──────────────────────────────────────────────────────

/**
 * Persist an image metadata record + its Blob bytes in a single
 * transaction so partial state (metadata without bytes, or vice versa)
 * can never survive a crash.
 */
export async function saveImage(image: ImageObject, blob: Blob): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_IMAGES_BLOB], 'readwrite')
    tx.objectStore(STORE_IMAGES).put(image)
    tx.objectStore(STORE_IMAGES_BLOB).put(blob, image.blobRef)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

/**
 * Upsert only the metadata record (transform, deleted flag, …). Used for
 * move / resize / delete ops where the binary doesn't change. Faster than
 * `saveImage` because the Blob never enters the transaction.
 */
export async function saveImageMeta(image: ImageObject): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readwrite')
    tx.objectStore(STORE_IMAGES).put(image)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

/**
 * Pure compaction predicate. Mirrors `partitionForCompaction` for strokes:
 * an image with `deleted === true` from a previous session has no undo
 * path (undo stack reset on reload), so it's safe to hard-delete + free
 * the Blob.
 *
 * `toCompact` carries `{ id, blobRef }` rather than just `id` so the
 * compaction step can delete the right blob row even if a future schema
 * change makes `blobRef !== id` (e.g. content-addressed dedupe, server
 * URL). v1 has `blobRef === id` but the abstraction is cheap to preserve.
 */
export function partitionImagesForCompaction(images: readonly ImageObject[]): {
  kept: ImageObject[]
  toCompact: Array<{ id: string; blobRef: string }>
} {
  const kept: ImageObject[] = []
  const toCompact: Array<{ id: string; blobRef: string }> = []
  for (const img of images) {
    if (img.deleted === true) toCompact.push({ id: img.id, blobRef: img.blobRef })
    else kept.push(img)
  }
  return { kept, toCompact }
}

/**
 * Load all image metadata records and trigger background compaction of
 * any soft-deleted leftovers. Each compaction also returns its blobRef
 * via the second tuple element so the caller can evict matching runtime
 * cache entries (decoded HTMLImageElements) at the same time.
 */
export async function loadAllImages(): Promise<{
  images: ImageObject[]
  compactedBlobRefs: string[]
}> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES, 'readonly')
    const req = tx.objectStore(STORE_IMAGES).getAll()
    req.onsuccess = () => {
      const all = req.result as ImageObject[]
      const { kept, toCompact } = partitionImagesForCompaction(all)
      kept.sort((a, b) => a.z - b.z)
      // Compaction is fire-and-forget — failure is non-fatal and will
      // retry on the next load.
      if (toCompact.length > 0) {
        void Promise.all(
          toCompact.map((entry) => deleteImage(entry.id, entry.blobRef).catch(() => undefined)),
        )
      }
      resolve({ images: kept, compactedBlobRefs: toCompact.map((c) => c.blobRef) })
    }
    req.onerror = () => reject(req.error)
  })
}

export async function loadImageBlob(blobRef: string): Promise<Blob | null> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_IMAGES_BLOB, 'readonly')
    const req = tx.objectStore(STORE_IMAGES_BLOB).get(blobRef)
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Hard-delete an image (metadata + bytes) in a single transaction. Used by
 * background compaction on load. Live delete-image ops do soft-delete via
 * `saveImageMeta` instead.
 *
 * Takes `blobRef` explicitly rather than assuming `blobRef === id` so a
 * future schema where the binary is content-addressed or server-URL'd
 * doesn't silently leak blob rows.
 */
export async function deleteImage(id: string, blobRef: string): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_IMAGES_BLOB], 'readwrite')
    tx.objectStore(STORE_IMAGES).delete(id)
    tx.objectStore(STORE_IMAGES_BLOB).delete(blobRef)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

export async function clearAllImages(): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_IMAGES, STORE_IMAGES_BLOB], 'readwrite')
    tx.objectStore(STORE_IMAGES).clear()
    tx.objectStore(STORE_IMAGES_BLOB).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
