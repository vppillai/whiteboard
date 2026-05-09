/**
 * Shared DOM helpers for the tool menu and per-tool contextual menu sections.
 *
 * Lives outside `toolmenu.ts` so individual tools (pen, eraser, …) can build
 * their own sections without importing from the menu module that imports
 * them — keeps the dependency graph one-directional.
 *
 * Stylesheet rules these emit live in style.css under the
 * `.whiteboard-tool-*` and `.whiteboard-color-swatch*` selectors.
 */

export function sectionLabel(text: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'whiteboard-tools-section-label'
  el.textContent = text
  return el
}

export function separator(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'whiteboard-tool-sep'
  return el
}

export function pillRow(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'whiteboard-tools-row'
  return el
}

export interface PillOptions {
  label: string
  title?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}

export function pill(opts: PillOptions): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'whiteboard-tool-pill'
  btn.textContent = opts.label
  if (opts.title) btn.title = opts.title
  if (opts.active) btn.classList.add('active')
  if (opts.disabled) {
    btn.classList.add('disabled')
    btn.disabled = true
  } else if (opts.onClick) {
    btn.addEventListener('click', opts.onClick)
  }
  return btn
}

export function fullItem(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'whiteboard-tool-item'
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}

export interface SwatchOptions {
  color: string
  /** Active highlight (e.g. matches the current brush color). */
  active?: boolean
  /** Title / aria-label override. Defaults to the color string. */
  title?: string
  onClick: () => void
}

export function swatch(opts: SwatchOptions): HTMLButtonElement {
  const sw = document.createElement('button')
  sw.type = 'button'
  sw.className = 'whiteboard-color-swatch whiteboard-color-swatch-small'
  sw.dataset.color = opts.color
  sw.title = opts.title ?? (opts.color === 'ink' ? 'theme ink' : opts.color)
  sw.setAttribute('aria-label', sw.title)
  if (opts.color === 'ink') sw.classList.add('whiteboard-color-swatch-ink')
  else sw.style.background = opts.color
  if (opts.active) sw.classList.add('active')
  sw.addEventListener('click', opts.onClick)
  return sw
}

export function paletteGrid(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'whiteboard-tools-palette'
  return el
}
