/**
 * Color picker popover. Integrated grid: curated palette + custom swatches
 * (with distinguishing 1.5px ring) + "+" tile + recent colors row.
 *
 * Custom swatches are added via the "+" tile, which opens a sub-popover
 * containing the swatchadd.ts UI. Full management (delete, reorder) lives
 * in the side panel's Custom swatches section.
 */

import { type Popover, dismissAllPopovers, showPopover } from './popover'
import {
  getColor,
  getCustomSwatches,
  getRecentColors,
  onChange,
  pushRecentColor,
  setColor,
} from './settings'
import { createSwatchAdd } from './swatchadd'

const CURATED: readonly string[] = [
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
    for (const c of CURATED) {
      palette.appendChild(makeSwatch(c, false, () => onPick(c)))
    }
    for (const c of getCustomSwatches()) {
      palette.appendChild(makeSwatch(c, true, () => onPick(c)))
    }
    palette.appendChild(makeAddTile(() => openSwatchAddSubpopover()))
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
      recentRow.appendChild(makeSwatch(c, false, () => onPick(c), true))
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
    const wasPinned = popoverRef.current?.isPinned() ?? false
    const subRoot = createSwatchAdd({
      onAdded: () => {
        dismissAllPopovers()
        const next = openColorPicker(at)
        next.setPinned(wasPinned)
      },
      onCancel: () => {
        dismissAllPopovers()
        const next = openColorPicker(at)
        next.setPinned(wasPinned)
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

function makeSwatch(
  color: string,
  isCustom: boolean,
  onClick: () => void,
  isRecent = false,
): HTMLButtonElement {
  const sw = document.createElement('button')
  sw.type = 'button'
  sw.className = 'whiteboard-color-swatch'
  if (isCustom) sw.classList.add('whiteboard-color-swatch-custom')
  if (isRecent) sw.classList.add('whiteboard-color-swatch-recent')
  sw.dataset.color = color
  sw.title = color === 'ink' ? 'theme ink' : color
  sw.setAttribute('aria-label', sw.title)

  if (color === 'ink') {
    sw.classList.add('whiteboard-color-swatch-ink')
  } else {
    sw.style.background = color
  }

  sw.addEventListener('click', onClick)
  return sw
}

function makeAddTile(onClick: () => void): HTMLButtonElement {
  const tile = document.createElement('button')
  tile.type = 'button'
  tile.className = 'whiteboard-color-swatch whiteboard-color-swatch-add'
  tile.title = 'Add custom color'
  tile.setAttribute('aria-label', 'Add custom color')
  tile.textContent = '+'
  tile.addEventListener('click', onClick)
  return tile
}
