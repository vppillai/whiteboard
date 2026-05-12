/**
 * ImageStore — abstraction over image persistence, mirroring StrokeStore.
 * Decouples the orchestrator from the concrete backend so a future sync
 * implementation (M5.1 per ADR 0012's deferred plan) can swap in a
 * server-backed store without rewriting main.ts.
 *
 * v1 has one concrete implementation: a local IDB-backed store that
 * separates metadata (cheap to scan in the render loop) from binary
 * (heavier, pageable independently).
 */

import type { ImageObject } from '@whiteboard/shared'
import {
  clearAllImages,
  deleteImage,
  loadAllImages,
  loadImageBlob,
  saveImage,
  saveImageMeta,
} from './storage'

export type ImageStoreEvent = unknown

export interface ImageStore {
  /** Load all image metadata records (deleted ones compacted away). Sorted by z asc. */
  load(): Promise<ImageObject[]>
  /** Fetch raw bytes for an image (or null if missing). */
  loadBlob(blobRef: string): Promise<Blob | null>
  /** Insert a new image: persists both metadata and bytes atomically. */
  insert(image: ImageObject, blob: Blob): Promise<void>
  /** Update an existing image's metadata only (move / resize / delete). */
  updateMeta(image: ImageObject): Promise<void>
  /** Hard-delete by id (drops both metadata and bytes). Used by compaction. */
  hardDelete(id: string): Promise<void>
  /** Hard-delete all images and bytes. */
  clear(): Promise<void>
  /** Reserved for a future sync implementation; local store is a no-op. */
  onRemoteChange(handler: (event: ImageStoreEvent) => void): () => void
}

export function createLocalImageStore(): ImageStore {
  return {
    load: loadAllImages,
    loadBlob: loadImageBlob,
    insert: saveImage,
    updateMeta: saveImageMeta,
    hardDelete: deleteImage,
    clear: clearAllImages,
    onRemoteChange: () => () => undefined,
  }
}
