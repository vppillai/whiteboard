/**
 * Cmd/Ctrl+E export popover. Two rows:
 *   - Scope: [Visible] [All]
 *   - Format: [PNG] [SVG] [PDF]
 * Scope is sticky for the popover session (defaults to 'all', the previous
 * single-choice behavior). Clicking a format pill triggers export at the
 * current scope and dismisses.
 *
 * Symmetric with the right-click EXPORT row (toolmenu.ts) but with the
 * scope choice — the right-click row defaults to 'all' for the quick path.
 */

import type { ImageObject, Stroke, TextObject } from '@whiteboard/shared'
import type { Camera } from './camera'
import { type ExportFormat, type ExportScope, exportBoard } from './export'
import type { ImageStore } from './imagestore'
import { type Popover, showPopover } from './popover'

export interface ExportPopoverOptions {
  anchor: { x: number; y: number }
  getStrokes: () => Stroke[]
  /** Optional — supply alongside `imageStore` if the board has pasted images. */
  getImages?: () => readonly ImageObject[]
  imageStore?: ImageStore | null
  /** Optional — supply for text objects (v1.2). */
  getTexts?: () => readonly TextObject[]
  camera: Camera
  viewportWidth: number
  viewportHeight: number
  onEmptyBoard?: () => void
  /** Fires after the file has been downloaded; callers surface a toast. */
  onSuccess?: (format: ExportFormat) => void
}

// Persist scope across popover opens within a session — sensible default
// matching the last user choice.
let lastScope: ExportScope = 'all'

export function openExportPopover(opts: ExportPopoverOptions): Popover {
  const content = document.createElement('div')
  content.className = 'whiteboard-export-popover'

  const popoverRef: { current?: Popover } = {}

  // Scope row.
  const scopeRow = document.createElement('div')
  scopeRow.className = 'whiteboard-export-row'
  content.appendChild(scopeRow)

  const scopeLabel = document.createElement('span')
  scopeLabel.className = 'whiteboard-export-row-label'
  scopeLabel.textContent = 'Region'
  scopeRow.appendChild(scopeLabel)

  const scopePills: HTMLButtonElement[] = []
  for (const sc of ['visible', 'all'] as ExportScope[]) {
    const pill = document.createElement('button')
    pill.type = 'button'
    pill.className = 'whiteboard-settings-pill whiteboard-export-scope-pill'
    pill.dataset.scope = sc
    pill.textContent = sc === 'visible' ? 'Visible' : 'All'
    if (sc === lastScope) pill.classList.add('active')
    pill.addEventListener('click', () => {
      lastScope = sc
      for (const p of scopePills) p.classList.toggle('active', p.dataset.scope === sc)
    })
    scopePills.push(pill)
    scopeRow.appendChild(pill)
  }

  // Format row.
  const formatRow = document.createElement('div')
  formatRow.className = 'whiteboard-export-row'
  content.appendChild(formatRow)

  const fmtLabel = document.createElement('span')
  fmtLabel.className = 'whiteboard-export-row-label'
  fmtLabel.textContent = 'Format'
  formatRow.appendChild(fmtLabel)

  for (const fmt of ['png', 'svg', 'pdf'] as ExportFormat[]) {
    const pill = document.createElement('button')
    pill.type = 'button'
    pill.className = 'whiteboard-settings-pill whiteboard-export-pill'
    pill.dataset.format = fmt
    pill.textContent = fmt.toUpperCase()
    pill.addEventListener('click', () => {
      void exportBoard(fmt, lastScope, {
        getStrokes: opts.getStrokes,
        getImages: opts.getImages,
        getTexts: opts.getTexts,
        imageStore: opts.imageStore,
        camera: opts.camera,
        viewportWidth: opts.viewportWidth,
        viewportHeight: opts.viewportHeight,
        onEmptyBoard: opts.onEmptyBoard,
        onSuccess: opts.onSuccess,
      })
      popoverRef.current?.dismiss()
    })
    formatRow.appendChild(pill)
  }

  popoverRef.current = showPopover({
    anchor: opts.anchor,
    title: 'export',
    content,
    tag: 'export',
  })
  return popoverRef.current
}
