/**
 * Color picker popover. Integrated grid: curated palette + custom swatches
 * (with distinguishing 1.5px ring) + "+" tile + recent colors row.
 *
 * Custom swatches are added via the "+" tile, which opens a sub-popover
 * containing the swatchadd.ts UI. Full management (delete, reorder) lives
 * in the side panel's Custom swatches section.
 */

import { makeAddSwatchTile, makeColorSwatch } from './menu-ui'
import { findPopoverByTag, type Popover, showPopover } from './popover'
import {
  getColor,
  getCustomSwatches,
  getRecentColors,
  onChange,
  pushRecentColor,
  setColor,
} from './settings'
import { createSwatchAdd } from './swatchadd'
import { makeSwatchDeleteBadge } from './swatchpalette'

export const CURATED_COLORS: readonly string[] = [
  'ink',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#6b7280',
]

export function openColorPicker(at: { x: number; y: number }): Popover {
  const root = document.createElement('div')
  root.className = 'whiteboard-color-picker'

  const palette = document.createElement('div')
  palette.className = 'whiteboard-color-palette'
  root.appendChild(palette)

  const recentLabel = document.createElement('div')
  recentLabel.className = 'whiteboard-color-section-label'
  recentLabel.textContent = 'Recent'
  recentLabel.style.display = 'none' // shown if recents are non-empty
  root.appendChild(recentLabel)

  const recentRow = document.createElement('div')
  recentRow.className = 'whiteboard-color-recent-row'
  root.appendChild(recentRow)

  const popoverRef: { current?: Popover } = {}

  const renderPalette = (): void => {
    palette.replaceChildren()
    for (const c of CURATED_COLORS) {
      palette.appendChild(makeColorSwatch({ color: c, onClick: () => onPick(c) }))
    }
    for (const c of getCustomSwatches()) {
      // Custom swatches get a hover-revealed × delete badge — shared
      // factory in swatchpalette.ts so the badge's DOM, accessibility,
      // and event-suppression rules match the right-click menu version.
      const sw = makeColorSwatch({ color: c, custom: true, onClick: () => onPick(c) })
      sw.appendChild(makeSwatchDeleteBadge(c))
      palette.appendChild(sw)
    }
    palette.appendChild(makeAddSwatchTile({ onClick: () => openSwatchAddSubpopover() }))
    syncActive()
  }

  const renderRecent = (): void => {
    recentRow.replaceChildren()
    const recents = getRecentColors()
    if (recents.length === 0) {
      recentLabel.style.display = 'none'
      recentRow.style.display = 'none'
      return
    }
    recentLabel.style.display = ''
    recentRow.style.display = ''
    for (const c of recents) {
      recentRow.appendChild(makeColorSwatch({ color: c, recent: true, onClick: () => onPick(c) }))
    }
  }

  const onPick = (c: string): void => {
    setColor(c)
    if (c !== 'ink') pushRecentColor(c)
    popoverRef.current?.noteSelection()
  }

  const syncActive = (): void => {
    const cur = getColor()
    for (const sw of root.querySelectorAll<HTMLElement>('.whiteboard-color-swatch')) {
      sw.classList.toggle('active', sw.dataset.color === cur)
    }
  }

  const openSwatchAddSubpopover = (): void => {
    // Dismiss only the swatch-add subpopover; the parent color picker
    // stays open. Its `onChange` subscription auto-rebuilds the
    // palette so a newly-added swatch shows up immediately. Pre-v1.4
    // this path nuked all popovers and re-opened the picker, which
    // killed the pin and produced a visual flicker. v1.4 fix.
    const subRoot = createSwatchAdd({
      onAdded: () => {
        findPopoverByTag('swatch-add')?.dismiss()
      },
      onCancel: () => {
        findPopoverByTag('swatch-add')?.dismiss()
      },
    })
    showPopover({
      anchor: at,
      title: 'add color',
      content: subRoot,
      tag: 'swatch-add',
    })
  }

  const unsubscribe = onChange(() => {
    renderPalette()
    renderRecent()
  })

  renderPalette()
  renderRecent()

  popoverRef.current = showPopover({
    anchor: at,
    title: 'color',
    content: root,
    tag: 'color',
    onDismiss: unsubscribe,
  })

  return popoverRef.current
}

/**
 * Compute the next CURATED_COLORS index given the current color and direction.
 * Returns 0 if `current` isn't in the curated palette (custom / recent /
 * anything not in the list). Wraps around at the endpoints. The `'ink'`
 * theme token IS in CURATED_COLORS at index 0, so cycling away from ink
 * lands at index 1 or the last entry depending on direction.
 *
 * Pure function — unit-testable without DOM. M2 Shift+[ / Shift+] cycling.
 */
export function cyclePaletteIndex(current: string, direction: 1 | -1): number {
  const idx = CURATED_COLORS.indexOf(current)
  if (idx === -1) return 0
  const n = CURATED_COLORS.length
  return (idx + direction + n) % n
}
