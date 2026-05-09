/**
 * Tool menu — opens on right-click (or pen barrel-button mapped to right-
 * click). Designed for fully pen-only operation: tap a swatch to apply a
 * color, tap a brush to select a preset, tap a tool to switch tools, tap a
 * view action to run it. The menu then dismisses automatically.
 *
 * Layout (sections labelled to keep the menu scannable as it grows):
 *
 *   COLOR
 *   [color swatches grid]
 *   ─
 *   BRUSH
 *   [Pen | Marker | Pencil | Hi | Brush]   brush preset pills
 *   ─
 *   TOOL
 *   [Draw | Eraser | Lasso | Laser | Text]  tool pills
 *   ─
 *   VIEW
 *   Reset zoom
 *   Fit to view
 *   Grid options…
 *   ─
 *   Clear board…
 *
 * Tool pills for Lasso / Laser / Text are placeholder-disabled today; they
 * enable as their backing implementations land.
 */

import { BRUSH_IDS, BRUSH_LABELS, type BrushId } from './brushes'
import { openOptionsMenu } from './optionsmenu'
import { type Popover, showPopover } from './popover'
import { type EraserSize, getColor, setColor } from './settings'
import type { ToolId } from './tools'

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
  id: ToolId
  label: string
  enabled: boolean
}

const TOOLS: readonly ToolDef[] = [
  { id: 'pen', label: 'Draw', enabled: true },
  { id: 'eraser', label: 'Eraser', enabled: true },
  { id: 'lasso', label: 'Lasso', enabled: false },
  { id: 'laser', label: 'Laser', enabled: false },
  { id: 'text', label: 'Text', enabled: false },
]

export interface ToolMenuOptions {
  at: { x: number; y: number }
  getActiveToolId: () => ToolId
  getActiveBrushId: () => BrushId
  getEraserSize: () => EraserSize
  onSelectTool: (id: ToolId) => void
  onSelectBrush: (id: BrushId) => void
  onSelectEraserSize: (size: EraserSize) => void
  onResetZoom: () => void
  onZoomToFit: () => void
  onClear: () => void
}

const ERASER_SIZE_PILLS: readonly { id: EraserSize; label: string }[] = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
]

export function openToolMenu(opts: ToolMenuOptions): Popover {
  const root = document.createElement('div')
  root.className = 'whiteboard-tools'

  const popoverRef: { current?: Popover } = {}
  const dismiss = (): void => popoverRef.current?.dismiss()

  // The contextual sections (COLOR + BRUSH for Draw, ERASER SIZE for Eraser,
  // etc.) come first so the user's eye lands on the most relevant controls.
  // The TOOL row is below them — switching tools rebuilds the menu next time.
  const activeToolId = opts.getActiveToolId()
  const renderContextualForDraw = (): void => {
    root.appendChild(sectionLabel('Color'))
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

    root.appendChild(separator())
    root.appendChild(sectionLabel('Brush'))
    const brushRow = document.createElement('div')
    brushRow.className = 'whiteboard-tools-row'
    const activeBrush = opts.getActiveBrushId()
    for (const id of BRUSH_IDS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'whiteboard-tool-pill'
      if (id === activeBrush) btn.classList.add('active')
      btn.textContent = id === 'highlighter' ? 'Hi' : BRUSH_LABELS[id]
      btn.title = BRUSH_LABELS[id]
      btn.addEventListener('click', () => {
        opts.onSelectBrush(id)
        dismiss()
      })
      brushRow.appendChild(btn)
    }
    root.appendChild(brushRow)
  }

  const renderContextualForEraser = (): void => {
    root.appendChild(sectionLabel('Eraser size'))
    const row = document.createElement('div')
    row.className = 'whiteboard-tools-row'
    const activeSize = opts.getEraserSize()
    for (const { id, label } of ERASER_SIZE_PILLS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'whiteboard-tool-pill'
      if (id === activeSize) btn.classList.add('active')
      btn.textContent = label
      btn.title = `${label} eraser`
      btn.addEventListener('click', () => {
        opts.onSelectEraserSize(id)
        dismiss()
      })
      row.appendChild(btn)
    }
    root.appendChild(row)
  }

  if (activeToolId === 'pen') {
    renderContextualForDraw()
  } else if (activeToolId === 'eraser') {
    renderContextualForEraser()
  }
  // Other tools (lasso / laser / text) get their own contextual sections as
  // they land. Until then, only the TOOL row is visible.

  // ---- TOOL ---------------------------------------------------------
  root.appendChild(separator())
  root.appendChild(sectionLabel('Tool'))
  const toolsRow = document.createElement('div')
  toolsRow.className = 'whiteboard-tools-row'
  const activeId = opts.getActiveToolId()
  for (const t of TOOLS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'whiteboard-tool-pill'
    if (t.id === activeId) btn.classList.add('active')
    if (!t.enabled) {
      btn.classList.add('disabled')
      btn.disabled = true
      btn.title = 'Coming soon'
    }
    btn.textContent = t.label
    if (t.enabled) {
      btn.addEventListener('click', () => {
        opts.onSelectTool(t.id)
        dismiss()
      })
    }
    toolsRow.appendChild(btn)
  }
  root.appendChild(toolsRow)

  // ---- VIEW ---------------------------------------------------------
  root.appendChild(separator())
  root.appendChild(sectionLabel('View'))
  root.appendChild(
    fullItem('Reset zoom', () => {
      dismiss()
      opts.onResetZoom()
    }),
  )
  root.appendChild(
    fullItem('Fit to view', () => {
      dismiss()
      opts.onZoomToFit()
    }),
  )
  root.appendChild(
    fullItem('Grid options…', () => {
      dismiss()
      openOptionsMenu(opts.at)
    }),
  )

  // ---- CLEAR --------------------------------------------------------
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

function sectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'whiteboard-tools-section-label'
  el.textContent = text
  return el
}
