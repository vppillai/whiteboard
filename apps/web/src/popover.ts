/**
 * Popover primitive — anchored at a client point, viewport-clamped, with a
 * pin / close header. Multiple popovers can be open simultaneously; pinning
 * keeps a popover alive across click-outside and selection events but `Esc`
 * and the close button always dismiss.
 *
 * Coexistence rules:
 *   - Pinned popovers SURVIVE the opening of a new popover with a different
 *     tag — e.g. a pinned tools menu stays alive when the user opens the
 *     export popover from it. Pin is the user's "keep this alive" promise.
 *   - Opening a popover with the SAME tag as an existing one always
 *     replaces (pinned or not). This makes toggle shortcuts behave
 *     consistently — pressing `C` twice with a pinned color picker open
 *     dismisses the picker; opening the same picker again from the menu
 *     replaces rather than stacking duplicates.
 *   - Untagged popovers replace any existing untagged popover (and only
 *     each other). Tags + untagged are independent slots.
 *
 * Used by the right-click tool menu, color picker, options menu, export
 * popover. Future: brush picker, brush settings, anything else that wants
 * pen-friendly transient UI.
 */

export interface PopoverOptions {
  /** Anchor point in client coordinates (e.g., last-pointer position).
   *  Interpretation depends on `placement`:
   *    - 'below' (default): popover is centered horizontally on `anchor.x`
   *      and placed `offset` px below `anchor.y` (or above if no room).
   *    - 'right-of': `anchor.x` becomes the LEFT edge of the popover and
   *      `anchor.y` becomes the TOP edge — used for sub-popovers that
   *      should layer beside a parent menu rather than over it. Falls
   *      back to mirroring on the left if `anchor.x` doesn't leave room
   *      to the right of the viewport. v1.4. */
  anchor: { x: number; y: number }
  /** Optional placement hint. See `anchor` docs. Defaults to 'below'. */
  placement?: 'below' | 'right-of'
  /** Header title (uppercased small label). */
  title: string
  /** Body content. The popover takes ownership of this element. */
  content: HTMLElement
  /** Initial pin state. Defaults to false. */
  pinned?: boolean
  /**
   * Identity tag — used by the same-tag-replaces dispatch rule and by
   * `findPopoverByTag` / `isPopoverActive` toggle-shortcut callers
   * (pressing the same shortcut twice to dismiss the popover) without
   * having to retain a reference to the Popover themselves.
   */
  tag?: string
  /** Called after the popover dismisses (manually or via outside / Esc). */
  onDismiss?: () => void
}

export interface Popover {
  el: HTMLElement
  isPinned(): boolean
  setPinned(pinned: boolean): void
  /** Manually dismiss. */
  dismiss(): void
  /** A selection happened in the body — auto-dismiss unless pinned. */
  noteSelection(): void
  /** Briefly pulse the popover to draw the user's eye. Used when a user
   *  action (e.g. right-click on canvas) would normally open a new
   *  popover but a pinned popover already exists — pulsing the pinned
   *  one tells the user "your context menu is over there, use it"
   *  without programmatically moving the OS cursor (which browsers
   *  don't allow). */
  flashAttention(): void
}

/** Registry of all currently-alive popovers. Replaces the prior single-
 *  slot model so pinned popovers can survive the opening of a popover
 *  with a different tag (e.g. pin tools menu, open export — both stay
 *  visible). Same-tag opens always replace (regardless of pin) so
 *  toggle shortcuts stay deterministic. */
interface ActiveEntry {
  popover: Popover
  tag?: string
}
const activeRegistry: ActiveEntry[] = []

const PIN_SVG_OUTLINE =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>'

const PIN_SVG_FILLED =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>'

const CLOSE_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

