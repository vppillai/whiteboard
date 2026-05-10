/**
 * Export dispatcher. Single entry point for the toolmenu EXPORT row and the
 * Cmd/Ctrl+E popover. Computes bounds, dispatches to png / svg / pdf,
 * triggers a programmatic <a download> click.
 *
 * Empty board (computeBoardBounds returns null) calls `opts.onEmptyBoard` —
 * callers use this to surface a "Nothing to export" toast instead of
 * exporting a blank canvas.
 */

import type { Stroke } from '@whiteboard/shared'
import { getSettings } from '../settings'
import { type Bounds, computeBoardBounds } from './bounds'
import { exportPDF } from './pdf'
import { exportPNG } from './png'
import { exportSVG } from './svg'

export type ExportFormat = 'png' | 'svg' | 'pdf'

export interface ExportOptions {
  getStrokes: () => Stroke[]
  onEmptyBoard?: () => void
}

export async function exportBoard(format: ExportFormat, opts: ExportOptions): Promise<void> {
  const strokes = opts.getStrokes()
  const bounds = computeBoardBounds(strokes)
  if (!bounds) {
    if (opts.onEmptyBoard) opts.onEmptyBoard()
    else console.warn('whiteboard/export: nothing to export')
    return
  }
  const snap = getSettings()
  const blob = await renderFormat(format, strokes, bounds, snap)
  triggerDownload(blob, filename(format))
}

async function renderFormat(
  format: ExportFormat,
  strokes: Stroke[],
  bounds: Bounds,
  snap: ReturnType<typeof getSettings>,
): Promise<Blob> {
  switch (format) {
    case 'png':
      return exportPNG(strokes, bounds, snap)
    case 'svg':
      return exportSVG(strokes, bounds, snap)
    case 'pdf':
      return exportPDF(strokes, bounds, snap)
  }
}

function filename(format: ExportFormat): string {
  const ts = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}`
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
