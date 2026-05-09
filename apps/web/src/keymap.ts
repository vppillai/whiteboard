/**
 * Keyboard shortcut registry + dispatcher.
 *
 * Replaces the long if-chain that grew inside `main.ts` as features
 * accumulated. Modifier matching is exact: a binding for "Cmd/Ctrl + Z"
 * fires only when Cmd OR Ctrl is held *and* Shift / Alt are *not*.
 *
 * Single-letter keys ignore browser auto-repeat events. The dispatcher
 * handles `preventDefault()` per binding so handlers stay focused on
 * what to do, not which event-system rituals to perform.
 */

export interface KeyHandlers {
  // ⌘/Ctrl-modified
  undo: () => void
  redo: () => void
  zoomReset: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomToFit: () => void
  clear: () => void

  // Single-letter
  toggleTheme: () => void
  toggleColor: () => void
  toggleOptions: () => void
  toggleHelp: () => void

  /** Brush preset by 1-based index (1 → pen … 5 → brush). */
  selectBrush: (index1Based: number) => void

  /** Activate the drawing tool (pen). */
  selectDrawingTool: () => void
  /** Activate the eraser tool. */
  selectEraserTool: () => void

  /**
   * Esc handler. Return `true` if anything was actually cancelled — the
   * dispatcher then calls preventDefault. False / void means "Esc was a
   * no-op for us; let the browser handle it (e.g. in a focused input)."
   */
  cancel: () => boolean
}

export function attachKeymap(handlers: KeyHandlers): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const meta = e.metaKey || e.ctrlKey
    const { shiftKey: shift, altKey: alt } = e
    const k = e.key.toLowerCase()

    // ⌘/Ctrl-modified bindings.
    if (meta && !alt) {
      if (!shift && k === 'z') {
        preventAndCall(e, handlers.undo)
        return
      }
      if ((shift && k === 'z') || (!shift && k === 'y')) {
        preventAndCall(e, handlers.redo)
        return
      }
      if (!shift && e.key === '0') {
        preventAndCall(e, handlers.zoomReset)
        return
      }
      if (!shift && e.key === '1') {
        preventAndCall(e, handlers.zoomToFit)
        return
      }
      if (!shift && (e.key === '=' || e.key === '+')) {
        preventAndCall(e, handlers.zoomIn)
        return
      }
      if (!shift && e.key === '-') {
        preventAndCall(e, handlers.zoomOut)
        return
      }
      if (shift && k === 'k') {
        preventAndCall(e, handlers.clear)
        return
      }
    }

    // Esc cancels — dispatcher prevents default only if anything was actually
    // cancelled, so an Esc in a focused input still has its native effect.
    if (e.key === 'Escape') {
      if (handlers.cancel()) e.preventDefault()
      return
    }

    // Unmodified single-letter bindings (ignore auto-repeat).
    if (!meta && !alt && !shift && !e.repeat) {
      if (k === 't') {
        handlers.toggleTheme()
        return
      }
      if (k === 'c') {
        preventAndCall(e, handlers.toggleColor)
        return
      }
      if (k === 'o') {
        preventAndCall(e, handlers.toggleOptions)
        return
      }
      // Brush presets: 1..5 select the corresponding brush.
      if (e.key >= '1' && e.key <= '5') {
        handlers.selectBrush(Number(e.key))
        return
      }
      // Tool selection: B = drawing tool, E = eraser.
      if (k === 'b') {
        handlers.selectDrawingTool()
        return
      }
      if (k === 'e') {
        handlers.selectEraserTool()
        return
      }
    }

    if (e.key === '?' || (shift && e.key === '/')) {
      handlers.toggleHelp()
    }
  }

  document.addEventListener('keydown', onKey)
  return () => document.removeEventListener('keydown', onKey)
}

function preventAndCall(e: KeyboardEvent, fn: () => void): void {
  e.preventDefault()
  fn()
}
