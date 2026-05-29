/**
 * Export dispatcher. Single entry point for the toolmenu EXPORT row and the
 * Cmd/Ctrl+E popover. Computes bounds, dispatches to png / svg / pdf,
 * triggers a programmatic <a download> click.
 *
 * Empty board (computeBoardBounds returns null) calls `opts.onEmptyBoard` —
 * callers use this to surface a "Nothing to export" toast instead of
 * exporting a blank canvas.
 */

import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import type { Camera } from '../camera'
import type { ImageStore } from '../imagestore'
import { getSettings } from '../settings'
import { type Bounds, computeBoardBounds, computeViewportBounds } from './bounds'
import { exportPDF } from './pdf'
import { exportPNG } from './png'
import { exportSVG, type ImageDataUriMap } from './svg'

export type ExportFormat = 'png' | 'svg' | 'pdf'
/** Scope of the export — the bounding rectangle in board space. */
export type ExportScope = 'visible' | 'all'

export interface ExportOptions {
  getStrokes: () => Stroke[]
  /** Optional. Callers wired in v1 supply images and an imageStore so
   *  exports include them; backward-compatible default = no images. */
  getImages?: () => readonly ImageObject[]
  imageStore?: ImageStore | null
  /** Optional. Wired in v1.2 — text objects are rendered above images
   *  and below strokes. Empty default keeps prior callers compatible. */
  getTexts?: () => readonly TextObject[]
  /** Optional. Wired in v1.4 — shape objects render above texts and
   *  below strokes. Empty default keeps prior callers compatible. */
  getShapes?: () => readonly ShapeObject[]
  /** For scope === 'visible'. */
  camera: Camera
  viewportWidth: number
  viewportHeight: number
  onEmptyBoard?: () => void
  /** Fired after the download has been triggered with the chosen format
   *  ('png' | 'svg' | 'pdf') so callers can surface a confirmation toast. */
  onSuccess?: (format: ExportFormat) => void
  /** Fired if the export throws (renderer failure, image decode / file-read
   *  error). The happy path fires `onSuccess` instead; callers surface a
   *  failure toast so a silently-dismissed popover can't read as success. */
  onError?: (format: ExportFormat, err: unknown) => void
}

export async function exportBoard(
  format: ExportFormat,
  scope: ExportScope,
  opts: ExportOptions,
): Promise<void> {
  try {
    const strokes = opts.getStrokes()
    const images = opts.getImages?.() ?? []
    const texts = opts.getTexts?.() ?? []
    const shapes = opts.getShapes?.() ?? []
    const bounds =
      scope === 'visible'
        ? computeViewportBounds(opts.camera, opts.viewportWidth, opts.viewportHeight)
        : computeBoardBounds(strokes, images, texts, shapes)
    if (!bounds) {
      if (opts.onEmptyBoard) opts.onEmptyBoard()
      else console.warn('whiteboard/export: nothing to export')
      return
    }
    const snap = getSettings()
    const blob = await renderFormat(
      format,
      strokes,
      images,
      texts,
      shapes,
      opts.imageStore ?? null,
      bounds,
      snap,
    )
    triggerDownload(blob, filename(format))
    opts.onSuccess?.(format)
  } catch (err) {
    // Wrap the whole body so a synchronous getter throw OR a renderer
    // rejection surfaces to the caller instead of becoming an unhandled
    // promise rejection. The popover dismisses regardless of outcome, so
    // without this a failed export silently reads as success. onSuccess
    // stays on the happy path above, never in this catch.
    console.error('whiteboard/export: failed', err)
    opts.onError?.(format, err)
  }
}

async function renderFormat(
  format: ExportFormat,
  strokes: Stroke[],
  images: readonly ImageObject[],
  texts: readonly TextObject[],
  shapes: readonly ShapeObject[],
  imageStore: ImageStore | null,
  bounds: Bounds,
  snap: ReturnType<typeof getSettings>,
): Promise<Blob> {
  switch (format) {
    case 'png':
      return exportPNG(strokes, images, texts, shapes, bounds, snap, imageStore)
    case 'svg': {
      const dataUris = await buildImageDataUris(images, imageStore)
      return exportSVG(strokes, images, dataUris, texts, shapes, bounds, snap)
    }
    case 'pdf':
      return exportPDF(strokes, images, texts, shapes, bounds, snap, imageStore)
  }
}

async function buildImageDataUris(
  images: readonly ImageObject[],
  imageStore: ImageStore | null,
): Promise<ImageDataUriMap> {
  const map: ImageDataUriMap = new Map()
  if (!imageStore) return map
  await Promise.all(
    images
      .filter((i) => !i.deleted)
      .map(async (img) => {
        const blob = await imageStore.loadBlob(img.blobRef)
        if (!blob) return
        const dataUri = await blobToDataURL(blob)
        map.set(img.id, dataUri)
      }),
  )
  return map
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (): void => resolve(String(reader.result))
    reader.onerror = (): void => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

function filename(format: ExportFormat): string {
  const ts = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  // Include seconds so back-to-back exports within the same minute don't
  // overwrite each other (or trigger the browser's "(1)" disambiguator).
  const stamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
  return `whiteboard-${stamp}.${format}`
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke after a tick to ensure the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
