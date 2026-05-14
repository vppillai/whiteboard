/**
 * M1.7 settings panel content. Renders the 7 sections per spec § 6.1
 * into the side panel's body. Each section is a self-contained renderer
 * that subscribes to settings.onChange where it needs live updates.
 */

import { BRUSH_IDS, BRUSH_LABELS, type BrushId } from '../brushes'
import {
  VALID_GRID_TYPE_VALUES,
  VALID_SPACING_VALUES,
  clearPreset,
  getCustomSwatches,
  getEffectiveBrushConfig,
  getGrid,
  getSettings,
  onChange,
  removeCustomSwatch,
  setGridSpacing,
  setGridType,
  setMouseSyntheticPressure,
  setPredictedEvents,
  setPresetField,
} from '../settings'
import { createSwatchAdd } from '../swatchadd'
import { type ThemeMode, getMode as getThemeMode, setMode as setThemeMode } from '../theme'
import { mountCurveEditor, renderCurveThumbnail } from './curve-editor'

export interface PanelContentOptions {
  /** Called when the user clicks "Reset to defaults" — typically wires
   *  to a resetflow.request() in main.ts. */
  onResetClick: () => void
}

interface Section {
  el: HTMLElement
  update?(): void
  dispose?(): void
}

export function createPanelContent(opts: PanelContentOptions): {
  el: HTMLElement
  cleanup: () => void
} {
  const root = document.createElement('div')
  root.className = 'whiteboard-settings-panel'

  const sections: Section[] = [
    renderBrushPresetsSection(),
    renderCustomSwatchesSection(),
    renderGridSection(),
    renderThemeSection(),
    renderInputSection(),
    renderAdvancedSection(),
    renderResetFooter(opts.onResetClick),
  ]
  for (const s of sections) root.appendChild(s.el)

  const unsubscribe = onChange(() => {
    for (const s of sections) s.update?.()
  })

  return {
    el: root,
    cleanup: () => {
      unsubscribe()
      for (const s of sections) s.dispose?.()
    },
  }
}

function sectionLabel(text: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'whiteboard-settings-section-label'
  el.textContent = text
  return el
}

function renderBrushPresetsSection(): Section {
  const el = document.createElement('section')
  el.appendChild(sectionLabel('Brush presets'))
  const cards: Array<{ update: () => void }> = []
  for (const id of BRUSH_IDS) {
    cards.push(renderBrushCard(id, el))
  }
  return {
    el,
    update: () => {
      for (const c of cards) c.update()
    },
  }
}

function renderBrushCard(brushId: BrushId, parent: HTMLElement): { update: () => void } {
  const card = document.createElement('div')
  card.className = 'whiteboard-settings-brush-card'
  parent.appendChild(card)

  const head = document.createElement('div')
  head.className = 'whiteboard-settings-brush-head'
  card.appendChild(head)

  const title = document.createElement('span')
  title.className = 'whiteboard-settings-brush-title'
  title.textContent = BRUSH_LABELS[brushId]
  head.appendChild(title)

  // Clickable curve thumbnail — M2. Click toggles the inline curve editor.
  const thumbBtn = document.createElement('button')
  thumbBtn.type = 'button'
  thumbBtn.className = 'whiteboard-settings-curve-thumb-btn'
  thumbBtn.title = 'Edit pressure curve'
  thumbBtn.setAttribute('aria-label', `Edit ${BRUSH_LABELS[brushId]} pressure curve`)
  thumbBtn.appendChild(renderCurveThumbnail(brushId))
  head.appendChild(thumbBtn)

  const sliders = {
    size: makeSlider('Size', 1, 24, 0.5, brushId, 'size'),
    opacity: makeSlider('Opacity', 0, 1, 0.02, brushId, 'opacity'),
    pressureGamma: makeSlider('Pressure γ', 0.5, 3.0, 0.1, brushId, 'pressureGamma'),
  }
  card.append(sliders.size.el, sliders.opacity.el, sliders.pressureGamma.el)

  // Inline curve-editor slot — visible only when this brush is expanded.
  const curveSlot = document.createElement('div')
  curveSlot.className = 'whiteboard-settings-curve-slot'
  curveSlot.style.display = 'none'
  card.appendChild(curveSlot)

  let curveCleanup: (() => void) | null = null
  // Snapshot of the inputs the thumbnail derives from. Compare on every
  // update tick so unrelated settings changes (color, grid, swatches…)
  // don't trigger N×SVG-rebuild churn. Pre-#12 we replaceChildren'd on
  // every global onChange tick.
  let thumbSnapshot = thumbnailFingerprint(brushId)
  const refreshThumb = (): void => {
    thumbSnapshot = thumbnailFingerprint(brushId)
    thumbBtn.replaceChildren(renderCurveThumbnail(brushId))
  }
  const refreshThumbIfChanged = (): void => {
    const next = thumbnailFingerprint(brushId)
    if (next === thumbSnapshot) return
    thumbSnapshot = next
    thumbBtn.replaceChildren(renderCurveThumbnail(brushId))
  }
  thumbBtn.addEventListener('click', () => {
    if (curveCleanup) {
      curveCleanup()
      curveCleanup = null
      curveSlot.style.display = 'none'
      return
    }
    curveSlot.style.display = ''
    curveCleanup = mountCurveEditor(curveSlot, {
      brushId,
      onChange: refreshThumb,
    })
  })

  const resetLink = document.createElement('button')
  resetLink.type = 'button'
  resetLink.className = 'whiteboard-settings-reset-link'
  resetLink.textContent = 'Reset this preset'
  resetLink.addEventListener('click', () => {
    clearPreset(brushId)
    refreshThumb()
  })
  card.appendChild(resetLink)

  return {
    update: () => {
      sliders.size.update()
      sliders.opacity.update()
      sliders.pressureGamma.update()
      refreshThumbIfChanged()
    },
  }
}

