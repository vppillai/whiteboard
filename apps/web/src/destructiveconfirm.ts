/**
 * Generalized priming-toast for destructive actions. First call shows the
 * toast; second call within the window confirms. Esc cancels. Refocuses a
 * caller-supplied element on close (typically the canvas root) so subsequent
 * keystrokes / pen events don't route through a stale button.
 *
 * Used by clearflow.ts (clear board) and resetflow.ts (reset settings).
 */

const DEFAULT_WINDOW_MS = 4000

export interface DestructiveConfirm {
  request(): void
  cancel(): boolean
}

export interface DestructiveConfirmOptions {
  message: string
  confirmLabel: string
  onConfirm: () => void
  refocusOnClose?: HTMLElement
  windowMs?: number
}

export function createDestructiveConfirm(opts: DestructiveConfirmOptions): DestructiveConfirm {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS
  // Created here but only attached to the DOM while visible: main.ts builds
  // several confirms (clear + reset flows), and keeping idle copies of
  // `#whiteboard-toast` in the document would break id uniqueness (the CSS
  // styles the toast by id).
  const toast = document.createElement('div')
  toast.id = 'whiteboard-toast'

  let timer: ReturnType<typeof setTimeout> | null = null

  const refocus = (): void => {
    opts.refocusOnClose?.focus({ preventScroll: true })
  }

  const cancel = (): boolean => {
    if (timer === null) return false
    clearTimeout(timer)
    timer = null
    toast.replaceChildren()
    toast.remove()
    refocus()
    return true
  }

  const renderToast = (): void => {
    toast.replaceChildren()
    // CSS (`#whiteboard-toast`) supplies layout but not `display`; flex is
    // set inline, as before, and the element is attached only while shown.
    toast.style.display = 'flex'
    document.body.appendChild(toast)

    const msg = document.createElement('span')
    msg.className = 'whiteboard-toast-message'
    msg.textContent = opts.message

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'whiteboard-toast-button whiteboard-toast-cancel'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', cancel)

    const confirmBtn = document.createElement('button')
    confirmBtn.type = 'button'
    confirmBtn.className = 'whiteboard-toast-button whiteboard-toast-confirm'
    confirmBtn.textContent = opts.confirmLabel
    confirmBtn.addEventListener('click', () => {
      cancel()
      opts.onConfirm()
    })

    toast.append(msg, cancelBtn, confirmBtn)
    // Focus lands on CANCEL, not the destructive action: the toast often
    // appears right after an Enter/Space press on the triggering button,
    // and a stray repeat of that key must not complete an irreversible
    // wipe. Confirming stays a deliberate act (click, Tab+Enter, or a
    // second request()).
    cancelBtn.focus({ preventScroll: true })
  }

  const request = (): void => {
    if (timer !== null) {
      cancel()
      opts.onConfirm()
      return
    }
    renderToast()
    timer = setTimeout(cancel, windowMs)
  }

  return { request, cancel }
}