export function showPopover(opts: PopoverOptions): Popover {
  // Same-tag replacement: dismiss any existing popover whose tag
  // matches. Different-tag popovers — including PINNED ones — survive
  // so the user's "keep this alive" promise across opening a different
  // popover is honored. Untagged popovers replace any existing
  // untagged popover (so transient anonymous popovers don't stack).
  for (let i = activeRegistry.length - 1; i >= 0; i--) {
    const entry = activeRegistry[i]
    if (!entry) continue
    if (entry.tag === opts.tag) {
      entry.popover.dismiss()
    }
  }

  const el = document.createElement('div')
  el.className = 'whiteboard-popover'

  const header = document.createElement('div')
  header.className = 'whiteboard-popover-header'

  const title = document.createElement('div')
  title.className = 'whiteboard-popover-title'
  title.textContent = opts.title
  header.appendChild(title)

  const actions = document.createElement('div')
  actions.className = 'whiteboard-popover-actions'

  const pinBtn = document.createElement('button')
  pinBtn.className = 'whiteboard-popover-icon-btn whiteboard-popover-pin'
  pinBtn.type = 'button'
  pinBtn.title = 'Pin (keep open)'
  pinBtn.setAttribute('aria-label', 'Pin')

  const closeBtn = document.createElement('button')
  closeBtn.className = 'whiteboard-popover-icon-btn'
  closeBtn.type = 'button'
  closeBtn.title = 'Close'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.innerHTML = CLOSE_SVG

  actions.append(pinBtn, closeBtn)
  header.appendChild(actions)

  el.appendChild(header)
  el.appendChild(opts.content)
  document.body.appendChild(el)

  positionPopover(el, opts.anchor, opts.placement ?? 'below')

  let pinned = opts.pinned ?? false
  syncPinUI()

  function syncPinUI(): void {
    pinBtn.innerHTML = pinned ? PIN_SVG_FILLED : PIN_SVG_OUTLINE
    pinBtn.classList.toggle('pinned', pinned)
  }

  let dismissed = false
  function dismiss(): void {
    if (dismissed) return
    dismissed = true
    const idx = activeRegistry.findIndex((e) => e.popover === popover)
    if (idx >= 0) activeRegistry.splice(idx, 1)
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('pointerdown', onOutsidePointer, true)
    el.remove()
    opts.onDismiss?.()
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      dismiss()
    }
  }

  function onOutsidePointer(e: PointerEvent): void {
    if (pinned) return
    if (el.contains(e.target as Node)) return
    dismiss()
  }

  pinBtn.addEventListener('click', () => {
    pinned = !pinned
    syncPinUI()
  })
  closeBtn.addEventListener('click', dismiss)

  // Drag-to-move via the header. Click on title / empty header area starts
  // a drag; clicks on the pin/close buttons don't (they're tested first via
  // closest() check). Position is clamped to the viewport. M2 feel-test add.
  let drag: { dx: number; dy: number; pointerId: number } | null = null
  header.style.cursor = 'grab'
  header.addEventListener('pointerdown', (e: PointerEvent) => {
    // Skip drags initiated on the action buttons — they have their own handlers.
    if ((e.target as HTMLElement).closest('.whiteboard-popover-icon-btn')) return
    const rect = el.getBoundingClientRect()
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, pointerId: e.pointerId }
    header.setPointerCapture(e.pointerId)
    header.style.cursor = 'grabbing'
    // Once user drags, become pinned — they want to keep this popover open
    // to interact with it from a new position.
    if (!pinned) {
      pinned = true
      syncPinUI()
    }
  })
  header.addEventListener('pointermove', (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const margin = 8
    const w = el.offsetWidth
    const h = el.offsetHeight
    let x = e.clientX - drag.dx
    let y = e.clientY - drag.dy
    x = Math.max(margin, Math.min(x, window.innerWidth - w - margin))
    y = Math.max(margin, Math.min(y, window.innerHeight - h - margin))
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  })
  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointerId) return
    if (header.hasPointerCapture(drag.pointerId)) header.releasePointerCapture(drag.pointerId)
    drag = null
    header.style.cursor = 'grab'
  }
  header.addEventListener('pointerup', endDrag)
  header.addEventListener('pointercancel', endDrag)

  // Capture-phase so we see clicks before stroke handlers do.
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onOutsidePointer, true)

  let flashTimer: number | null = null
  function flashAttention(): void {
    el.classList.remove('whiteboard-popover-flash')
    // Force a reflow so re-adding the class restarts the CSS animation.
    void el.offsetWidth
    el.classList.add('whiteboard-popover-flash')
    if (flashTimer !== null) window.clearTimeout(flashTimer)
    flashTimer = window.setTimeout(() => {
      el.classList.remove('whiteboard-popover-flash')
      flashTimer = null
    }, 600)
    // Bring the popover into view if it scrolled off (e.g. user panned).
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const popover: Popover = {
    el,
    isPinned: () => pinned,
    setPinned: (p) => {
      pinned = p
      syncPinUI()
    },
    dismiss,
    noteSelection: () => {
      if (!pinned) dismiss()
    },
    flashAttention,
  }
  activeRegistry.push({ popover, tag: opts.tag })
  return popover
}

