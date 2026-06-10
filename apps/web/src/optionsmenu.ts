/**
 * Options menu popover. Hosts grid type and spacing today; gains more sections
 * as M2-era settings (pressure curve, prediction toggle, etc.) land.
 *
 * Defaults to **pinned** because options are usually adjusted iteratively
 * (try a spacing, look at the grid, adjust again).
 */

import { type Popover, showPopover } from './popover'
import {
  type GridType,
  getSettings,
  setGridSpacing,
  setGridType,
  VALID_GRID_TYPE_VALUES,
  VALID_SPACING_VALUES,
} from './settings'

interface PillSpec<T> {
  value: T
  label: string
}

const GRID_PILLS: PillSpec<GridType>[] = VALID_GRID_TYPE_VALUES.map((v) => ({
  value: v,
  label: v,
}))

const SPACING_PILLS: PillSpec<number>[] = VALID_SPACING_VALUES.map((v) => ({
  value: v,
  label: `${v}px`,
}))

export function openOptionsMenu(at: { x: number; y: number }): Popover {
  const root = document.createElement('div')
  root.className = 'whiteboard-options'

  const gridSection = makeSection()
  root.appendChild(gridSection)

  const renderGrid = (): void => {
    const cur = getSettings().grid
    gridSection.replaceChildren()
    gridSection.appendChild(label('grid'))
    gridSection.appendChild(
      pillRow(GRID_PILLS, cur.type, (v) => {
        setGridType(v)
        renderGrid()
      }),
    )
    gridSection.appendChild(label('spacing'))
    gridSection.appendChild(
      pillRow(SPACING_PILLS, cur.spacing, (v) => {
        setGridSpacing(v)
        renderGrid()
      }),
    )
  }
  renderGrid()

  return showPopover({
    anchor: at,
    title: 'options',
    content: root,
    pinned: true,
    tag: 'options',
  })
}

function makeSection(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'whiteboard-options-section'
  return el
}

function label(text: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'whiteboard-popover-section-label'
  el.textContent = text
  return el
}

function pillRow<T>(pills: PillSpec<T>[], current: T, onSelect: (v: T) => void): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'whiteboard-options-pills'
  for (const p of pills) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'whiteboard-options-pill'
    btn.textContent = p.label
    // aria-pressed mirrors the visual `active` class so screen readers
    // announce the current selection (matches menu-ui.ts's pill()).
    // Build-time only is enough: renderGrid rebuilds both rows on every
    // selection change, so the attribute can never go stale.
    if (p.value === current) {
      btn.classList.add('active')
      btn.setAttribute('aria-pressed', 'true')
    } else {
      btn.setAttribute('aria-pressed', 'false')
    }
    btn.addEventListener('click', () => onSelect(p.value))
    row.appendChild(btn)
  }
  return row
}
