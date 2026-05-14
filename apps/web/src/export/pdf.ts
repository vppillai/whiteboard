/**
 * PDF export. Lazy-imports `jspdf` so non-PDF users never load the
 * ~70 KB gz library. v1 embeds a rasterized PNG via pdf.addImage; SVG-
 * native vector embedding is an out-of-scope follow-up (spec § 9).
 *
 * Page size = bounds (no fixed paper format); orientation chosen from
 * the aspect ratio.
 */

import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import type { ImageStore } from '../imagestore'
import type { SettingsV1 } from '../settings'
import type { Bounds } from './bounds'
import { exportPNG } from './png'

export async function exportPDF(
  strokes: Stroke[],
  images: readonly ImageObject[],
  texts: readonly TextObject[],
  shapes: readonly ShapeObject[],
  bounds: Bounds,
  settings: SettingsV1,
  imageStore: ImageStore | null,
): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  // Render the embedded PNG at 2× DPR so the PDF rasterization is sharp
  // when zoomed or printed — 1× looked soft in the M2 feel-test. The PNG
  // path now includes images / texts / shapes, so the wrapped PDF
  // inherits all three for free.
  const png = await exportPNG(strokes, images, texts, shapes, bounds, settings, imageStore, {
    dpr: 2,
  })
  const dataUrl = await blobToDataURL(png)
  const orientation: 'l' | 'p' = bounds.width > bounds.height ? 'l' : 'p'
  const pdf = new jsPDF({
    orientation,
    unit: 'px',
    format: [bounds.width, bounds.height],
    compress: true,
  })
  pdf.addImage(dataUrl, 'PNG', 0, 0, bounds.width, bounds.height)
  return pdf.output('blob')
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}
