/**
 * Write a selected image to the system clipboard so a subsequent
 * Ctrl/Cmd+V into another app (or back into this canvas) lands it.
 * Used by main.ts's `copy` / `cut` handlers when the Select tool is
 * active and an image is selected.
 *
 * Format handling: the Clipboard API broadly supports `image/png`;
 * `image/jpeg`, `image/webp`, and `image/gif` support is partial
 * across browsers. To get bulletproof "copy here → paste in any
 * app" behavior we re-encode non-PNG sources to PNG before writing.
 * The already-decoded HTMLImageElement is reused from the runtime
 * cache when present (the common case — the image is being
 * displayed), so this is essentially a free canvas draw.
 */

import type { ImageObject } from '@whiteboard/shared'
import { getImageElement } from './imagecache'

export interface WriteImageToClipboardDeps {
  /** How to fetch the raw bytes for the image. Wraps `ImageStore.loadBlob`
   *  so this module stays decoupled from the persistence layer. */
  loadBlob: (blobRef: string) => Promise<Blob | null>
  /** Surface a short status toast to the user — "Image copied",
   *  "Copy failed — …". */
  onToast: (msg: string) => void
}

/**
 * Returns true when the write succeeded. The `cut` handler in main.ts
 * gates the subsequent delete on this — failing to write to the
 * clipboard but still deleting would lose the image entirely.
 */
export async function writeImageToClipboard(
  img: ImageObject,
  deps: WriteImageToClipboardDeps,
): Promise<boolean> {
  const blob = await deps.loadBlob(img.blobRef)
  if (!blob) {
    deps.onToast('Copy failed — image data missing')
    return false
  }
  let clipboardBlob = blob
  if (blob.type !== 'image/png') {
    try {
      clipboardBlob = await reencodeAsPng(img.blobRef, blob)
    } catch (err) {
      // Fall through with the original blob; some browsers do accept
      // non-PNG MIMEs (e.g. Firefox accepts image/jpeg).
      console.warn('whiteboard/web: PNG re-encode failed for clipboard:', err)
    }
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [clipboardBlob.type]: clipboardBlob })])
    deps.onToast('Image copied')
    return true
  } catch (err) {
    console.warn('whiteboard/web: clipboard write failed:', err)
    // Common cause: missing user-gesture trust or permission policy block.
    // Distinct toast so the user knows it wasn't a "no selection" no-op.
    deps.onToast('Copy failed — clipboard not available')
    return false
  }
}

async function reencodeAsPng(blobRef: string, srcBlob: Blob): Promise<Blob> {
  // Prefer the already-decoded element from the runtime cache. The cache
  // only returns it after `onload` has fired (per imagecache.ts), so
  // `naturalWidth/Height` are valid.
  const cached = getImageElement(blobRef)
  const el = cached ?? (await decodeBlobLocal(srcBlob))
  const canvas = document.createElement('canvas')
  canvas.width = el.naturalWidth
  canvas.height = el.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('imageclipboard: 2D canvas context unavailable')
  ctx.drawImage(el, 0, 0)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('imageclipboard: toBlob returned null'))),
      'image/png',
    )
  })
}

/**
 * Decode a Blob to an HTMLImageElement without touching the runtime cache.
 * The cache's `loadImageElement` would store the element and trigger
 * dirty repaint side effects; this path is for cases where the cache
 * miss is transient (e.g. the image was just paste-evicted) and we just
 * need the bitmap for a one-shot re-encode.
 */
async function decodeBlobLocal(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const el = new Image()
    await new Promise<void>((resolve, reject) => {
      el.onload = () => resolve()
      el.onerror = () => reject(new Error('imageclipboard: image decode failed'))
      el.src = url
    })
    return el
  } finally {
    URL.revokeObjectURL(url)
  }
}
