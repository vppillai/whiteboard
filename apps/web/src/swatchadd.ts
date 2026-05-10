/**
 * Hex-input swatch-add UI. Renders a hex text field, an OS color picker
 * trigger, a live preview, and Add/Cancel. Designed to be mounted both
 * inline (panel "+ Add custom color") and as a sub-popover (color picker
 * "+" tile).
 *
 * Validation: hex must match #RRGGBB. # is auto-prepended on submit.
 * Duplicate-against-customSwatches blocks Add (curated/recent overlaps OK).
 */

import { addCustomSwatch, getCustomSwatches } from './settings'

export interface SwatchAddOptions {
  onAdded?: (hex: string) => void
  onCancel?: () => void
}

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

export function createSwatchAdd(opts: SwatchAddOptions = {}): HTMLElement {
  const root = document.createElement('div')
  root.className = 'whiteboard-swatch-add'

  const title = document.createElement('div')
  title.className = 'whiteboard-swatch-add-title'
  title.textContent = 'Add custom color'

  const inputRow = document.createElement('div')
  inputRow.className = 'whiteboard-swatch-add-row'

  const hexField = document.createElement('input')
  hexField.type = 'text'
  hexField.placeholder = '#______'
  hexField.maxLength = 7
  hexField.className = 'whiteboard-swatch-add-hex'
  hexField.spellcheck = false
  hexField.autocapitalize = 'off'

  const osPickerLabel = document.createElement('label')
  osPickerLabel.className = 'whiteboard-swatch-add-os-picker'
  osPickerLabel.title = 'Pick from system color picker'
  osPickerLabel.textContent = '🎨'
  const osPickerInput = document.createElement('input')
  osPickerInput.type = 'color'
  osPickerInput.value = '#000000'
  osPickerInput.style.position = 'absolute'
  osPickerInput.style.opacity = '0'
  osPickerInput.style.pointerEvents = 'none'
  osPickerLabel.appendChild(osPickerInput)

  inputRow.append(hexField, osPickerLabel)

  const previewRow = document.createElement('div')
  previewRow.className = 'whiteboard-swatch-add-preview-row'
  const preview = document.createElement('div')
  preview.className = 'whiteboard-swatch-add-preview'
  previewRow.appendChild(preview)

  const buttons = document.createElement('div')
  buttons.className = 'whiteboard-swatch-add-buttons'
  const cancelBtn = document.createElement('button')
  cancelBtn.type = 'button'
  cancelBtn.className = 'whiteboard-swatch-add-cancel'
  cancelBtn.textContent = 'Cancel'
  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'whiteboard-swatch-add-confirm'
  addBtn.textContent = 'Add'
  addBtn.disabled = true
  buttons.append(cancelBtn, addBtn)

  root.append(title, inputRow, previewRow, buttons)

  const normalize = (raw: string): string | null => {
    const t = raw.trim()
    if (!HEX_RE.test(t)) return null
    return t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`
  }

  const update = (): void => {
    const hex = normalize(hexField.value)
    if (hex && !getCustomSwatches().includes(hex)) {
      preview.style.background = hex
      preview.classList.remove('invalid')
      addBtn.disabled = false
    } else {
      preview.style.background = 'transparent'
      preview.classList.toggle('invalid', !!hex && getCustomSwatches().includes(hex))
      addBtn.disabled = true
    }
  }

  hexField.addEventListener('input', update)
  osPickerInput.addEventListener('input', () => {
    hexField.value = osPickerInput.value
    update()
  })
  cancelBtn.addEventListener('click', () => opts.onCancel?.())
  addBtn.addEventListener('click', () => {
    const hex = normalize(hexField.value)
    if (!hex) return
    addCustomSwatch(hex)
    opts.onAdded?.(hex)
  })

  setTimeout(() => hexField.focus(), 0)
  return root
}
