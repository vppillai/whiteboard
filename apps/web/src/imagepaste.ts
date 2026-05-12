/**
 * Image-paste flow. Three input paths converge on one PasteImage op:
 *
 *   - `Ctrl/Cmd+V` (via keymap) → navigator.clipboard.read()
 *   - Right-click → "Paste image" (via toolmenu) → navigator.clipboard.read()
 *   - Drag-drop a file onto the canvas → e.dataTransfer
 *
 * All three call `pasteImageFromBlob` with a board-space cursor position
 * and the context dependencies. Op coalescing isn't needed for paste
 * (one paste = one op); transform-image (move/resize) coalesces in the
 * Select tool, not here.
 *
 * Failure modes (unsupported MIME / oversize / decode error) surface as
 * a non-blocking toast. The handler is async but never throws — caller
 * fire-and-forgets.
 */

import type { ImageObject } from '@whiteboard/shared'
import { loadImageElement } from './imagecache'
import type { ImageStore } from './imagestore'
import type { Op } from './ops'

export const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
const ACCEPTED_SET = new Set<string>(ACCEPTED_IMAGE_MIME)

/** 25 MB. Reject larger images with a non-blocking toast. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export interface ImagePasteContext {
  imageStore: ImageStore
  /** Live in-memory image array. Pushes happen here on successful paste. */
  images: ImageObject[]
  /** Picks the next z slot above the current max. Each paste stacks above. */
  nextImageZ: () => number
  pushUndoOp: (op: Op) => void
  markDirty: () => void
  showInfoToast: (msg: string) => void
}

/**
 * Validate, decode, persist, and emit-an-op for a new pasted image.
 * The image's top-left lands at `cursorBoard`; size is natural pixel dims
 * (no auto-scaling — per design spec section 4).
 */
export async function pasteImageFromBlob(
  blob: Blob,
  cursorBoard: { x: number; y: number },
  ctx: ImagePasteContext,
): Promise<void> {
  if (!ACCEPTED_SET.has(blob.type)) {
    ctx.showInfoToast(`Unsupported image format (${blob.type || 'unknown'})`)
    return
  }
  if (blob.size > MAX_IMAGE_BYTES) {
    ctx.showInfoToast('Image too large — under 25 MB please')
    return
  }

  let natural: { w: number; h: number }
  try {
    natural = await getNaturalDims(blob)
  } catch {
    ctx.showInfoToast('Could not decode image')
    return
  }
  if (natural.w === 0 || natural.h === 0) {
    ctx.showInfoToast('Image has zero size')
    return
  }

  const id = makeImageId()
  const format = mimeToFormat(blob.type)
  if (!format) {
    // Belt-and-braces: ACCEPTED_SET check should already catch this.
    ctx.showInfoToast('Unsupported image format')
    return
  }
  const obj: ImageObject = {
    id,
    blobRef: id,
    format,
    natural,
    transform: { x: cursorBoard.x, y: cursorBoard.y, w: natural.w, h: natural.h },
    z: ctx.nextImageZ(),
    createdAt: Date.now(),
  }

  ctx.images.push(obj)

  try {
    await ctx.imageStore.insert(obj, blob)
    // Prime the runtime cache so render can pick it up immediately.
    // loadImageElement returns the decoded HTMLImageElement; we don't
    // await for it before pushing the undo op because the render loop
    // will pick up the cache entry on the next frame.
    void loadImageElement(id, blob).then(() => ctx.markDirty())
    ctx.pushUndoOp({ kind: 'paste-image', imageId: id })
    ctx.markDirty()
  } catch (err) {
    console.warn('whiteboard/web: failed to paste image:', err)
    // Roll back in-memory state to keep the two stores consistent on error.
    const idx = ctx.images.indexOf(obj)
    if (idx >= 0) ctx.images.splice(idx, 1)
    ctx.showInfoToast('Failed to save image')
  }
}

/**
 * Read the first image Blob from the async Clipboard API. Returns null
 * if the clipboard has no image, the API isn't available, or the user
 * denied permission. Used by the Ctrl+V and right-click paths.
 */
export async function readImageFromClipboard(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) return null
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      for (const mimeType of item.types) {
        if (ACCEPTED_SET.has(mimeType)) {
          return await item.getType(mimeType)
        }
      }
    }
  } catch {
    // Permission denied / no readable image / not in a user gesture, etc.
  }
  return null
}

/**
 * Read the first image Blob from a DataTransfer (used by the drag-drop
 * path). Tries `files` first (filesystem drop), then `items` (in-browser
 * drag). Returns null if no accepted image is present.
 */
export async function readImageFromDataTransfer(dt: DataTransfer): Promise<Blob | null> {
  for (const file of Array.from(dt.files)) {
    if (ACCEPTED_SET.has(file.type)) return file
  }
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file' && ACCEPTED_SET.has(item.type)) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return null
}

/**
 * Attach `dragover` + `drop` listeners on the canvas root. Returns a
 * cleanup function for the teardown registry.
 */
export function setupDragDropImagePaste(
  canvasEl: HTMLElement,
  toBoard: (clientX: number, clientY: number) => { x: number; y: number },
  ctx: ImagePasteContext,
): () => void {
  const onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer) return
    // preventDefault is REQUIRED for the drop event to fire — without it
    // the browser silently rejects the drop. We only prevent when an
    // image-typed file is actually in the drag, so non-image drags
    // continue to fall through normally.
    const hasImage = Array.from(e.dataTransfer.items).some(
      (it) => it.kind === 'file' && it.type.startsWith('image/'),
    )
    if (!hasImage) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (e: DragEvent): void => {
    if (!e.dataTransfer) return
    e.preventDefault()
    const boardCoords = toBoard(e.clientX, e.clientY)
    void readImageFromDataTransfer(e.dataTransfer).then((blob) => {
      if (blob) void pasteImageFromBlob(blob, boardCoords, ctx)
    })
  }

  canvasEl.addEventListener('dragover', onDragOver)
  canvasEl.addEventListener('drop', onDrop)
  return () => {
    canvasEl.removeEventListener('dragover', onDragOver)
    canvasEl.removeEventListener('drop', onDrop)
  }
}

function mimeToFormat(mime: string): ImageObject['format'] | null {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpeg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    default:
      return null
  }
}

async function getNaturalDims(blob: Blob): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = (): void => resolve()
      img.onerror = (): void => reject(new Error('decode failed'))
      img.src = url
    })
    return { w: img.naturalWidth, h: img.naturalHeight }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function makeImageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `img_${crypto.randomUUID()}`
  }
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
