/**
 * Tool menu — opens on right-click (or pen barrel-button mapped to right-
 * click). Designed for fully pen-only operation: tap a swatch to apply a
 * color, tap a tool to switch tools, tap an action to run it. The menu then
 * dismisses automatically.
 *
 * Layout:
 *   [color swatches grid]
 *   ─────
 *   [Pen | Eraser | Laser | Text]   tool pills (only Pen is enabled today)
 *   ─────
 *   Reset zoom       (back to the canonical origin at scale 1)
 *   Grid options…    (opens sub-popover)
 *   ─────
 *   Clear board…     (raises the clickable confirmation toast)
 *
 * Tool pills for Eraser / Laser / Text are placeholder-disabled today so the
 * surface is laid out before they're built. They'll enable as their backing
 * implementations land (eraser at M1; laser & text on the backlog).
 *
 * Undo / redo intentionally aren't in this menu — they're well-served by
 * keyboard (⌘/Ctrl+Z) and putting them here added clutter without earning
 * its place.
 */

import { openOptionsMenu } from './optionsmenu'
import { type Popover, showPopover } from './popover'
import { getColor, setColor } from './settings'

const PALETTE: readonly string[] = [
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

interface ToolDef {
  id: 'pen' | 'eraser' | 'laser' | 'text'
  label: string
  enabled: boolean
  active: boolean
}

const TOOLS: readonly ToolDef[] = [
  { id: 'pen', label: 'Pen', enabled: true, active: true },
  { id: 'eraser', label: 'Eraser', enabled: false, active: false },
  { id: 'laser', label: 'Laser', enabled: false, active: false },
  { id: 'text', label: 'Text', enabled: false, active: false },
]

export interface ToolMenuOptions {
  at: { x: number; y: number }
  onResetZoom: () => void
  onClear: () => void
}

export function openToolMenu(opts: ToolMenuOptions): Popover {
  const root = document.createElement('div')
  root.className = 'whiteboard-tools'

  const popoverRef: { current?: Popover } = {}
  const dismiss = (): void => popoverRef.current?.dismiss()

  // ---- Colors ---------------------------------------------------------
  const palette = document.createElement('div')
  palette.className = 'whiteboard-tools-palette'
  for (const c of PALETTE) {
    palette.appendChild(
      swatch(c, () => {
        setColor(c)
        dismiss()
      }),
    )
  }
  root.appendChild(palette)

  // ---- Tools ----------------------------------------------------------
  root.appendChild(separator())
  const toolsRow = document.createElement('div')
  toolsRow.className = 'whiteboard-tools-row'
  for (const t of TOOLS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'whiteboard-tool-pill'
    if (t.active) btn.classList.add('active')
    if (!t.enabled) {
      btn.classList.add('disabled')
      btn.disabled = true
      btn.title = 'Coming soon'
    }
    btn.textContent = t.label
    // (No click handler today — only pen exists, and it's already active.)
    toolsRow.appendChild(btn)
  }
  root.appendChild(toolsRow)

  // ---- View / settings ------------------------------------------------
  root.appendChild(separator())
  root.appendChild(
    fullItem('Reset zoom', () => {
      dismiss()
      opts.onResetZoom()
    }),
  )
  root.appendChild(
    fullItem('Grid options…', () => {
      dismiss()
      openOptionsMenu(opts.at)
    }),
  )

  // ---- Clear ---------------------------------------------------------
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

function swatch(color: string, onClick: () => void): HTMLButtonElement {
  const sw = document.createElement('button')
  sw.type = 'button'
  sw.className = 'whiteboard-color-swatch whiteboard-color-swatch-small'
  sw.dataset.color = color
  sw.title = color === 'ink' ? 'theme ink' : color
  sw.setAttribute('aria-label', sw.title)
  if (color === 'ink') sw.classList.add('whiteboard-color-swatch-ink')
  else sw.style.background = color
  if (getColor() === color) sw.classList.add('active')
  sw.addEventListener('click', onClick)
  return sw
}

function pill(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'whiteboard-tool-pill'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}

function fullItem(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'whiteboard-tool-item'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}

function separator(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'whiteboard-tool-sep'
  return el
}
