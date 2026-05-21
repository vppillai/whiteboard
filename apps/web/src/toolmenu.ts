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
 *   TOOL   [Draw | Text | Eraser | Select | Laser]
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

import {
  iconClear,
  iconEraser,
  iconExport,
  iconFitView,
  iconGrid,
  iconLaser,
  iconPen,
  iconResetZoom,
  iconSelect,
  iconSettings,
  iconShape,
  iconText,
} from './menu-icons'
import { fullItem, pill, pillRow, sectionLabel, separator } from './menu-ui'
import { openOptionsMenu } from './optionsmenu'
import { type Popover, showPopover } from './popover'
import { onChange } from './settings'
import type { Tool, ToolId } from './tools'

interface ToolDef {
  id: ToolId
  label: string
  icon: () => SVGElement
  shortcut: string
  enabled: boolean
}

// Right-click tool order — user-requested grouping: input verbs first
// (pen, text, shape), then mark-removal (eraser), then selection /
// transform (select). Laser sits at the end as a presentation accent.
// Per the v1.4 menu-icon pass, every tool button shows just its icon;
// hover-tooltip reveals "Draw (B)" / "Shape (R/O/A/L)" / etc.
const TOOLS: readonly ToolDef[] = [
  { id: 'pen', label: 'Draw', icon: iconPen, shortcut: 'B', enabled: true },
  { id: 'text', label: 'Text', icon: iconText, shortcut: 'T', enabled: true },
  { id: 'shape', label: 'Shape', icon: iconShape, shortcut: 'R · O · A · L', enabled: true },
  { id: 'eraser', label: 'Eraser', icon: iconEraser, shortcut: 'Shift+E', enabled: true },
  { id: 'select', label: 'Select', icon: iconSelect, shortcut: 'V / S', enabled: true },
  { id: 'laser', label: 'Laser', icon: iconLaser, shortcut: 'P', enabled: true },
]

/** Tool buttons are split into two equal rows so the 6 wide pills don't
 *  feel cramped — 3 + 3 with 2× the per-pill area. v1.4 layout pass. */
