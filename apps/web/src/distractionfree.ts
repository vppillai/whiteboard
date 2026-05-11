/**
 * Distraction-free drawing mode. `F` toggles a body class that hides app
 * chrome (Help pill, Tool pill, popovers, settings panel). Does NOT
 * invoke the browser Fullscreen API — F11 already covers that.
 *
 * On entry: dismisses any open popover, auto-closes the settings panel,
 * shows a 2-second exit-affordance toast.
 *
 * On exit: removes the body class. Esc is the primary exit key (handled
 * in `keymap.ts`'s Esc handler); F also exits (toggle).
 *
 * Module-local state is the source of truth (so the toggle is unit-
 * testable without jsdom). DOM side effects are gated behind a `typeof
 * document` guard.
 */

const CLASS = 'distraction-free'
const TOAST_ID = 'df-exit-toast'
const TOAST_MS = 2000

export interface DistractionFreeOptions {
  appEl?: HTMLElement
  /** Best-effort dismissals; safe to omit. Wired by main.ts to popover /
   *  sidepanel dismiss helpers so distractionfree doesn't depend on them. */
  dismissPopover?: () => void
  dismissSidePanel?: () => void
}

let active = false

export function isDistractionFree(): boolean {
  return active
}

export function toggleDistractionFree(opts: DistractionFreeOptions = {}): void {
  if (active) exitDistractionFree()
  else enterDistractionFree(opts)
}

export function enterDistractionFree(opts: DistractionFreeOptions = {}): void {
  if (active) return
  active = true
  if (typeof document === 'undefined') return
  document.body.classList.add(CLASS)
  try {
    opts.dismissPopover?.()
  } catch {
    /* best-effort */
  }
  try {
    opts.dismissSidePanel?.()
  } catch {
    /* best-effort */
  }
  showExitToast()
  opts.appEl?.focus?.()
}

export function exitDistractionFree(): void {
  if (!active) return
  active = false
  if (typeof document === 'undefined') return
  document.body.classList.remove(CLASS)
}

function showExitToast(): void {
  let toast = document.getElementById(TOAST_ID)
  if (!toast) {
    toast = document.createElement('div')
    toast.id = TOAST_ID
    toast.className = 'df-exit-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = 'Press Esc or F to exit'
  toast.classList.add('visible')
  window.setTimeout(() => {
    toast?.classList.remove('visible')
    window.setTimeout(() => toast?.remove(), 300)
  }, TOAST_MS)
}

/** Test-only. */
export function __resetForTesting(): void {
  active = false
  if (typeof document !== 'undefined') {
    document.body.classList.remove(CLASS)
    document.getElementById(TOAST_ID)?.remove()
  }
}
