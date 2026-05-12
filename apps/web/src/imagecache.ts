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
 *
 * Blob-URL lifecycle: each `loadImageElement` creates one object URL and
 * revokes it immediately after the element's `onload` fires (the decoded
 * bitmap is owned by the element from that point; the URL is no longer
 * needed). This closes a per-paste leak that would otherwise accumulate
 * over a long session.
 */

interface InFlightLoad {
  promise: Promise<HTMLImageElement>
  /** Set to true if `evictImageElement` is called while the load is in
   *  flight. The `onload` handler reads this and discards the result so
   *  an evicted load doesn't repopulate the cache. */
  cancelled: boolean
}

const elementByBlobRef = new Map<string, HTMLImageElement>()
const loadByBlobRef = new Map<string, InFlightLoad>()

/**
 * Resolve a Blob into a decoded HTMLImageElement, caching the result.
 * Repeated calls with the same blobRef short-circuit: a second prefetch
 * call before the first completes shares the in-flight Promise.
 */
export function loadImageElement(blobRef: string, blob: Blob): Promise<HTMLImageElement> {
  const ready = elementByBlobRef.get(blobRef)
  if (ready?.complete && ready.naturalWidth > 0) return Promise.resolve(ready)

  const inFlight = loadByBlobRef.get(blobRef)
  if (inFlight) return inFlight.promise

  const url = URL.createObjectURL(blob)
  const el = new Image()
  el.decoding = 'async'

  const entry: InFlightLoad = {
    promise: undefined as unknown as Promise<HTMLImageElement>,
    cancelled: false,
  }
  entry.promise = new Promise<HTMLImageElement>((resolve, reject) => {
    el.onload = (): void => {
      // Always revoke — the bitmap is now owned by the element. Keeps the
      // browser from pinning the underlying blob bytes for the lifetime
      // of the page.
      URL.revokeObjectURL(url)
      loadByBlobRef.delete(blobRef)
      if (entry.cancelled) {
        // Caller evicted while we were decoding. Discard the result so
        // we don't end up with a stale cache entry that bypasses the
        // eviction.
        reject(new Error(`Image load cancelled for blobRef=${blobRef}`))
        return
      }
      elementByBlobRef.set(blobRef, el)
      resolve(el)
    }
    el.onerror = (): void => {
      URL.revokeObjectURL(url)
      loadByBlobRef.delete(blobRef)
      reject(new Error(`Failed to decode image for blobRef=${blobRef}`))
    }
    el.src = url
  })

  loadByBlobRef.set(blobRef, entry)
  return entry.promise
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
 * Drop a cache entry. Safe to call when an in-flight load exists — the
 * load is marked cancelled and the element it produces is discarded.
 * Used by hard-delete (compaction) and by clear-board.
 */
export function evictImageElement(blobRef: string): void {
  // No object-URL revocation needed here for the element — we revoke
  // inside `onload`/`onerror` immediately, so a cached element's `el.src`
  // already points to a revoked URL. Just drop the map entries.
  elementByBlobRef.delete(blobRef)
  const inFlight = loadByBlobRef.get(blobRef)
  if (inFlight) inFlight.cancelled = true
}

/** Test / HMR utility — drops all cache state. Marks any in-flight loads
 *  cancelled. Not called in production code paths; HMR teardown invokes
 *  it to keep the dev-server memory profile honest. */
export function _clearImageCache(): void {
  elementByBlobRef.clear()
  for (const entry of loadByBlobRef.values()) entry.cancelled = true
  loadByBlobRef.clear()
}
