/**
 * Per-device view state persistence: where the camera was last positioned.
 *
 * Deliberately separate from `settings.ts` because the lifecycles differ:
 * settings (color, grid type) are user preferences and would sync across
 * devices when a backend lands. View state is "where I left off" — each
 * device has its own and shouldn't sync.
 *
 * Saves to localStorage. Debounced from the caller via `queueSave` so
 * normal pan/zoom doesn't churn writes; flushed on page hide so the last
 * frame of motion is captured even if the debounce hasn't fired.
 */

import type { Camera } from './camera'

const STORAGE_KEY = 'whiteboard:view'

interface PersistedView {
  x: number
  y: number
  scale: number
}

export function loadView(): PersistedView | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedView>
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.scale === 'number' &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y) &&
      Number.isFinite(parsed.scale)
    ) {
      return { x: parsed.x, y: parsed.y, scale: parsed.scale }
    }
  } catch {
    // localStorage can throw in private mode / when full; silently fall through
  }
  return null
}

export function saveView(camera: Camera): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ x: camera.x, y: camera.y, scale: camera.scale }),
    )
  } catch {
    // see loadView()
  }
}

export function clearView(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // see loadView()
  }
}

const SAVE_DEBOUNCE_MS = 500

/**
 * Returns a debouncer that batches camera-change saves. Call it on every
 * camera mutation; it'll only actually write 500ms after the last call.
 *
 * Also wires up a flush on `visibilitychange` (page hide) so the last
 * frame of motion is captured even if the user closes the tab quickly.
 *
 * `cleanup()` removes both listeners. main.ts registers it via the
 * teardown registry so an HMR cycle doesn't leak stale listeners that
 * close over a now-detached camera.
 */
export function makeViewSaver(camera: Camera): {
  queueSave(): void
  flush(): void
  cleanup(): void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    saveView(camera)
  }
  const queueSave = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS)
  }

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') flush()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', flush)

  const cleanup = (): void => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', flush)
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return { queueSave, flush, cleanup }
}
