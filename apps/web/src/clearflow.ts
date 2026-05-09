/**
 * Clear-board confirmation flow.
 *
 * The flow is intentionally two-step (priming toast + actual confirm) so a
 * stray keystroke or stray right-click + menu-item doesn't wipe the board
 * irreversibly. Both the keyboard path (⌘/Ctrl + Shift + K twice within the
 * window) and the pen-only path (right-click → "Clear board…" → "Clear" in
 * the toast) converge here.
 */

const CLEAR_CONFIRM_MS = 4000

export interface ClearFlow {
  /**
   * Trigger the clear flow. First call shows the priming toast; second call
   * within the confirmation window performs the clear.
   */
  request(): void
  /** Cancel any pending confirmation. Returns true if there was one. */
  cancel(): boolean
}

export interface ClearFlowOptions {
  /** Called only when the user actually confirms. */
  onPerformClear: () => void
}

export function createClearFlow(opts: ClearFlowOptions): ClearFlow {
  const toast = document.createElement('div')
  toast.id = 'whiteboard-toast'
  toast.style.display = 'none'
  document.body.appendChild(toast)

  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = (): boolean => {
    if (timer === null) return false
    clearTimeout(timer)
    timer = null
    toast.replaceChildren()
    toast.style.display = 'none'
    return true
  }

  const renderToast = (): void => {
    toast.replaceChildren()
    toast.style.display = 'flex'

    const msg = document.createElement('span')
    msg.className = 'whiteboard-toast-message'
    msg.textContent = 'Clear the whole board?'

    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'whiteboard-toast-button whiteboard-toast-cancel'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', cancel)

    const confirmBtn = document.createElement('button')
    confirmBtn.type = 'button'
    confirmBtn.className = 'whiteboard-toast-button whiteboard-toast-confirm'
    confirmBtn.textContent = 'Clear'
    confirmBtn.addEventListener('click', () => {
      cancel()
      opts.onPerformClear()
    })

    toast.append(msg, cancelBtn, confirmBtn)
  }

  const request = (): void => {
    if (timer !== null) {
      // Second press of the keyboard shortcut — confirm.
      cancel()
      opts.onPerformClear()
      return
    }
    renderToast()
    timer = setTimeout(cancel, CLEAR_CONFIRM_MS)
  }

  return { request, cancel }
}
