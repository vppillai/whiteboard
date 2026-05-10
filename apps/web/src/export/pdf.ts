/**
 * PDF export. Lazy-imports `jspdf` so non-PDF users never load the
 * ~70 KB gz library. v1 embeds a rasterized PNG via pdf.addImage; SVG-
 * native vector embedding is an out-of-scope follow-up (spec § 9).
 *
 * Page size = bounds (no fixed paper format); orientation chosen from
 * the aspect ratio.
 */

import type { Stroke } from '@whiteboard/shared'
import type { SettingsV1 } from '../settings'
import type { Bounds } from './bounds'
import { exportPNG } from './png'

export async function exportPDF(
  strokes: Stroke[],
  bounds: Bounds,
  settings: SettingsV1,
): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const png = await exportPNG(strokes, bounds, settings)
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
