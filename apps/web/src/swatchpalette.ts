/**
 * Shared swatch-palette factory for right-click contextual menus.
 *
 * Each per-tool contextual section (Shape, Select-shape, Pen, Text,
 * Select-text, Laser) needs to show: curated colors, the user's
 * custom swatches, and a "+" add-color tile that opens the same
 * swatch-add sub-popover the standalone Color picker (Shift+C) uses.
 * Pre-v1.4 the contextual menus rolled their own bare swatch grids
 * with no add affordance, so customs picked in the Color picker
 * weren't reachable from a right-click. This module unifies the build.
 *
 * Layout matches `.whiteboard-color-palette` (5-column grid, ~30 px
 * swatches) so the right-click affordance looks like a compact
 * version of the standalone Color picker — no per-menu retraining.
 *
 * Sub-popover placement: the swatch-add opens to the SIDE of the
 * parent right-click menu (placement: 'right-of'), not on top of it.
 * The popover module measures the parent menu element (found via
 * `findPopoverByTag('tools')`) so the side-of math uses the menu's
 * actual rendered bounds, not the mouse-click anchor. Mirrors to
 * the left of the parent automatically when there's no room to the
 * right (positionPopover overflow fallback).
 *
 * Custom swatch deletion: hovering a custom swatch reveals an "×"
 * badge in its top-right corner. Clicking the badge removes the
 * swatch via `removeCustomSwatch` and fires `onPaletteChanged` so
 * the host menu rebuilds with the deleted swatch gone. Curated
 * swatches don't get the badge (they're not deletable).
 */

import { CURATED_COLORS } from './colorpicker'
import { findPopoverByTag, showPopover } from './popover'
import { getCustomSwatches, removeCustomSwatch } from './settings'
import { createSwatchAdd } from './swatchadd'

export interface SwatchPaletteOptions {
  /** Currently-active color token — used for the active-state highlight. */
  active: string
  /** Called when the user clicks any swatch. The caller is responsible
   *  for any post-pick side effects (writing the setting, emitting an
   *  edit-shape op, dismissing the menu). */
  onPick: (color: string) => void
  /** Fallback anchor for the swatch-add sub-popover. Used only when the
   *  parent right-click menu can't be located (defensive — in normal
   *  flow we use the parent's actual rect for side-of placement). */
  addAt: { x: number; y: number }
  /** Optional. Called after the user (a) commits or cancels the add-
   *  color flow, or (b) deletes a custom swatch via the × badge.
   *  Hosts use this to rebuild their content so the change reflects
   *  immediately in the parent menu without the user needing to close
   *  and re-open it. Named "PaletteChanged" rather than the earlier
   *  "AddDone" since deletion now also triggers it. */
  onPaletteChanged?: () => void
}

export function buildSwatchPalette(opts: SwatchPaletteOptions): HTMLDivElement {
  const palette = document.createElement('div')
  palette.className = 'whiteboard-tools-palette'

  for (const c of CURATED_COLORS) {
    palette.appendChild(makeSwatch(c, false, opts))
  }
  for (const c of getCustomSwatches()) {
    palette.appendChild(makeSwatch(c, true, opts))
  }
  palette.appendChild(makeAddTile(() => openAddSubpopover(opts)))
  return palette
}

function makeSwatch(color: string, isCustom: boolean, opts: SwatchPaletteOptions): HTMLElement {
  const sw = document.createElement('button')
  sw.type = 'button'
  sw.className = 'whiteboard-color-swatch whiteboard-color-swatch-small'
  if (isCustom) sw.classList.add('whiteboard-color-swatch-custom')
  sw.dataset.color = color
  sw.title = color === 'ink' ? 'theme ink' : color
  sw.setAttribute('aria-label', sw.title)
  if (color === 'ink') sw.classList.add('whiteboard-color-swatch-ink')
  else sw.style.background = color
  if (opts.active === color) sw.classList.add('active')
  sw.addEventListener('click', () => opts.onPick(color))
  // Custom swatches get a hover-revealed × delete badge in the corner.
  // The badge is a <span role="button"> (not a <button>) so it can live
  // inside the swatch button — HTML doesn't allow nested interactive
  // elements, but a span with role="button" + Enter/Space handler is
  // accessible and DOM-legal. position: absolute on the badge anchors
  // it to the swatch's top-right corner via position: relative on
  // .whiteboard-color-swatch.
  if (isCustom) sw.appendChild(makeSwatchDeleteBadge(color, opts.onPaletteChanged))
  return sw
}

