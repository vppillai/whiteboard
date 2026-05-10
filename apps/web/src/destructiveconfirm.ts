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
  const toast = document.createElement('div')
  toast.id = 'whiteboard-toast'
  toast.style.display = 'none'
  document.body.appendChild(toast)

  let timer: ReturnType<typeof setTimeout> | null = null

  const refocus = (): void => {
    opts.refocusOnClose?.focus({ preventScroll: true })
  }

  const cancel = (): boolean => {
    if (timer === null) return false
    clearTimeout(timer)
    timer = null
    toast.replaceChildren()
    toast.style.display = 'none'
    refocus()
    return true
  }

  const renderToast = (): void => {
    toast.replaceChildren()
    toast.style.display = 'flex'

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
    confirmBtn.focus({ preventScroll: true })
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
