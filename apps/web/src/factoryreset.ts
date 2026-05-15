/**
 * Factory reset — wipe ALL per-origin browser state and reload.
 *
 * Distinct from `resetflow` (which only resets in-app settings like
 * brush presets, custom swatches, scalar preferences):
 *
 *   - Factory reset clears IndexedDB (strokes, images, texts, shapes,
 *     image blobs — every persisted board object), localStorage
 *     (every key — settings, tool-menu pin / anchor, first-run flag,
 *     etc.), sessionStorage, CacheStorage (service-worker caches),
 *     and any registered service workers.
 *   - Then it forces a full page reload so the app boots with a
 *     completely clean slate. Same effect as the "wipe everything"
 *     diagnostic the user previously ran via the DevTools console
 *     when a stale browser state stuck.
 *
 * Why this exists: occasional broken-state scenarios (multi-tab
 * IDB-upgrade blocks, stale service workers, localStorage quota
 * exhaustion) require nuking origin state. Asking users to open
 * DevTools and paste a JS snippet is hostile; a clearly-labeled
 * destructive button in the settings panel surfaces the recovery
 * path without that friction.
 *
 * The destructive-confirm flow (matching clear-board / reset-to-
 * defaults) makes it a two-tap operation so a fat-finger doesn't
 * vaporize the user's drawings.
 */

import { createDestructiveConfirm, type DestructiveConfirm } from './destructiveconfirm'

export type FactoryResetFlow = DestructiveConfirm

export interface FactoryResetFlowOptions {
  refocusOnClose?: HTMLElement
}

export function _stripFactoryResetParamFromHref(href: string): string | null {
  const url = new URL(href)
  if (!url.searchParams.has('factoryReset')) return null
  url.searchParams.delete('factoryReset')
  return `${url.pathname}${url.search}${url.hash}`
}

export function clearFactoryResetQueryParam(
  loc: Pick<Location, 'href'> = window.location,
  hist: Pick<History, 'replaceState'> = window.history,
): void {
  try {
    const cleaned = _stripFactoryResetParamFromHref(loc.href)
    if (!cleaned) return
    hist.replaceState(null, '', cleaned)
  } catch {
    // URL parsing/history APIs can fail in restricted contexts; ignore.
  }
}

export function createFactoryResetFlow(opts: FactoryResetFlowOptions = {}): FactoryResetFlow {
  return createDestructiveConfirm({
    message:
      'Factory reset? This wipes ALL boards, settings, custom colors, and cached data, then reloads the page. This cannot be undone.',
    confirmLabel: 'Factory reset',
    onConfirm: () => {
      void performFactoryReset()
    },
    refocusOnClose: opts.refocusOnClose,
  })
}

/** Wipe everything per-origin then force a full page reload.
 *  Storage APIs are individually try/catch'd so a single failure
 *  (private mode, quota error) doesn't block the rest of the wipe.
 *  The final reload bypasses cache to guarantee the post-reset state
 *  isn't tainted by a stale bundle. */
async function performFactoryReset(): Promise<void> {
  // IndexedDB: enumerate and drop every database under this origin.
  // `indexedDB.databases()` isn't universal (older Safari lacks it);
  // when absent, fall back to the well-known whiteboard DB name.
  try {
    if (typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases()
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name)
      }
    } else {
      indexedDB.deleteDatabase('whiteboard-local')
    }
  } catch (err) {
    console.warn('whiteboard/factory-reset: IDB clear failed:', err)
  }

  try {
    localStorage.clear()
  } catch (err) {
    console.warn('whiteboard/factory-reset: localStorage.clear failed:', err)
  }
  try {
    sessionStorage.clear()
  } catch (err) {
    console.warn('whiteboard/factory-reset: sessionStorage.clear failed:', err)
  }

  // CacheStorage — service-worker-managed caches. Optional API; not
  // present in some sandboxed contexts (file://, certain test envs).
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch (err) {
    console.warn('whiteboard/factory-reset: cache clear failed:', err)
  }

  // Service workers. The whiteboard doesn't currently register one,
  // but a future PWA milestone (M4.5) will — and a leftover SW from
  // an experiment is exactly the kind of stuck-state factory reset
  // should recover from.
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
  } catch (err) {
    console.warn('whiteboard/factory-reset: SW unregister failed:', err)
  }

  // Full reload. `location.reload()` respects the HTTP cache; for a
  // true clean slate we add a no-op query param so the request is a
  // new resource as far as any intermediate cache is concerned.
  // (The browser ignores the param; the bundler doesn't read it.)
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('factoryReset', String(Date.now()))
    window.location.replace(url.toString())
  } catch {
    window.location.reload()
  }
}