/** Dismisses EVERY currently-alive popover, including pinned ones.
 *  Used by Esc (the universal close-all) and by distraction-free mode
 *  enter. Returns true if any popover was dismissed. Iterates in
 *  reverse so each dismiss can safely splice itself out of the array. */
export function dismissAllPopovers(): boolean {
  if (activeRegistry.length === 0) return false
  // Snapshot the list before iterating — dismiss() mutates the registry.
  const snapshot = activeRegistry.slice()
  for (const entry of snapshot) {
    entry.popover.dismiss()
  }
  return true
}

/** Find an active popover by tag. Returns the most-recently-opened
 *  one with that tag, or null if none. Used by toggle-shortcut callers
 *  (press `C` to open/close color picker) and by the right-click tool
 *  menu re-open detector. */
export function findPopoverByTag(tag: string): Popover | null {
  for (let i = activeRegistry.length - 1; i >= 0; i--) {
    const entry = activeRegistry[i]
    if (entry?.tag === tag) return entry.popover
  }
  return null
}

/** True if a popover with the given tag is currently active. Thin
 *  wrapper over `findPopoverByTag` for call sites that don't need
 *  the popover reference itself. */
export function isPopoverActive(tag: string): boolean {
  return findPopoverByTag(tag) !== null
}

/** Deprecated. Kept for back-compat — returns the tag of the most-
 *  recently-opened popover, or undefined. New callers should prefer
 *  `findPopoverByTag(specificTag)` since multiple popovers can be
 *  alive simultaneously and "the active one" is ambiguous. */
export function getActiveTag(): string | undefined {
  return activeRegistry[activeRegistry.length - 1]?.tag
}

/** Returns the most-recently-opened popover, or null. Same caveat as
 *  `getActiveTag` — prefer `findPopoverByTag` when a specific
 *  popover is intended. */
export function getActivePopover(): Popover | null {
  return activeRegistry[activeRegistry.length - 1]?.popover ?? null
}

function positionPopover(
  el: HTMLElement,
  anchor: { x: number; y: number },
  placement: 'below' | 'right-of',
): void {
  // Offscreen-render to measure.
  el.style.left = '0px'
  el.style.top = '0px'
  el.style.visibility = 'hidden'

  const rect = el.getBoundingClientRect()

  el.style.visibility = ''

  const margin = 8
  const offset = 12 // gap from anchor (below for 'below', side-gap for 'right-of')

  let x: number
  let y: number

  if (placement === 'right-of') {
    // Anchor specifies the LEFT/TOP of a region to layer beside —
    // typically a parent menu's right-edge midpoint passed by the
    // caller. Place the popover's left edge `offset` px to the right
    // of `anchor.x`. If that would overflow the viewport, mirror to
    // the left of the parent (anchor.x becomes the RIGHT edge minus
    // popover width minus offset). Vertically aligned to anchor.y
    // with the same overflow clamp.
    const wantsLeft = anchor.x + offset + rect.width + margin > window.innerWidth
    x = wantsLeft ? anchor.x - rect.width - offset : anchor.x + offset
    y = anchor.y
  } else {
    // 'below' (default) — center horizontally on anchor.x, below
    // anchor.y; flip above if no room below.
    x = anchor.x - rect.width / 2
    y = anchor.y + offset
    if (y + rect.height + margin > window.innerHeight) {
      y = anchor.y - rect.height - offset
    }
  }

  // Clamp to viewport in both dimensions.
  x = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
  y = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))

  el.style.left = `${x}px`
  el.style.top = `${y}px`
}
