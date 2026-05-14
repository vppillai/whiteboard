/**
 * Bottom-left status pill. v1.4 — two pieces of always-visible
 * guidance:
 *   - "right-click → menu" so new users discover the tool menu without
 *     waiting for the one-shot first-run hint to fade in.
 *   - "? → help" for the full keyboard cheatsheet overlay.
 *
 * Earlier iterations also showed the active theme; that turned out
 * to be unnecessary clutter (the theme change is already visible in
 * the page colors), so the pill is now static guidance only.
 */

export function createHelpPill(): HTMLElement {
  const el = document.createElement('div')
  el.id = 'whiteboard-pill'
  el.textContent = 'right-click → menu  ·  ? → help'
  return el
}
