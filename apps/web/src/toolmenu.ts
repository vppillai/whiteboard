/**
 * Right-click tool menu. Thin dispatcher: hosts the active tool's contextual
 * section (which the tool itself builds), then the static TOOL / VIEW /
 * EXPORT / Settings / Clear sections below.
 *
 * Designed for fully pen-only operation: tap to select, menu dismisses.
 *
 * Layout:
 *
 *   [active tool's contextual section]   ← e.g. COLOR + BRUSH for Draw,
 *                                          ERASER for Eraser, etc.
 *   ─
 *   TOOL   [Draw | Text | Eraser | Lasso | Select | Laser]
 *   ─
 *   VIEW   [Reset zoom · Fit to view · Grid options…]
 *   ─
 *   EXPORT [Export…]                     ← opens the export popover
 *                                          (scope + format)
 *   ─
 *   Settings…                            ← opens the settings side panel
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

// Right-click tool order — user-requested grouping: input verbs first
// (pen, text), then mark-removal (eraser), then selection / transform
// (lasso, select). Laser sits at the end as a presentation accent.
const TOOLS: readonly ToolDef[] = [
  { id: 'pen', label: 'Draw', enabled: true },
  { id: 'text', label: 'Text', enabled: true },
  { id: 'eraser', label: 'Eraser', enabled: true },
  { id: 'lasso', label: 'Lasso', enabled: true },
  { id: 'select', label: 'Select', enabled: true },
  { id: 'laser', label: 'Laser', enabled: true },
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
  /** Pin-aware action handler for body pills (tool select, contextual
   *  menu choices, view actions, Settings).
   *
   *  - Unpinned: dismiss (current "menu disappears after one selection"
   *    behavior).
   *  - Pinned: rebuild the content so active-state highlights reflect
   *    the new state — e.g. switching tool with the menu pinned should
   *    show the new tool's pill as active, color swatches should reflect
   *    the new picked color, etc. The menu was previously a one-time
   *    snapshot at open time; with pinning, that snapshot froze the
   *    active-state visuals until the user re-opened the menu.
   *
   *  Rebuilding is cheap (a few DOM nodes) and only happens on user
   *  action — not per-frame. Position is preserved because we only
   *  replace the CONTENT div's children, not the popover wrapper. */
  const onAction = (): void => {
    if (popoverRef.current?.isPinned()) {
      rebuildContent()
    } else {
      dismiss()
    }
  }

  /** Build (or re-build) the menu's content into `root`. Reads
   *  `opts.getActiveTool()` and other live getters every call so the
   *  rendered state always reflects the current app state. */
  const buildContent = (): void => {
    // Active tool's contextual section comes first (closest to the
    // cursor). The contextual menu's selection clicks (color / font /
    // size / B/I/U) route through onAction so the active-state visuals
    // refresh on every click when pinned.
    const activeTool = opts.getActiveTool()
    if (activeTool.renderContextualMenu) {
      activeTool.renderContextualMenu(root, onAction)
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
                onAction()
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
          opts.onResetZoom()
          onAction()
        },
      }),
    )
    viewRow.appendChild(
      pill({
        label: 'Fit to view',
        onClick: () => {
          opts.onZoomToFit()
          onAction()
        },
      }),
    )
    viewRow.appendChild(
      pill({
        label: 'Grid…',
        title: 'Grid options',
        onClick: () => {
          // Grid… opens another popover; the single-instance rule will
          // replace this menu regardless of pin state. Use dismiss for
          // honesty.
          dismiss()
          openOptionsMenu(opts.at)
        },
      }),
    )
    root.appendChild(viewRow)

    // EXPORT row — single pill that opens the export popover (scope +
    // format). Symmetric with Cmd/Ctrl+E. M2 § 6.7.6 + feel-test pass:
    // removed the three-format quick row because it bypassed the scope
    // choice; one path now handles both scope ('Visible' / 'All') and
    // format consistently.
    root.appendChild(separator())
    root.appendChild(sectionLabel('Export'))
    const exportRow = pillRow()
    exportRow.appendChild(
      pill({
        label: 'Export…',
        onClick: () => {
          // Export… opens another popover — same dismiss-on-navigation
          // rationale as Grid… above.
          dismiss()
          opts.onExport()
        },
      }),
    )
    root.appendChild(exportRow)

    // Settings — pen-friendly entry point matching the toolpill gear
    // and the Cmd/Ctrl+, shortcut. Above CLEAR so the destructive row
    // stays anchored at the bottom. Opens a side panel (not a
    // popover), so a pinned tool menu can coexist — use onAction.
    root.appendChild(separator())
    root.appendChild(
      fullItem('Settings…', () => {
        opts.togglePanel()
        onAction()
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
  }

  const rebuildContent = (): void => {
    root.replaceChildren()
    buildContent()
  }

  buildContent()

  popoverRef.current = showPopover({
    anchor: opts.at,
    title: 'tools',
    content: root,
    tag: 'tools',
  })
  return popoverRef.current
}
