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
  /** Accessible name. Used as the visible text by default; when an
   *  `icon` is supplied it becomes the hover tooltip + aria-label. */
  label: string
  /** Optional icon node (built by an icon factory in `menu-icons.ts`).
   *  When set, replaces the visible text — the pill shows just the icon,
   *  and `label` becomes the tooltip + aria-name. Passed as a Node so
   *  we never inject HTML strings (avoids the XSS-by-default footgun
   *  that innerHTML invites). */
  icon?: Node
  /** Optional shortcut hint appended to the hover tooltip — e.g.
   *  "Rectangle (R)". Per the v1.4 menu-icon pass, every right-click
   *  button should reveal its name + shortcut on hover. */
  shortcut?: string
  /** Override the auto-composed tooltip. Defaults to `label` plus
   *  `(shortcut)` when both are set. */
  title?: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}

/** Compose the hover-tooltip string. "Rectangle" + "R" → "Rectangle
 *  (R)"; label only → "Rectangle"; explicit `title` overrides. */
function composeTitle(opts: PillOptions): string {
  if (opts.title) return opts.title
  if (opts.shortcut) return `${opts.label} (${opts.shortcut})`
  return opts.label
}

export function pill(opts: PillOptions): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'whiteboard-tool-pill'
  if (opts.icon) {
    btn.classList.add('whiteboard-tool-pill-icon')
    btn.appendChild(opts.icon)
  } else {
    btn.textContent = opts.label
  }
  const title = composeTitle(opts)
  btn.title = title
  btn.setAttribute('aria-label', opts.label)
  if (opts.active) btn.classList.add('active')
  if (opts.disabled) {
    btn.classList.add('disabled')
    btn.disabled = true
  } else if (opts.onClick) {
    btn.addEventListener('click', opts.onClick)
  }
  return btn
}

export interface FullItemOptions {
  /** Visible label (and accessible name when no icon is supplied). */
  label: string
  /** Optional left-aligned icon node — built via the safe DOM factories
   *  in `menu-icons.ts`. When set, the label still renders after the
   *  icon (text + icon layout). */
  icon?: Node
  /** Optional keyboard shortcut shown right-aligned in dim. e.g.
   *  "⌘E" beside "Export…". */
  shortcut?: string
  /** Optional override for the hover tooltip; defaults to label. */
  title?: string
  onClick: () => void
}

export function fullItem(
  labelOrOpts: string | FullItemOptions,
  onClick?: () => void,
): HTMLButtonElement {
  // Backward-compat: old (label, onClick) shape is preserved.
  const opts: FullItemOptions =
    typeof labelOrOpts === 'string'
      ? { label: labelOrOpts, onClick: onClick ?? ((): void => undefined) }
      : labelOrOpts
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'whiteboard-tool-item'
  btn.title = opts.title ?? opts.label
  btn.setAttribute('aria-label', opts.label)
  if (opts.icon) {
    btn.classList.add('whiteboard-tool-item-with-icon')
    const iconWrap = document.createElement('span')
    iconWrap.className = 'whiteboard-tool-item-icon'
    iconWrap.appendChild(opts.icon)
    btn.appendChild(iconWrap)
  }
  const labelEl = document.createElement('span')
  labelEl.className = 'whiteboard-tool-item-label'
  labelEl.textContent = opts.label
  btn.appendChild(labelEl)
  if (opts.shortcut) {
    const shortcutEl = document.createElement('span')
    shortcutEl.className = 'whiteboard-tool-item-shortcut'
    shortcutEl.textContent = opts.shortcut
    btn.appendChild(shortcutEl)
  }
  btn.addEventListener('click', opts.onClick)
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
