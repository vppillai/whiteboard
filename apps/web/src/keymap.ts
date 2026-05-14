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
  /** Activate the Select tool for object manipulation (images, texts,
   *  and strokes) — single-object and multi-object. Bound to `V` (the
   *  Figma / Sketch / Excalidraw convention for the universal pointer
   *  / select tool) AND `S` (preserved muscle memory from the v1.x
   *  lasso tool, which Select absorbed in v1.3). */
  selectSelectTool: () => void
  /** Activate the laser pointer tool. v1.4 moved this binding from `L`
   *  to `P` to free up `L` for the line-shape shortcut. The pen-default
   *  shortcut that used to live on `P` now sits on `Shift+P`. */
  selectLaserTool: () => void
  /** Activate the Shape tool with a specific sub-mode (rect / ellipse /
   *  line / arrow). v1.4. Pressing R/O/A/L always activates Shape and
   *  switches sub-mode; pressing the same key while Shape is active is
   *  idempotent (sub-mode is already set). The sticky `shapeKind` is
   *  updated so re-entering the tool later via the right-click menu
   *  remembers the last picked shape. */
  selectShapeRect: () => void
  selectShapeEllipse: () => void
  selectShapeLine: () => void
  selectShapeArrow: () => void
  /** Activate the text tool. Bound to `T`. (Theme cycling moved to
   *  `Shift+T` to free up the unmodified key for this — per the v1.2
   *  user request that text be primary on T.) */
  selectTextTool: () => void
  /** Toggle bold / italic / underline on the active text. Routed from
   *  Cmd/Ctrl+B/I/U. The text tool itself intercepts these inside its
   *  contenteditable; the global keymap handlers are a backup for the
   *  edge case where the editable isn't the focused element. */
  toggleTextBold: () => void
  toggleTextItalic: () => void
  toggleTextUnderline: () => void
  /** Delete the active Select-tool selection (single or multi). Returns
   *  `true` if anything was actually deleted; the dispatcher uses this
   *  to decide whether to preventDefault (so Backspace doesn't trigger
   *  browser history-back). */
  deleteSelection: () => boolean
  /** Select all non-deleted objects across all kinds (strokes + images
   *  + texts). Activates the Select tool if not already active. */
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
      // Cmd/Ctrl+B/I/U — text formatting. Only meaningful inside text
      // edit mode; the handler itself no-ops when not editing, so
      // intercepting unconditionally is safe (and lets us preventDefault
      // so the browser doesn't try its own bold/italic/underline action).
      if (!shift && k === 'b') {
        preventAndCall(e, handlers.toggleTextBold)
        return
      }
      if (!shift && k === 'i') {
        preventAndCall(e, handlers.toggleTextItalic)
        return
      }
      if (!shift && k === 'u') {
        preventAndCall(e, handlers.toggleTextUnderline)
        return
      }
    }

    // Esc cancels — dispatcher prevents default only if anything was actually
    // cancelled, so an Esc in a focused input still has its native effect.
    if (e.key === 'Escape') {
      if (handlers.cancel()) e.preventDefault()
      return
    }

    // Delete / Backspace removes the Select-tool selection. preventDefault
    // only on success so Backspace can still go-back when there's no
    // selection (and when typed into a focused input — there are none in
    // v1, but future-proof).
    if (!meta && !alt && (e.key === 'Delete' || e.key === 'Backspace')) {
      if (handlers.deleteSelection()) e.preventDefault()
      return
    }

    // Unmodified single-letter bindings (ignore auto-repeat).
    if (!meta && !alt && !shift && !e.repeat) {
      if (k === 't') {
        // T enters Text mode (v1.2). Theme cycle moved to Shift+T.
        handlers.selectTextTool()
        return
      }
      // Brush presets: 1..5 select the corresponding brush.
      if (e.key >= '1' && e.key <= '5') {
        handlers.selectBrush(Number(e.key))
        return
      }
      // Tool selection. B = drawing tool (brush unchanged). v1.4 rebinds:
      //   P  → laser (was Shift+P territory; tldraw / Excalidraw-ish)
      //   Shift+P → selectPenDefault (the prior plain-P)
      // Plain E is owned by `eraserhold.ts` (pure spring-loaded modifier).
      if (k === 'b') {
        handlers.selectDrawingTool()
        return
      }
      if (k === 'p') {
        // v1.4: P now activates the laser pointer (was on L). The prior
        // pen-default binding moved to Shift+P.
        handlers.selectLaserTool()
        return
      }
      // V AND S — Select tool (universal pointer for any object kind).
      // V follows the Figma / Sketch / Excalidraw convention; S is
      // preserved muscle-memory from the v1.x lasso tool that Select
      // absorbed in v1.3.
      if (k === 'v' || k === 's') {
        handlers.selectSelectTool()
        return
      }
      // Shape tool sub-mode shortcuts (v1.4). Each key both activates the
      // Shape tool and sets the sub-mode in one stroke. R / O / A / L
      // override several prior single-key bindings:
      //   L → was selectLaserTool; laser moved to P.
      //   O → was toggleOptions; that moved to Shift+O.
      // The "set sub-mode + activate" combo is intentional — discoverable
      // (one key per shape) and idempotent (re-pressing the same key
      // doesn't re-toggle anything).
      if (k === 'r') {
        handlers.selectShapeRect()
        return
      }
      if (k === 'o') {
        handlers.selectShapeEllipse()
        return
      }
      if (k === 'a') {
        handlers.selectShapeArrow()
        return
      }
      if (k === 'l') {
        handlers.selectShapeLine()
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
      // Shift+T cycles theme (moved from plain T when text gained T in v1.2).
      if (k === 't') {
        handlers.toggleTheme()
        return
      }
      // v1.4 rebinds: the prior plain-key bindings for the color picker /
      // options menu / pen-default move to their Shift-modified forms so
      // the unshifted keys are free for the Shape tool sub-modes.
      if (k === 'c') {
        preventAndCall(e, handlers.toggleColor)
        return
      }
      if (k === 'o') {
        preventAndCall(e, handlers.toggleOptions)
        return
      }
      if (k === 'p') {
        preventAndCall(e, handlers.selectPenDefault)
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
