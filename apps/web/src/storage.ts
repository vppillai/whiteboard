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

import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'

const DB_NAME = 'whiteboard-local'
/**
 * Schema history:
 *   v1: strokes
 *   v2: + images + images-blob (M2.2 — image paste)
 *   v3: + texts (v1.2 — text tool)
 *   v4: corrective re-upgrade — no new stores. A small set of users
 *       ended up with v3 databases that were missing the `texts` store
 *       (reported via NotFoundError at loadAllTexts in dev). Cause
 *       unclear (likely manual DevTools intervention or a one-time
 *       upgrade race), but the recovery is cheap: the `if (!contains)`
 *       guards already create stores idempotently — bumping the
 *       version forces onupgradeneeded to re-fire and the missing
 *       texts store gets created. Users with healthy v3 DBs pass
 *       through onupgradeneeded with all contains-checks returning
 *       false; no-op upgrade, just bumps the recorded version.
 *   v5: + shapes (v1.4 — Shape tool: rect / ellipse / line / arrow).
 *       No companion blob store — shape records carry their full
 *       payload inline (transform + style fields).
 *
 * Existing databases at any earlier version upgrade in place: the
 * onupgradeneeded branch creates only the missing stores so prior data
 * is preserved across the schema bump. There is no downgrade path.
 *
 * CRITICAL MIGRATION CONSTRAINT — read before adding a new schema
 * version:
 *
 *   The `if (!db.objectStoreNames.contains(storeName))` guards are
 *   safe ONLY for CREATE-NEW-STORE migrations. Any mutation to an
 *   EXISTING store (adding an index, renaming a field, changing the
 *   keyPath) must be guarded by an explicit version-range check:
 *
 *     if (event.oldVersion < N) { ... }
 *
 *   Otherwise users who already have the existing store will silently
 *   skip the mutation step. The `oldVersion` is available on the
 *   IDBVersionChangeEvent passed to `onupgradeneeded`.
 *
 *   v1 → v5 multi-step jumps work today because IDB fires
 *   `onupgradeneeded` once with `oldVersion = 1, newVersion = 5`, and
 *   all five `if (!contains)` guards run in sequence to create each
 *   missing store. This is the create-only-good path; mutate paths
 *   need the version-range guard.
 */
const DB_VERSION = 5
const STORE_STROKES = 'strokes'
const STORE_IMAGES = 'images'
const STORE_IMAGES_BLOB = 'images-blob'
const STORE_TEXTS = 'texts'
const STORE_SHAPES = 'shapes'

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
        // texts added in v3. No companion blob store — text records carry
        // their full payload inline (plain string `content`).
        if (!db.objectStoreNames.contains(STORE_TEXTS)) {
          db.createObjectStore(STORE_TEXTS, { keyPath: 'id' })
        }
        // shapes added in v5. No companion blob — shape records are
        // tiny (transform + a few style fields).
        if (!db.objectStoreNames.contains(STORE_SHAPES)) {
          db.createObjectStore(STORE_SHAPES, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      // If another tab holds an older-version connection open, the
      // upgrade is BLOCKED and neither onsuccess nor onerror fires —
      // boot would hang silently. Reject loudly so the load try/catch
      // can warn and the user sees a console message instead of a
      // mysterious blank canvas. Diagnosed during M3 (shape tool work)
      // when a v4-holding tab blocked a v5 upgrade.
      req.onblocked = () => {
        reject(
          new Error(
            'whiteboard/storage: IDB upgrade blocked — close other tabs of this app and reload',
          ),
        )
      }
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

// ─── Text persistence ──────────────────────────────────────────────────────

/**
 * Persist a text object. Single-store (no companion blob) since text
 * records carry their payload inline. saveText / saveTextMeta collapse to
 * the same operation because there's no metadata/binary split here.
 */
export async function saveText(text: TextObject): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEXTS, 'readwrite')
    tx.objectStore(STORE_TEXTS).put(text)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

/**
 * Pure compaction predicate for texts. Mirrors the stroke / image variants:
 * a text with `deleted === true` from a prior session has no undo path
 * (undo stack reset on reload), so it's safe to hard-delete.
 */
export function partitionTextsForCompaction(texts: readonly TextObject[]): {
  kept: TextObject[]
  toCompact: string[]
} {
  const kept: TextObject[] = []
  const toCompact: string[] = []
  for (const t of texts) {
    if (t.deleted === true) toCompact.push(t.id)
    else kept.push(t)
  }
  return { kept, toCompact }
}

/** Load all texts, sorted by z asc (same convention as images). Fires a
 *  fire-and-forget compaction for any leftover soft-deleted records. */
export async function loadAllTexts(): Promise<TextObject[]> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEXTS, 'readonly')
    const req = tx.objectStore(STORE_TEXTS).getAll()
    req.onsuccess = () => {
      const all = req.result as TextObject[]
      const { kept, toCompact } = partitionTextsForCompaction(all)
      kept.sort((a, b) => a.z - b.z)
      if (toCompact.length > 0) {
        void Promise.all(toCompact.map((id) => deleteText(id).catch(() => undefined)))
      }
      resolve(kept)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function deleteText(id: string): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEXTS, 'readwrite')
    tx.objectStore(STORE_TEXTS).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

export async function clearAllTexts(): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEXTS, 'readwrite')
    tx.objectStore(STORE_TEXTS).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Persist a shape object. Single-store (no companion blob) since shape
 * records carry their full payload inline (transform + style fields).
 * Same shape as `saveText`.
 */
export async function saveShape(shape: ShapeObject): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SHAPES, 'readwrite')
    tx.objectStore(STORE_SHAPES).put(shape)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

/**
 * Pure compaction predicate for shapes. Mirrors stroke / image / text
 * variants — a shape with `deleted === true` from a prior session has
 * no undo path (undo stack resets on reload), so it's safe to hard-
 * delete.
 */
export function partitionShapesForCompaction(shapes: readonly ShapeObject[]): {
  kept: ShapeObject[]
  toCompact: string[]
} {
  const kept: ShapeObject[] = []
  const toCompact: string[] = []
  for (const s of shapes) {
    if (s.deleted === true) toCompact.push(s.id)
    else kept.push(s)
  }
  return { kept, toCompact }
}

/** Load all shapes, sorted by z asc (same convention as images/texts).
 *  Fires a fire-and-forget compaction for soft-deleted records. */
export async function loadAllShapes(): Promise<ShapeObject[]> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SHAPES, 'readonly')
    const req = tx.objectStore(STORE_SHAPES).getAll()
    req.onsuccess = () => {
      const all = req.result as ShapeObject[]
      const { kept, toCompact } = partitionShapesForCompaction(all)
      kept.sort((a, b) => a.z - b.z)
      if (toCompact.length > 0) {
        void Promise.all(toCompact.map((id) => deleteShape(id).catch(() => undefined)))
      }
      resolve(kept)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function deleteShape(id: string): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SHAPES, 'readwrite')
    tx.objectStore(STORE_SHAPES).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}

export async function clearAllShapes(): Promise<void> {
  const db = await getDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SHAPES, 'readwrite')
    tx.objectStore(STORE_SHAPES).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