/**
 * Stable string fingerprint of the inputs `renderCurveThumbnail` reads
 * (pressureCurve.mid + pressureGamma after preset resolution). Cheap to
 * compute; cheap to compare. Equal fingerprints ⇒ the thumbnail would
 * render the same SVG ⇒ skip the rebuild.
 */
function thumbnailFingerprint(brushId: BrushId): string {
  const eff = getEffectiveBrushConfig(brushId, '#000000')
  const mid = eff.pressureCurve?.mid
  return `${eff.pressureGamma ?? 1}|${mid ? `${mid[0]},${mid[1]}` : 'none'}`
}

type NumericPresetField =
  | 'size'
  | 'opacity'
  | 'pressureGamma'
  | 'thinning'
  | 'smoothing'
  | 'streamline'
  | 'taperStart'
  | 'taperEnd'

function makeSlider(
  label: string,
  min: number,
  max: number,
  step: number,
  brushId: BrushId,
  field: NumericPresetField,
): { el: HTMLElement; update: () => void } {
  const wrap = document.createElement('div')
  wrap.className = 'whiteboard-settings-slider'

  const lbl = document.createElement('label')
  lbl.className = 'whiteboard-settings-slider-label'
  lbl.textContent = label

  const range = document.createElement('input')
  range.type = 'range'
  range.min = String(min)
  range.max = String(max)
  range.step = String(step)

  const valueOut = document.createElement('span')
  valueOut.className = 'whiteboard-settings-slider-value'

  const sync = () => {
    const cfg = getEffectiveBrushConfig(brushId, 'ink')
    const v = (cfg as unknown as Record<string, unknown>)[field] as number
    range.value = String(v)
    valueOut.textContent = step >= 1 ? String(v) : v.toFixed(2)
  }
  sync()

  range.addEventListener('input', () => {
    setPresetField(brushId, field, Number(range.value))
  })

  wrap.append(lbl, range, valueOut)
  return { el: wrap, update: sync }
}

function renderCustomSwatchesSection(): Section {
  const el = document.createElement('section')
  el.appendChild(sectionLabel('Custom swatches'))

  const list = document.createElement('div')
  list.className = 'whiteboard-settings-custom-list'
  el.appendChild(list)

  const empty = document.createElement('div')
  empty.className = 'whiteboard-settings-custom-empty'
  empty.textContent = 'Add a custom color to use across the board.'
  el.appendChild(empty)

  const addContainer = document.createElement('div')
  addContainer.className = 'whiteboard-settings-add-swatch-container'
  el.appendChild(addContainer)

  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'whiteboard-settings-add-swatch-btn'
  addBtn.textContent = '+ Add custom color'
  addContainer.appendChild(addBtn)

  let addUI: HTMLElement | null = null

  addBtn.addEventListener('click', () => {
    if (addUI) return
    addUI = createSwatchAdd({
      onAdded: () => {
        addUI?.remove()
        addUI = null
      },
      onCancel: () => {
        addUI?.remove()
        addUI = null
      },
    })
    addContainer.appendChild(addUI)
  })

  const update = () => {
    list.replaceChildren()
    const swatches = getCustomSwatches()
    if (swatches.length === 0) {
      empty.style.display = ''
      return
    }
    empty.style.display = 'none'
    for (const hex of swatches) {
      const row = document.createElement('div')
      row.className = 'whiteboard-settings-custom-row'

      const preview = document.createElement('span')
      preview.className = 'whiteboard-settings-custom-preview'
      preview.style.background = hex

      const hexLabel = document.createElement('span')
      hexLabel.className = 'whiteboard-settings-custom-hex'
      hexLabel.textContent = hex.toUpperCase()

      const del = document.createElement('button')
      del.type = 'button'
      del.className = 'whiteboard-settings-custom-delete'
      del.setAttribute('aria-label', `Delete ${hex}`)
      del.textContent = '×'
      del.addEventListener('click', () => removeCustomSwatch(hex))

      row.append(preview, hexLabel, del)
      list.appendChild(row)
    }
  }

  update()
  return { el, update }
}

