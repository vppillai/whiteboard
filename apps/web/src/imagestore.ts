/**
 * ImageStore — image persistence behind the generic `ObjectStore` seam
 * (objectstore.ts). Decouples the orchestrator from the concrete backend
 * so a future sync implementation (M5.1 per ADR 0012's deferred plan) can
 * swap in a server-backed store without rewriting main.ts.
 *
 * v1 has one concrete implementation: a local IDB-backed store that
 * separates metadata (cheap to scan in the render loop) from binary
 * (heavier, pageable independently). That metadata/binary split is why
 * ImageStore deviates from the generic contract in three documented ways:
 *
 *   - `load` returns `ImageStoreLoadResult` (metadata records PLUS the
 *     blobRefs hard-compacted by this load) instead of a bare array.
 *   - `delete` is blob-aware: takes `(id, blobRef)` so both the metadata
 *     row and the binary row are dropped.
 *   - extras: `insert(image, blob)` is the image-specific creation path
 *     (persists metadata and bytes atomically; the inherited `upsert`
 *     touches metadata only), and `loadBlob` fetches raw bytes.
 *
 * Everything else (`upsert` / `clear` / `onRemoteChange`) is inherited
 * from `ObjectStore<ImageObject>` unchanged.
 */

import type { ImageObject } from '@whiteboard/shared'
import type { ObjectStore } from './objectstore'
import {
  clearAllImages,
  deleteImage,
  loadAllImages,
  loadImageBlob,
  saveImage,
  saveImageMeta,
} from './storage'

export interface ImageStoreLoadResult {
  images: ImageObject[]
  /** blobRefs of records that were soft-deleted in a prior session and
   *  have just been hard-compacted by this load. Callers should evict
   *  any matching runtime cache entries (decoded HTMLImageElements). */
  compactedBlobRefs: string[]
}

export interface ImageStore extends Omit<ObjectStore<ImageObject>, 'load' | 'delete'> {
  /** DEVIATION from ObjectStore: returns compaction info alongside the
   *  metadata records (deleted ones compacted away, sorted by z asc). */
  load(): Promise<ImageStoreLoadResult>
  /** DEVIATION from ObjectStore: hard-delete by id + blobRef (drops both
   *  metadata and bytes). Caller passes blobRef explicitly so a future
   *  schema where the binary identifier differs from the record id
   *  doesn't silently leak rows. */
  delete(id: string, blobRef: string): Promise<void>
  /** EXTRA: insert a new image — persists both metadata and bytes
   *  atomically. The image-specific creation path; the inherited
   *  `upsert` updates metadata only (move / resize / soft-delete). */
  insert(image: ImageObject, blob: Blob): Promise<void>
  /** EXTRA: fetch raw bytes for an image (or null if missing). */
  loadBlob(blobRef: string): Promise<Blob | null>
}

export function createLocalImageStore(): ImageStore {
  return {
    load: loadAllImages,
    loadBlob: loadImageBlob,
    insert: saveImage,
    upsert: saveImageMeta,
    delete: deleteImage,
    clear: clearAllImages,
    onRemoteChange: () => () => undefined,
  }
}
