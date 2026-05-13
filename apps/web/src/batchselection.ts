/**
 * Cmd+A batch-mark state for images + texts.
 *
 * Why a dedicated module: the Cmd+A → Delete flow needs to mark
 * objects of multiple kinds for "next Delete press also removes
 * these," visualized as a thin outline on each. The earlier inline
 * implementation in main.ts had four sites manipulating two parallel
 * Sets (mark / clear / drain-on-delete / outline-on-render), with
 * the clear-all logic duplicated four ways. A fourth object kind
 * (shapes / sticky notes) would have made it six.
 *
 * Not to be confused with `SelectTool`'s single-object selection
 * (`{ kind, id }` with handles + transform UX). This is just a
 * "pending bulk delete" flag, intentionally stateless beyond the
 * marked ids — no drag, no resize, no per-object affordance.
 */

import type { ImageObject, TextObject } from '@whiteboard/shared'
import type { Op } from './ops'

export interface BatchSelectionDeps {
  saveImage: (img: ImageObject) => void
  saveText: (t: TextObject) => void
  pushOp: (op: Op) => void
  markCommittedDirty: () => void
}

export interface BatchSelection {
  hasImage(id: string): boolean
  hasText(id: string): boolean
  /** Replace any existing marks with EVERY non-deleted image + text.
   *  Used by Cmd+A; the caller passes the live arrays. */
  markAll(images: readonly ImageObject[], texts: readonly TextObject[]): void
  /** Drop all marks. Returns true if anything was cleared (so the
   *  caller can decide whether to repaint). */
  clear(): boolean
  isEmpty(): boolean
  /** Soft-delete every marked object, push per-kind delete ops, and
   *  clear the marks. Returns true if any deletion happened. The
   *  caller passes the live arrays — same pattern as `markAll` so
   *  this module doesn't hold long-lived references to the arrays.
   *  Each deletion is a separate op for symmetry with the existing
   *  per-object delete UX (lasso's stroke batch is single-op; image
   *  + text batch has been multi-op since v1.1 — preserving for now
   *  to avoid changing undo semantics in the same pass as the
   *  extraction). */
  deleteAll(images: ImageObject[], texts: TextObject[]): boolean
}

export function createBatchSelection(deps: BatchSelectionDeps): BatchSelection {
  const imageIds = new Set<string>()
  const textIds = new Set<string>()

  return {
    hasImage: (id) => imageIds.has(id),
    hasText: (id) => textIds.has(id),

    markAll(images, texts): void {
      imageIds.clear()
      textIds.clear()
      for (const img of images) {
        if (!img.deleted) imageIds.add(img.id)
      }
      for (const t of texts) {
        if (!t.deleted) textIds.add(t.id)
      }
      deps.markCommittedDirty()
    },

    clear(): boolean {
      if (imageIds.size === 0 && textIds.size === 0) return false
      imageIds.clear()
      textIds.clear()
      deps.markCommittedDirty()
      return true
    },

    isEmpty(): boolean {
      return imageIds.size === 0 && textIds.size === 0
    },

    deleteAll(images, texts): boolean {
      let didDelete = false
      if (imageIds.size > 0) {
        for (const id of imageIds) {
          const img = images.find((i) => i.id === id)
          if (!img || img.deleted) continue
          img.deleted = true
          deps.saveImage(img)
          deps.pushOp({ kind: 'delete-image', imageId: id })
          didDelete = true
        }
        imageIds.clear()
      }
      if (textIds.size > 0) {
        for (const id of textIds) {
          const t = texts.find((x) => x.id === id)
          if (!t || t.deleted) continue
          t.deleted = true
          deps.saveText(t)
          deps.pushOp({ kind: 'delete-text', textId: id })
          didDelete = true
        }
        textIds.clear()
      }
      if (didDelete) deps.markCommittedDirty()
      return didDelete
    },
  }
}