function renderGridSection(): Section {
  const el = document.createElement('section')
  el.appendChild(sectionLabel('Grid'))

  const typeLbl = document.createElement('div')
  typeLbl.className = 'whiteboard-settings-sub-label'
  typeLbl.textContent = 'Type'
  el.appendChild(typeLbl)

  const typeRow = document.createElement('div')
  typeRow.className = 'whiteboard-settings-pill-row'
  el.appendChild(typeRow)
  for (const t of VALID_GRID_TYPE_VALUES) {
    const p = makePill(t.charAt(0).toUpperCase() + t.slice(1), () => setGridType(t))
    p.dataset.value = t
    typeRow.appendChild(p)
  }

  const spLbl = document.createElement('div')
  spLbl.className = 'whiteboard-settings-sub-label'
  spLbl.textContent = 'Spacing'
  el.appendChild(spLbl)

  const spRow = document.createElement('div')
  spRow.className = 'whiteboard-settings-pill-row'
  el.appendChild(spRow)
  for (const s of VALID_SPACING_VALUES) {
    const p = makePill(String(s), () => setGridSpacing(s))
    p.dataset.value = String(s)
    spRow.appendChild(p)
  }

  const update = () => {
    const cur = getGrid()
    for (const p of typeRow.querySelectorAll<HTMLElement>('.whiteboard-settings-pill')) {
      p.classList.toggle('active', p.dataset.value === cur.type)
    }
    for (const p of spRow.querySelectorAll<HTMLElement>('.whiteboard-settings-pill')) {
      p.classList.toggle('active', p.dataset.value === String(cur.spacing))
    }
  }

  update()
  return { el, update }
}

function renderThemeSection(): Section {
  const el = document.createElement('section')
  el.appendChild(sectionLabel('Theme'))

  const row = document.createElement('div')
  row.className = 'whiteboard-settings-pill-row'
  el.appendChild(row)

  const modes: ThemeMode[] = ['light', 'dark', 'system']
  for (const m of modes) {
    const pill = makePill(m.charAt(0).toUpperCase() + m.slice(1), () => setThemeMode(m))
    pill.dataset.value = m
    row.appendChild(pill)
  }

  const update = () => {
    const cur = getThemeMode()
    for (const p of row.querySelectorAll<HTMLElement>('.whiteboard-settings-pill')) {
      p.classList.toggle('active', p.dataset.value === cur)
    }
  }

  update()
  document.documentElement.addEventListener('themechange', update)

  return {
    el,
    update,
    dispose: () => document.documentElement.removeEventListener('themechange', update),
  }
}

function renderInputSection(): Section {
  const el = document.createElement('section')
  el.appendChild(sectionLabel('Input'))

  const row = document.createElement('div')
  row.className = 'whiteboard-settings-pe-row'
  el.appendChild(row)

  const label = document.createElement('label')
  label.className = 'whiteboard-settings-pe-label'
  row.appendChild(label)

  const title = document.createElement('span')
  title.className = 'whiteboard-settings-pe-title'
  title.textContent = 'Predicted events'
  label.appendChild(title)

  const help = document.createElement('span')
  help.className = 'whiteboard-settings-pe-help'
  help.textContent =
    'Visual lookahead during drawing. Smoother on screen tablets (iPad, ' +
    'Surface, MobileStudio); may flicker on indirect-input tablets like ' +
    'Wacom Intuos. URL ?predict=1 forces on per-session.'
  label.appendChild(help)

  const input = document.createElement('input')
  input.type = 'checkbox'
  input.className = 'whiteboard-settings-pe-input'
  input.checked = getSettings().predictedEvents
  input.addEventListener('change', () => {
    setPredictedEvents(input.checked)
  })
  row.appendChild(input)

  // ---- Mouse synthetic pressure -----------------------------------------
  // Second toggle in the Input section. Mouse pointer events report a
  // constant 0.5 pressure; the synthesis maps screen-space velocity
  // (fast = thin, slow = thick) so mouse strokes get some shape variation.
  // Off for pen / touch where real pressure exists.
  const mspRow = document.createElement('div')
  mspRow.className = 'whiteboard-settings-pe-row'
  el.appendChild(mspRow)

  const mspLabel = document.createElement('label')
  mspLabel.className = 'whiteboard-settings-pe-label'
  mspRow.appendChild(mspLabel)

  const mspTitle = document.createElement('span')
  mspTitle.className = 'whiteboard-settings-pe-title'
  mspTitle.textContent = 'Mouse synthetic pressure'
  mspLabel.appendChild(mspTitle)

  const mspHelp = document.createElement('span')
  mspHelp.className = 'whiteboard-settings-pe-help'
  mspHelp.textContent =
    'Shape mouse-drawn strokes from cursor velocity (fast = thinner, ' +
    'slow = thicker). Pen / touch ignore this — they have real pressure.'
  mspLabel.appendChild(mspHelp)

  const mspInput = document.createElement('input')
  mspInput.type = 'checkbox'
  mspInput.className = 'whiteboard-settings-pe-input'
  mspInput.checked = getSettings().mouseSyntheticPressure
  mspInput.addEventListener('change', () => {
    setMouseSyntheticPressure(mspInput.checked)
  })
  mspRow.appendChild(mspInput)

  return {
    el,
    update: () => {
      input.checked = getSettings().predictedEvents
      mspInput.checked = getSettings().mouseSyntheticPressure
    },
  }
}

