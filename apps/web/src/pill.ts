/**
 * Bottom-left status pill. Currently just "? for help" — the help overlay's
 * single visible affordance for users who haven't memorized the shortcuts.
 *
 * Earlier iterations also showed the active theme; that turned out to be
 * unnecessary clutter (the theme change is already visible in the page
 * colors), so the pill is now static text.
 */

export function createHelpPill(): HTMLElement {
  const el = document.createElement('div')
  el.id = 'whiteboard-pill'
  el.textContent = '? for help'
  return el
}
