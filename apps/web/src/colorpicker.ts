/**
 * Color picker popover. Compact 5×2 swatch grid plus a "recent" row.
 *
 * The first swatch is the theme `ink` token (always available); the rest are
 * curated accents picked to read on both light and dark backgrounds. Clicking
 * a swatch sets the brush color and dismisses the popover unless the user has
 * pinned it for sustained color picking.
 */

import { type Popover, showPopover } from './popover'
import { getColor, getSettings, onChange, setColor } from './settings'

const PALETTE: readonly string[] = [
  'ink',
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
  '#6b7280', // gray
]

export function openColorPicker(at: { x: number; y: number }): Popover {
  const root = document.createElement('div')
  root.className = 'whiteboard-color-picker'

  const palette = document.createElement('div')
  palette.className = 'whiteboard-color-palette'
  root.appendChild(palette)

  const recentSection = document.createElement('div')
  recentSection.className = 'whiteboard-color-recent'
  root.appendChild(recentSection)

  // Boxed reference so swatch onClicks can reach the Popover instance after
  // it's created (showPopover is what produces it, but the swatches are
  // attached to its content first).
  const popoverRef: { current?: Popover } = {}

  const renderPalette = (): void => {
    palette.replaceChildren(
      ...PALETTE.map((c) =>
        makeSwatch(c, () => {
          setColor(c)
          popoverRef.current?.noteSelection()
        }),
      ),
    )
    syncActive()
  }

  const renderRecent = (): void => {
    recentSection.replaceChildren()
    const recents = getSettings().recentColors
    if (recents.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'whiteboard-color-recent-empty'
      empty.textContent = 'recent colors will appear here'
      recentSection.appendChild(empty)
      return
    }
    const label = document.createElement('div')
    label.className = 'whiteboard-popover-section-label'
    label.textContent = 'recent'
    recentSection.appendChild(label)

    const list = document.createElement('div')
    list.className = 'whiteboard-color-recent-list'
    for (const c of recents) {
      list.appendChild(
        makeSwatch(c, () => {
          setColor(c)
          popoverRef.current?.noteSelection()
        }),
      )
    }
    recentSection.appendChild(list)
    syncActive()
  }

  const syncActive = (): void => {
    const cur = getColor()
    for (const sw of root.querySelectorAll<HTMLElement>('.whiteboard-color-swatch')) {
      sw.classList.toggle('active', sw.dataset.color === cur)
    }
  }

  renderPalette()
  renderRecent()

  const unsubscribe = onChange(() => {
    syncActive()
    renderRecent()
  })

  popoverRef.current = showPopover({
    anchor: at,
    title: 'color',
    content: root,
    onDismiss: unsubscribe,
  })

  return popoverRef.current
}

function makeSwatch(color: string, onClick: () => void): HTMLButtonElement {
  const sw = document.createElement('button')
  sw.type = 'button'
  sw.className = 'whiteboard-color-swatch'
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
