/**
 * Right-click tool menu. Thin dispatcher: hosts the active tool's contextual
 * section (which the tool itself builds), then the static TOOL / VIEW /
 * CLEAR sections below.
 *
 * Designed for fully pen-only operation: tap to select, menu dismisses.
 *
 * Layout:
 *
 *   [active tool's contextual section]   ← e.g. COLOR + BRUSH for Draw,
 *                                          ERASER for Eraser, etc.
 *   ─
 *   TOOL   [Draw | Eraser | Lasso | Laser | Text]
 *   ─
 *   VIEW   [Reset zoom · Fit to view · Grid options…]
 *   ─
 *   Clear board…
 */

import { fullItem, pill, pillRow, sectionLabel, separator } from './menu-ui'
import { openOptionsMenu } from './optionsmenu'
import { type Popover, showPopover } from './popover'
import type { Tool, ToolId } from './tools'

interface ToolDef {
  id: ToolId
  label: string
  enabled: boolean
}

const TOOLS: readonly ToolDef[] = [
  { id: 'pen', label: 'Draw', enabled: true },
  { id: 'eraser', label: 'Eraser', enabled: true },
  { id: 'lasso', label: 'Lasso', enabled: true },
  { id: 'laser', label: 'Laser', enabled: false },
  { id: 'text', label: 'Text', enabled: false },
]

export interface ToolMenuOptions {
  at: { x: number; y: number }
  /** The currently-active tool. Its `renderContextualMenu` (if any) is what
   *  builds the menu's first section. */
  getActiveTool: () => Tool
  onSelectTool: (id: ToolId) => void
  onResetZoom: () => void
  onZoomToFit: () => void
  onClear: () => void
  /** Toggle the settings side panel — wired by main.ts to the same flow as
   *  the Cmd/Ctrl+, shortcut and the toolpill gear. */
  togglePanel: () => void
  /** Open the export popover (scope + format). Wired by main.ts to
   *  `openExportPopover` at the right-click anchor. Single entry point so
   *  scope choice is consistent with Cmd/Ctrl+E. */
  onExport: () => void
}

export function openToolMenu(opts: ToolMenuOptions): Popover {
  const root = document.createElement('div')
  root.className = 'whiteboard-tools'

  const popoverRef: { current?: Popover } = {}
  const dismiss = (): void => popoverRef.current?.dismiss()

  // Active tool's contextual section comes first (closest to the cursor).
  const activeTool = opts.getActiveTool()
  if (activeTool.renderContextualMenu) {
    activeTool.renderContextualMenu(root, dismiss)
  }

  // TOOL row.
  if (root.childNodes.length > 0) root.appendChild(separator())
  root.appendChild(sectionLabel('Tool'))
  const toolsRow = pillRow()
  for (const t of TOOLS) {
    toolsRow.appendChild(
      pill({
        label: t.label,
        title: t.enabled ? undefined : 'Coming soon',
        active: t.id === activeTool.id,
        disabled: !t.enabled,
        onClick: t.enabled
          ? () => {
              opts.onSelectTool(t.id)
              dismiss()
            }
          : undefined,
      }),
    )
  }
  root.appendChild(toolsRow)

  // VIEW section — pen-friendly pills, matching the TOOL / BRUSH rows.
  root.appendChild(separator())
  root.appendChild(sectionLabel('View'))
  const viewRow = pillRow()
  viewRow.appendChild(
    pill({
      label: 'Reset zoom',
      onClick: () => {
        dismiss()
        opts.onResetZoom()
      },
    }),
  )
  viewRow.appendChild(
    pill({
      label: 'Fit to view',
      onClick: () => {
        dismiss()
        opts.onZoomToFit()
      },
    }),
  )
  viewRow.appendChild(
    pill({
      label: 'Grid…',
      title: 'Grid options',
      onClick: () => {
        dismiss()
        openOptionsMenu(opts.at)
      },
    }),
  )
  root.appendChild(viewRow)

  // EXPORT row — single pill that opens the export popover (scope + format).
  // Symmetric with Cmd/Ctrl+E. M2 § 6.7.6 + feel-test pass: removed the
  // three-format quick row because it bypassed the scope choice; one path
  // now handles both scope ('Visible' / 'All') and format consistently.
  root.appendChild(separator())
  root.appendChild(sectionLabel('Export'))
  const exportRow = pillRow()
  exportRow.appendChild(
    pill({
      label: 'Export…',
      onClick: () => {
        dismiss()
        opts.onExport()
      },
    }),
  )
  root.appendChild(exportRow)

  // Settings — pen-friendly entry point matching the toolpill gear and the
  // Cmd/Ctrl+, shortcut. Above CLEAR so the destructive row stays anchored
  // at the bottom.
  root.appendChild(separator())
  root.appendChild(
    fullItem('Settings…', () => {
      dismiss()
      opts.togglePanel()
    }),
  )

  // Destructive — at the bottom, separated.
  root.appendChild(separator())
  root.appendChild(
    fullItem('Clear board…', () => {
      dismiss()
      opts.onClear()
    }),
  )

  popoverRef.current = showPopover({
    anchor: opts.at,
    title: 'tools',
    content: root,
    tag: 'tools',
  })
  return popoverRef.current
}
