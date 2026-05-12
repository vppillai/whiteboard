/**
 * Runtime cache of decoded HTMLImageElements keyed by an image's blobRef.
 *
 * Why: `ctx.drawImage` needs an HTMLImageElement (or an ImageBitmap), not a
 * Blob. We could rebuild the image from the Blob on every frame, but that
 * means `URL.createObjectURL` + a fresh decode each tick — wasteful and
 * blocks the frame for big images. This cache holds one HTMLImageElement
 * per Blob; load is async (returns a Promise that resolves when ready)
 * but lookup is synchronous (returns null while pending so the render
 * loop can skip that image until the next frame).
 *
 * The cache outlives individual ImageObjects (an image's metadata may be
 * soft-deleted then restored via undo; the bytes are still in IDB and
 * the cache entry can be reused).
 */

const elementByBlobRef = new Map<string, HTMLImageElement>()
const loadPromiseByBlobRef = new Map<string, Promise<HTMLImageElement>>()

/**
 * Resolve a Blob into a decoded HTMLImageElement, caching the result.
 * Repeated calls with the same blobRef short-circuit: a second prefetch
 * call before the first completes shares the in-flight Promise.
 */
export function loadImageElement(blobRef: string, blob: Blob): Promise<HTMLImageElement> {
  const ready = elementByBlobRef.get(blobRef)
  if (ready?.complete && ready.naturalWidth > 0) return Promise.resolve(ready)

  const inFlight = loadPromiseByBlobRef.get(blobRef)
  if (inFlight) return inFlight

  const url = URL.createObjectURL(blob)
  const el = new Image()
  // CrossOrigin isn't strictly needed for object-URL-loaded images, but
  // setting it consistently prevents tainted-canvas surprises if a
  // later refactor reuses the same code path for external URLs.
  el.decoding = 'async'

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    el.onload = (): void => {
      elementByBlobRef.set(blobRef, el)
      loadPromiseByBlobRef.delete(blobRef)
      resolve(el)
    }
    el.onerror = (): void => {
      loadPromiseByBlobRef.delete(blobRef)
      URL.revokeObjectURL(url)
      reject(new Error(`Failed to decode image for blobRef=${blobRef}`))
    }
    el.src = url
  })

  loadPromiseByBlobRef.set(blobRef, promise)
  return promise
}

/**
 * Synchronous lookup for the render loop. Returns null while the load is
 * pending — caller (the per-frame render) just skips that image until
 * the next frame, when load may have completed.
 */
export function getImageElement(blobRef: string): HTMLImageElement | null {
  const el = elementByBlobRef.get(blobRef)
  if (!el) return null
  if (!el.complete || el.naturalWidth === 0) return null
  return el
}

/**
 * Drop a cache entry — used when an image is hard-deleted. Frees the
 * object URL so the browser can reclaim the bytes.
 */
export function evictImageElement(blobRef: string): void {
  const el = elementByBlobRef.get(blobRef)
  if (el?.src.startsWith('blob:')) URL.revokeObjectURL(el.src)
  elementByBlobRef.delete(blobRef)
  loadPromiseByBlobRef.delete(blobRef)
}

/** Test utility — drops all cache state. Not used in production. */
export function _clearImageCache(): void {
  for (const el of elementByBlobRef.values()) {
    if (el.src.startsWith('blob:')) URL.revokeObjectURL(el.src)
  }
  elementByBlobRef.clear()
  loadPromiseByBlobRef.clear()
}