/** Build the × delete badge that overlays a custom swatch's top-right
 *  corner. Visible on hover (CSS-driven). Click removes the swatch and
 *  fires the supplied `onAfterDelete` callback so the host can refresh
 *  its rendering.
 *
 *  Implemented as a <span role="button"> (not a <button>) so it can
 *  sit INSIDE the swatch button element — HTML5 disallows interactive
 *  elements nested in <button>, but a span isn't interactive content
 *  per spec. role="button" + Enter/Space keyboard handler gives the
 *  same affordance to AT users.
 *
 *  `stopPropagation` on pointerdown is critical — without it, the
 *  click also reaches the parent swatch button and fires onPick on
 *  the now-deleted color, picking it back into the active state.
 *
 *  Exported and reused by both the right-click swatch palette and
 *  the standalone Color picker (Shift+C) — same DOM, same accessibility,
 *  same event semantics. */
export function makeSwatchDeleteBadge(color: string, onAfterDelete?: () => void): HTMLElement {
  const el = document.createElement('span')
  el.className = 'whiteboard-color-swatch-delete'
  el.setAttribute('role', 'button')
  el.setAttribute('aria-label', `Remove custom color ${color}`)
  el.title = `Remove custom color ${color}`
  el.tabIndex = 0
  el.textContent = '×'
  const handler = (e: Event): void => {
    e.preventDefault()
    e.stopPropagation()
    removeCustomSwatch(color)
    onAfterDelete?.()
  }
  el.addEventListener('pointerdown', handler)
  el.addEventListener('click', handler)
  el.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') handler(e)
  })
  return el
}

function makeAddTile(onClick: () => void): HTMLButtonElement {
  const tile = document.createElement('button')
  tile.type = 'button'
  tile.className =
    'whiteboard-color-swatch whiteboard-color-swatch-small whiteboard-color-swatch-add'
  tile.title = 'Add custom color'
  tile.setAttribute('aria-label', 'Add custom color')
  tile.textContent = '+'
  tile.addEventListener('click', onClick)
  return tile
}

/** Open the swatch-add sub-popover to the SIDE of the parent right-
 *  click menu (so the user can see the menu and the picker together).
 *  Falls back to the `addAt` anchor (mouse click position) if the
 *  parent menu can't be located — defensive, shouldn't happen in
 *  normal flow.
 *
 *  After commit / cancel: dismiss only the sub-popover (tag-targeted)
 *  so the parent menu survives. Fire `onPaletteChanged` so the menu
 *  rebuilds with the new swatch present.
 */
function openAddSubpopover(opts: SwatchPaletteOptions): void {
  const parent = findPopoverByTag('tools')
  // Anchor at the parent menu's right edge (vertically a bit below
  // top so the sub-popover doesn't crowd the menu's title bar).
  // positionPopover('right-of') auto-mirrors to the left side when
  // there's no room to the right.
  const anchor = parent
    ? (() => {
        const rect = parent.el.getBoundingClientRect()
        return { x: rect.right, y: rect.top + 8 }
      })()
    : opts.addAt
  const subRoot = createSwatchAdd({
    onAdded: () => {
      findPopoverByTag('swatch-add')?.dismiss()
      opts.onPaletteChanged?.()
    },
    onCancel: () => {
      findPopoverByTag('swatch-add')?.dismiss()
      opts.onPaletteChanged?.()
    },
  })
  showPopover({
    anchor,
    placement: parent ? 'right-of' : 'below',
    title: 'add color',
    content: subRoot,
    tag: 'swatch-add',
  })
}
