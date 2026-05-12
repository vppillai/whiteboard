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

  /** Activate the drawing tool (pen). Brush preset unchanged. */
  selectDrawingTool: () => void
  /** Activate the drawing tool AND switch to the Pen brush preset — the
   *  full equivalent of right-click → Draw + Pen. */
  selectPenDefault: () => void
  /** Activate the eraser tool persistently (sticky toggle). Bound to Shift+E
   *  because plain E is pure spring-loaded — see `eraserhold.ts`. */
  selectEraserSticky: () => void
  /** Activate the lasso tool. Bound to `S`. */
  selectLassoTool: () => void
  /** Activate the Select tool for image manipulation. Bound to `V` —
   *  the Figma / Sketch / Excalidraw convention for the pointer/select
   *  tool. */
  selectSelectTool: () => void
  /** Activate the laser pointer tool. Bound to `L`. Ephemeral fading
   *  trail for presentations; nothing persisted. */
  selectLaserTool: () => void
  /** Delete the active selection (lasso). Returns `true` if anything was
   *  actually deleted; the dispatcher uses this to decide whether to
   *  preventDefault (so Backspace doesn't trigger browser history-back). */
  deleteSelection: () => boolean
  /** Select all non-deleted strokes via the lasso. Activates lasso if not
   *  already active. */
  selectAll: () => void
  /** Toggle the settings side panel (Cmd/Ctrl+,). Open if closed, dismiss if
   *  open — single-instance side panel handles the toggle semantics. */
  togglePanel: () => void

  /**
   * Esc handler. Return `true` if anything was actually cancelled — the
   * dispatcher then calls preventDefault. False / void means "Esc was a
   * no-op for us; let the browser handle it (e.g. in a focused input)."
   */
  cancel: () => boolean

  /** Toggle distraction-free mode (hides app chrome). Bound to `F`. M2. */
  toggleDistractionFree: () => void

  /** Cycle to the previous color in the curated palette. Bound to Shift+[. M2. */
  cyclePaletteBackward: () => void
  /** Cycle to the next color in the curated palette. Bound to Shift+]. M2. */
  cyclePaletteForward: () => void

  /** Open the export popover (PNG / SVG / PDF) at last pointer. Bound to
   *  Cmd/Ctrl+E. M2. */
  openExport: () => void
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
      if (!shift && k === 'a') {
        preventAndCall(e, handlers.selectAll)
        return
      }
      if (!shift && k === ',') {
        preventAndCall(e, handlers.togglePanel)
        return
      }
      // Cmd/Ctrl+E — export popover (PNG / SVG / PDF) at cursor. M2.
      if (!shift && k === 'e') {
        preventAndCall(e, handlers.openExport)
        return
      }
    }

    // Esc cancels — dispatcher prevents default only if anything was actually
    // cancelled, so an Esc in a focused input still has its native effect.
    if (e.key === 'Escape') {
      if (handlers.cancel()) e.preventDefault()
      return
    }

    // Delete / Backspace removes the lasso selection. preventDefault only on
    // success so Backspace can still go-back when there's no selection (and
    // when typed into a focused input — there are none in v1, but future-proof).
    if (!meta && !alt && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (handlers.deleteSelection()) e.preventDefault()
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
      // Tool selection. B = drawing tool (brush unchanged); P = drawing tool
      // + Pen brush preset (i.e. "go to my default drawing setup"). Plain E
      // is owned by `eraserhold.ts` (pure spring-loaded modifier).
      if (k === 'b') {
        handlers.selectDrawingTool()
        return
      }
      if (k === 'p') {
        handlers.selectPenDefault()
        return
      }
      if (k === 's') {
        handlers.selectLassoTool()
        return
      }
      // V — Select tool (image manipulation). Figma/Sketch convention.
      if (k === 'v') {
        handlers.selectSelectTool()
        return
      }
      // L — Laser pointer (ephemeral fading trail).
      if (k === 'l') {
        handlers.selectLaserTool()
        return
      }
      // F — toggle distraction-free mode (hides chrome). M2.
      if (k === 'f') {
        handlers.toggleDistractionFree()
        return
      }
    }

    // Shift-modified single-letter bindings.
    if (!meta && !alt && shift && !e.repeat) {
      // Shift+E: sticky eraser (the counterpart to plain E's spring-load).
      if (k === 'e') {
        handlers.selectEraserSticky()
        return
      }
      // Shift+[ / Shift+] — cycle curated palette. M2.
      // Note: `e.key` is `{` / `}` on most layouts when Shift is held with
      // `[` / `]`. Match either the literal bracket or the shifted form.
      if (e.key === '{' || (shift && k === '[')) {
        handlers.cyclePaletteBackward()
        return
      }
      if (e.key === '}' || (shift && k === ']')) {
        handlers.cyclePaletteForward()
        return
      }
    }

    if (e.key === '?' || (shift && e.key === '/')) {
      e.preventDefault()
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
