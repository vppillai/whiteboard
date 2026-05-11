/**
 * First-run hint. Empty board shows a single line of guidance:
 * "Right-click for tools · ? for help" — fades out on the first stroke
 * commit and never shows again on this device.
 *
 * Pure-logic functions (`shouldShowHint`, the storage abstraction) are
 * unit-tested. The DOM mount + fade is feel-tested on Wacom Intuos.
 */

const HINT_TEXT = 'Right-click for tools · ? for help'
export const FIRSTRUN_STORAGE_KEY = 'whiteboard:hint-shown'
const FIRSTRUN_FLAG_VALUE = 'true'

/** Minimal storage interface so the hint logic is unit-testable without
 *  jsdom/happy-dom. Production wires `localStorageHintStorage()`. */
export interface FirstRunStorage {
  get(): string | null
  set(value: string): void
}

export function localStorageHintStorage(): FirstRunStorage {
  return {
    get: () => localStorage.getItem(FIRSTRUN_STORAGE_KEY),
    set: (v) => localStorage.setItem(FIRSTRUN_STORAGE_KEY, v),
  }
}

/** True iff the hint has not yet been dismissed. Pure function. */
export function shouldShowHint(storage: FirstRunStorage): boolean {
  return storage.get() !== FIRSTRUN_FLAG_VALUE
}

let hintEl: HTMLElement | null = null
let dismissed = false

/** Mount the hint into `parent` if the flag is absent. Idempotent. */
export function mountFirstRunHint(
  parent: HTMLElement,
  storage: FirstRunStorage = localStorageHintStorage(),
): void {
  if (dismissed) return
  if (!shouldShowHint(storage)) return
  if (hintEl) return
  const el = document.createElement('div')
  el.className = 'firstrun-hint'
  el.textContent = HINT_TEXT
  parent.appendChild(el)
  hintEl = el
}

/** Dismiss the hint (fade out + remove) and persist the flag. Idempotent. */
export function dismissFirstRunHint(storage: FirstRunStorage = localStorageHintStorage()): void {
  if (dismissed) return
  dismissed = true
  storage.set(FIRSTRUN_FLAG_VALUE)
  if (!hintEl) return
  hintEl.classList.add('fading')
  const el = hintEl
  hintEl = null
  el.addEventListener(
    'transitionend',
    () => {
      el.remove()
    },
    { once: true },
  )
}

/** Test-only. Resets module state between tests. */
export function __resetForTesting(): void {
  hintEl?.remove()
  hintEl = null
  dismissed = false
}
