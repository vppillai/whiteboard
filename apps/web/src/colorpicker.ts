/**
 * Color picker popover. Compact 5×2 swatch grid.
 *
 * The first swatch is the theme `ink` token (always available); the rest are
 * curated accents picked to read on both light and dark backgrounds. Clicking
 * a swatch sets the brush color and dismisses the popover unless the user has
 * pinned it for sustained color picking.
 */

import { type Popover, showPopover } from './popover'
import { getColor, onChange, setColor } from './settings'

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

  // Boxed reference so swatch onClicks can reach the Popover instance after
  // it's created (showPopover is what produces it, but the swatches are
  // attached to its content first).
  const popoverRef: { current?: Popover } = {}

  for (const c of PALETTE) {
    palette.appendChild(
      makeSwatch(c, () => {
        setColor(c)
        popoverRef.current?.noteSelection()
      }),
    )
  }

  const syncActive = (): void => {
    const cur = getColor()
    for (const sw of root.querySelectorAll<HTMLElement>('.whiteboard-color-swatch')) {
      sw.classList.toggle('active', sw.dataset.color === cur)
    }
  }
  syncActive()

  const unsubscribe = onChange(syncActive)

  popoverRef.current = showPopover({
    anchor: at,
    title: 'color',
    content: root,
    tag: 'color',
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