const TOOLS_PER_ROW = 3

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
      // Pass `rebuild` (rebuilds the menu content in place — used after
      // sub-popover actions like the swatch-add flow that mutate state
      // the menu reads from) and `anchor` (so the tool can open sub-
      // popovers at the same client coords as the parent menu).
      activeTool.renderContextualMenu(root, onAction, rebuildContent, opts.at)
    }

    // TOOL section — icon pills in 2 rows of 3 so each tool gets a
    // generous tap target. Hover-tooltip reveals "Draw (B)" etc. Per
    // the v1.4 menu-icon pass: icon-only, name + shortcut on hover.
    if (root.childNodes.length > 0) root.appendChild(separator())
    root.appendChild(sectionLabel('Tool'))
    for (let i = 0; i < TOOLS.length; i += TOOLS_PER_ROW) {
      const row = pillRow()
      const slice = TOOLS.slice(i, i + TOOLS_PER_ROW)
      for (const t of slice) {
        row.appendChild(
          pill({
            label: t.label,
            icon: t.icon(),
            shortcut: t.shortcut,
            title: t.enabled ? undefined : `${t.label} — coming soon`,
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
      root.appendChild(row)
    }

    // VIEW section — icon pills with hover tooltips for zoom and grid.
    root.appendChild(separator())
    root.appendChild(sectionLabel('View'))
    const viewRow = pillRow()
    viewRow.appendChild(
      pill({
        label: 'Reset zoom',
        icon: iconResetZoom(),
        shortcut: '⌘0',
        onClick: () => {
          opts.onResetZoom()
          onAction()
        },
      }),
    )
    viewRow.appendChild(
      pill({
        label: 'Fit to view',
        icon: iconFitView(),
        shortcut: '⌘1',
        onClick: () => {
          opts.onZoomToFit()
          onAction()
        },
      }),
    )
    viewRow.appendChild(
      pill({
        label: 'Grid options',
        icon: iconGrid(),
        onClick: () => {
          // Grid… opens another popover. Multi-popover coexistence
          // (popover.ts) means same-tag-replaces, different-tag-
          // coexists, so a pinned tools menu survives the Grid open
          // (different tag). Use onAction so this menu stays pinned
          // if the user pinned it.
          openOptionsMenu(opts.at)
          onAction()
        },
      }),
    )
    root.appendChild(viewRow)

    // EXPORT / SETTINGS / CLEAR rows — use the full-item helper's icon
    // variant: left icon, label center, shortcut right-aligned and dim.
    // Reads as a familiar app-menu list rather than a row of pills, and
    // the names stay legible (export / settings / clear aren't intuitive
    // from icon alone).
    root.appendChild(separator())
    root.appendChild(
      fullItem({
        label: 'Export…',
        icon: iconExport(),
        shortcut: '⌘E',
        onClick: () => {
          // Export… opens another popover. Same coexistence rules as
          // Grid… above — pinned tools menu survives via different tag.
          opts.onExport()
          onAction()
        },
      }),
    )

    root.appendChild(separator())
    root.appendChild(
      fullItem({
        label: 'Settings…',
        icon: iconSettings(),
        shortcut: '⌘,',
        onClick: () => {
          opts.togglePanel()
          onAction()
        },
      }),
    )

    // Destructive — at the bottom, separated.
    root.appendChild(separator())
    root.appendChild(
      fullItem({
        label: 'Clear board…',
        icon: iconClear(),
        shortcut: '⌘⇧K',
        onClick: () => {
          opts.onClear()
          onAction()
        },
      }),
    )
  }

  const rebuildContent = (): void => {
    root.replaceChildren()
    buildContent()
  }

  buildContent()

  // Live refresh: any settings change (custom-swatch add / delete,
  // brush color cycle, theme, grid options the menu shows) rebuilds
  // the menu so the user sees the change without dismissing /
  // reopening. v1.4 fix: pre-v1.4 the menu's content was a static
  // snapshot taken at open time, so adding a custom color while the
  // menu was pinned didn't show the new swatch until another menu
  // action triggered a rebuild. The subscription is torn down via
  // the popover's onDismiss callback so leaks are bounded.
  const settingsUnsub = onChange(rebuildContent)

  // Pin state persistence (v1.4): restore the user's last pin choice
  // from sessionStorage so right-click → pin stays sticky across menu
  // closes within the same tab session. sessionStorage scopes the
  // preference to this tab; closing the tab resets to unpinned.
  popoverRef.current = showPopover({
    anchor: opts.at,
    title: 'tools',
    content: root,
    tag: 'tools',
    pinned: readPersistedPinned(),
    onPinnedChange: (pinned) => {
      writePersistedPinned(pinned)
      // On pin, snapshot the current anchor (the click point that
      // opened this menu) so a future page-refresh can re-open here.
      if (pinned) writePersistedAnchor(opts.at)
    },
    // When the user drags a pinned menu, persist the new position so a
    // page refresh restores it where they put it (was: re-opened at the
    // original click point, ignoring the drag).
    onAnchorChange: (at) => {
      if (popoverRef.current?.isPinned()) writePersistedAnchor(at)
    },
    onDismiss: settingsUnsub,
  })
  // Expose a rebuild hook so external state changes (tool switch via
  // keymap / double-Esc) can refresh the menu's contextual section
  // without forcing the user to re-open it. v1.4.
  popoverRef.current.rebuild = rebuildContent
  return popoverRef.current
}

const PINNED_STORAGE_KEY = 'whiteboard:toolmenu-pinned'
const ANCHOR_STORAGE_KEY = 'whiteboard:toolmenu-anchor'

/** Pin state lives in localStorage so the preference survives browser
 *  restarts — the user explicitly asked for cross-session persistence,
 *  not just per-tab. Anchor (the original click point) is stored
 *  alongside so a page refresh can re-open the pinned menu where the
 *  user last had it. */
function readPersistedPinned(): boolean {
  try {
    return localStorage.getItem(PINNED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writePersistedPinned(pinned: boolean): void {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, pinned ? 'true' : 'false')
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

function writePersistedAnchor(anchor: { x: number; y: number }): void {
  try {
    localStorage.setItem(ANCHOR_STORAGE_KEY, JSON.stringify(anchor))
  } catch {
    // ignore storage failures
  }
}

/** Read the persisted anchor. Returns null if absent or malformed. */
export function readPersistedAnchor(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(ANCHOR_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { x?: unknown }).x === 'number' &&
      typeof (parsed as { y?: unknown }).y === 'number'
    ) {
      return { x: (parsed as { x: number }).x, y: (parsed as { y: number }).y }
    }
    return null
  } catch {
    return null
  }
}

/** Convenience for the boot path: returns the anchor to re-open the
 *  menu at if (and only if) the previous session left it pinned.
 *  Null when there's nothing to restore. */
export function getPersistedPinnedAnchor(): { x: number; y: number } | null {
  if (!readPersistedPinned()) return null
  return readPersistedAnchor()
}
