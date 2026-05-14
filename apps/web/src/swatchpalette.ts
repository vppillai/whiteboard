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
 * The add tile opens a sub-popover with tag `'swatch-add'`; after
 * commit / cancel it dismisses ONLY itself (via tag-targeted dismiss)
 * so a pinned right-click menu survives the round-trip. `onAddDone`
 * fires after either path so the host can rebuild its content with
 * the new swatch present.
 */

import { CURATED_COLORS } from './colorpicker'
import { findPopoverByTag, showPopover } from './popover'
import { getCustomSwatches } from './settings'
import { createSwatchAdd } from './swatchadd'

export interface SwatchPaletteOptions {
  /** Currently-active color token — used for the active-state highlight. */
  active: string
  /** Called when the user clicks any swatch. The caller is responsible
   *  for any post-pick side effects (writing the setting, emitting an
   *  edit-shape op, dismissing the menu). */
  onPick: (color: string) => void
  /** Anchor for the swatch-add sub-popover. Same x/y the parent menu
   *  was opened at — the sub-popover layers over the menu via the
   *  popover module's multi-coexistence model (different tag). */
  addAt: { x: number; y: number }
  /** Optional. Called after the user finishes the add flow — whether
   *  they committed a new swatch or canceled. Hosts use this to
   *  rebuild their content so the new swatch (if any) appears
   *  immediately in the parent menu. */
  onAddDone?: () => void
}

export function buildSwatchPalette(opts: SwatchPaletteOptions): HTMLDivElement {
  const palette = document.createElement('div')
  palette.className = 'whiteboard-tools-palette'

  for (const c of CURATED_COLORS) {
    palette.appendChild(makeSwatch(c, false, opts.active, () => opts.onPick(c)))
  }
  for (const c of getCustomSwatches()) {
    palette.appendChild(makeSwatch(c, true, opts.active, () => opts.onPick(c)))
  }
  palette.appendChild(makeAddTile(() => openAddSubpopover(opts)))
  return palette
}

function makeSwatch(
  color: string,
  isCustom: boolean,
  active: string,
  onClick: () => void,
): HTMLButtonElement {
  const sw = document.createElement('button')
  sw.type = 'button'
  sw.className = 'whiteboard-color-swatch whiteboard-color-swatch-small'
  if (isCustom) sw.classList.add('whiteboard-color-swatch-custom')
  sw.dataset.color = color
  sw.title = color === 'ink' ? 'theme ink' : color
  sw.setAttribute('aria-label', sw.title)
  if (color === 'ink') sw.classList.add('whiteboard-color-swatch-ink')
  else sw.style.background = color
  if (active === color) sw.classList.add('active')
  sw.addEventListener('click', onClick)
  return sw
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

/** Open the swatch-add sub-popover. Coexists with the parent right-
 *  click menu (different tag), so dismissing the sub-popover doesn't
 *  kill the menu — the menu's `onAddDone` callback handles whatever
 *  rebuild semantics it needs.
 *
 *  Cancel path: we still call `onAddDone` because the user is back
 *  in the parent menu state and the menu might have been rebuilt
 *  pre-emptively (i.e. its current visible state is correct only if
 *  the parent was rebuilt). Safe to no-op there. */
function openAddSubpopover(opts: SwatchPaletteOptions): void {
  const subRoot = createSwatchAdd({
    onAdded: () => {
      findPopoverByTag('swatch-add')?.dismiss()
      opts.onAddDone?.()
    },
    onCancel: () => {
      findPopoverByTag('swatch-add')?.dismiss()
      opts.onAddDone?.()
    },
  })
  showPopover({
    anchor: opts.addAt,
    title: 'add color',
    content: subRoot,
    tag: 'swatch-add',
  })
}
