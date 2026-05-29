/**
 * Theme management. Three modes:
 *   - 'system'  — follow OS preference via prefers-color-scheme.
 *   - 'light'   — force light.
 *   - 'dark'    — force dark.
 *
 * Selected mode is persisted to localStorage. A 'themechange' CustomEvent is
 * dispatched on document.documentElement whenever the effective theme may
 * have shifted (mode change OR system change while in 'system' mode).
 */

export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'whiteboard:theme'
const MODES: ThemeMode[] = ['system', 'light', 'dark']

export function initTheme(): void {
  applyMode(getMode())

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', () => {
    if (getMode() === 'system') {
      document.documentElement.dispatchEvent(new CustomEvent('themechange'))
    }
  })
}

export function getMode(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === 'light' || v === 'dark' || v === 'system') return v
  return 'system'
}

export function setMode(mode: ThemeMode): void {
  localStorage.setItem(STORAGE_KEY, mode)
  applyMode(mode)
}

export function cycleMode(): ThemeMode {
  const cur = getMode()
  const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length] ?? 'system'
  setMode(next)
  return next
}

export function getEffective(): 'light' | 'dark' {
  const mode = getMode()
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyMode(mode: ThemeMode): void {
  const root = document.documentElement
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
  root.dispatchEvent(new CustomEvent('themechange'))
}

/**
 * Resolve a brush color token. The literal string `'ink'` is replaced with
 * the current theme's `--ink` CSS variable so strokes follow theme switches.
 */
export function resolveInkColor(token: string): string {
  if (token !== 'ink') return token
  if (typeof document === 'undefined') return '#1a1a1a'
  const v = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()
  return v || '#1a1a1a'
}
