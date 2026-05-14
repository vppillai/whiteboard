/**
 * First-run hint. Empty board shows a single line of guidance:
 * "Right-click for tools · ? for help" — fades out on the first stroke
 * commit OR after AUTO_FADE_MS (whichever fires first), then never
 * shows again on this device.
 *
 * Auto-fade was added in v1.4 because a user who never strokes (e.g.
 * opens the app to read help, or just to test) would otherwise see
 * the hint sit there indefinitely.
 *
 * Pure-logic functions (`shouldShowHint`, the storage abstraction) are
 * unit-tested. The DOM mount + fade is feel-tested on Wacom Intuos.
 */

const HINT_TEXT = 'Right-click for tools · ? for help'
export const FIRSTRUN_STORAGE_KEY = 'whiteboard:hint-shown'
const FIRSTRUN_FLAG_VALUE = 'true'
/** How long the hint sits before auto-fading if the user hasn't
 *  committed a stroke (or otherwise triggered explicit dismiss).
 *  10 s — long enough to read at a glance, short enough to clear
 *  before it feels like persistent UI clutter. v1.4. */
const AUTO_FADE_MS = 10_000

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
let autoFadeTimer: ReturnType<typeof setTimeout> | null = null

/** Mount the hint into `parent` if the flag is absent. Idempotent.
 *  Schedules an AUTO_FADE_MS dismiss timer so the hint clears even if
 *  the user never commits a stroke — without this the hint would sit
 *  indefinitely on a session where the user reads but doesn't draw. */
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
  // Auto-fade timer — explicit dismiss (first-stroke commit) takes
  // priority and clears the timer. If the timer fires first, it goes
  // through the same dismiss path so the localStorage flag is set
  // and the hint never shows again on this device.
  autoFadeTimer = setTimeout(() => {
    autoFadeTimer = null
    dismissFirstRunHint(storage)
  }, AUTO_FADE_MS)
}

/** Dismiss the hint (fade out + remove) and persist the flag. Idempotent. */
export function dismissFirstRunHint(storage: FirstRunStorage = localStorageHintStorage()): void {
  if (dismissed) return
  dismissed = true
  storage.set(FIRSTRUN_FLAG_VALUE)
  // Cancel the auto-fade timer if it's still pending (the user
  // triggered the explicit dismiss path first — e.g. by committing
  // a stroke). Cheap insurance: setTimeout's callback would no-op
  // anyway via the `dismissed` flag, but cancelling avoids a stray
  // timer firing.
  if (autoFadeTimer !== null) {
    clearTimeout(autoFadeTimer)
    autoFadeTimer = null
  }
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
  if (autoFadeTimer !== null) {
    clearTimeout(autoFadeTimer)
    autoFadeTimer = null
  }
}
