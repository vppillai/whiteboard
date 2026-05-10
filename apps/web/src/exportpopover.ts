/**
 * Cmd/Ctrl+E export popover. Anchored at the last-pointer position
 * (orchestrator tracks `lastPointer`). Three pills (PNG / SVG / PDF);
 * click triggers exportBoard + dismisses. Esc cancels via the existing
 * popover.ts single-instance arbitration.
 *
 * Symmetric with the right-click EXPORT row (toolmenu.ts, Task 17) — both
 * call exportBoard with the same getStrokes / onEmptyBoard hooks.
 */

import type { Stroke } from '@whiteboard/shared'
import { type ExportFormat, exportBoard } from './export'
import { type Popover, showPopover } from './popover'

export interface ExportPopoverOptions {
  anchor: { x: number; y: number }
  getStrokes: () => Stroke[]
  onEmptyBoard?: () => void
}

export function openExportPopover(opts: ExportPopoverOptions): Popover {
  const content = document.createElement('div')
  content.className = 'whiteboard-export-popover'

  const popoverRef: { current?: Popover } = {}

  for (const fmt of ['png', 'svg', 'pdf'] as ExportFormat[]) {
    const pill = document.createElement('button')
    pill.type = 'button'
    pill.className = 'whiteboard-settings-pill whiteboard-export-pill'
    pill.dataset.format = fmt
    pill.textContent = fmt.toUpperCase()
    pill.addEventListener('click', () => {
      void exportBoard(fmt, {
        getStrokes: opts.getStrokes,
        onEmptyBoard: opts.onEmptyBoard,
      })
      popoverRef.current?.dismiss()
    })
    content.appendChild(pill)
  }

  popoverRef.current = showPopover({
    anchor: opts.anchor,
    title: 'export',
    content,
    tag: 'export',
  })
  return popoverRef.current
}