function renderAdvancedSection(): Section {
  const el = document.createElement('section')
  const header = document.createElement('button')
  header.type = 'button'
  header.className = 'whiteboard-settings-advanced-toggle'
  header.textContent = '▶ Show advanced'
  el.appendChild(header)

  const body = document.createElement('div')
  body.className = 'whiteboard-settings-advanced-body'
  body.style.display = 'none'
  el.appendChild(body)

  let expanded = false
  let cardUpdaters: Array<() => void> = []

  header.addEventListener('click', () => {
    expanded = !expanded
    header.textContent = expanded ? '▼ Hide advanced' : '▶ Show advanced'
    body.style.display = expanded ? '' : 'none'
    if (expanded && cardUpdaters.length === 0) {
      cardUpdaters = renderAdvancedCards(body)
    }
  })

  return {
    el,
    update: () => {
      for (const u of cardUpdaters) u()
    },
  }
}

function renderAdvancedCards(parent: HTMLElement): Array<() => void> {
  const updaters: Array<() => void> = []
  for (const id of BRUSH_IDS) {
    const card = document.createElement('div')
    card.className = 'whiteboard-settings-brush-card'
    parent.appendChild(card)

    const head = document.createElement('div')
    head.className = 'whiteboard-settings-brush-head'
    head.textContent = BRUSH_LABELS[id]
    card.appendChild(head)

    const fields: Array<{
      field: NumericPresetField
      label: string
      min: number
      max: number
      step: number
    }> = [
      { field: 'thinning', label: 'Thinning', min: 0, max: 1, step: 0.05 },
      { field: 'smoothing', label: 'Smoothing', min: 0, max: 1, step: 0.05 },
      { field: 'streamline', label: 'Streamline', min: 0, max: 1, step: 0.05 },
      { field: 'taperStart', label: 'Taper start', min: 0, max: 30, step: 1 },
      { field: 'taperEnd', label: 'Taper end', min: 0, max: 30, step: 1 },
    ]
    for (const f of fields) {
      const s = makeSlider(f.label, f.min, f.max, f.step, id, f.field)
      card.appendChild(s.el)
      updaters.push(s.update)
    }

    for (const cap of ['capStart', 'capEnd'] as const) {
      const wrap = document.createElement('label')
      wrap.className = 'whiteboard-settings-checkbox'
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      const lbl = document.createElement('span')
      lbl.textContent = cap === 'capStart' ? 'Cap start' : 'Cap end'
      const sync = () => {
        const cfg = getEffectiveBrushConfig(id, 'ink')
        cb.checked = !!(cfg as unknown as Record<string, unknown>)[cap]
      }
      sync()
      cb.addEventListener('change', () => {
        setPresetField(id, cap, cb.checked)
      })
      wrap.append(cb, lbl)
      card.appendChild(wrap)
      updaters.push(sync)
    }
  }
  return updaters
}

function renderResetFooter(onResetClick: () => void): Section {
  const el = document.createElement('section')
  el.className = 'whiteboard-settings-footer'
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'whiteboard-settings-reset-btn'
  btn.textContent = 'Reset to defaults'
  btn.addEventListener('click', onResetClick)
  el.appendChild(btn)
  return { el }
}

function makePill(label: string, onClick: () => void): HTMLButtonElement {
  const p = document.createElement('button')
  p.type = 'button'
  p.className = 'whiteboard-settings-pill'
  p.textContent = label
  p.addEventListener('click', onClick)
  return p
}
