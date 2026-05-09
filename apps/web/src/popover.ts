/**
 * Popover primitive — anchored at a client point, viewport-clamped, with a
 * pin / close header. Multiple popovers can be open simultaneously; pinning
 * keeps a popover alive across click-outside and selection events but `Esc`
 * and the close button always dismiss.
 *
 * Used by the color picker and the options menu. Future: brush picker, brush
 * settings, anything else that wants pen-friendly transient UI.
 */

export interface PopoverOptions {
  /** Anchor point in client coordinates (e.g., last-pointer position). */
  anchor: { x: number; y: number }
  /** Header title (uppercased small label). */
  title: string
  /** Body content. The popover takes ownership of this element. */
  content: HTMLElement
  /** Initial pin state. Defaults to false. */
  pinned?: boolean
  /**
   * Identity tag, exposed via `getActiveTag()`. Lets callers implement toggle
   * behavior — pressing the same shortcut again to dismiss the popover —
   * without having to retain a reference to the Popover themselves.
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
}

// Single-instance: at most one popover is alive at a time. Opening another
// replaces the previous one (regardless of pin state — pin keeps a popover
// alive across click-outside and selection events, not across explicit
// requests to open a different popover).
let active: { popover: Popover; tag?: string } | null = null

const PIN_SVG_OUTLINE =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>'

const PIN_SVG_FILLED =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>'

const CLOSE_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'

export function showPopover(opts: PopoverOptions): Popover {
  // Single-instance: replace any existing popover.
  active?.popover.dismiss()

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

  positionPopover(el, opts.anchor)

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
    if (active?.popover === popover) active = null
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

  // Capture-phase so we see clicks before stroke handlers do.
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('pointerdown', onOutsidePointer, true)

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
  }
  active = { popover, tag: opts.tag }
  return popover
}

/** Dismisses the active popover, if any. Returns true if one was dismissed. */
export function dismissAllPopovers(): boolean {
  if (!active) return false
  active.popover.dismiss()
  return true
}

/** Returns the tag of the active popover, or undefined if none is open. */
export function getActiveTag(): string | undefined {
  return active?.tag
}

function positionPopover(el: HTMLElement, anchor: { x: number; y: number }): void {
  // Offscreen-render to measure.
  el.style.left = '0px'
  el.style.top = '0px'
  el.style.visibility = 'hidden'

  const rect = el.getBoundingClientRect()

  el.style.visibility = ''

  const margin = 8
  const offset = 12 // gap below pointer
  let x = anchor.x - rect.width / 2
  let y = anchor.y + offset

  // Clamp horizontally.
  x = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))

  // If popover would overflow bottom, place above the pointer instead.
  if (y + rect.height + margin > window.innerHeight) {
    y = anchor.y - rect.height - offset
  }
  y = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))

  el.style.left = `${x}px`
  el.style.top = `${y}px`
}
