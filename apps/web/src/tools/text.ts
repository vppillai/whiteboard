/**
 * Text tool. Owns:
 *   - Placement: pointer-down on empty canvas creates a new TextObject
 *     at that location and enters edit mode immediately.
 *   - Drag: pointer-down on an existing text starts a tentative move.
 *     A click without drag-motion (released within DRAG_NOOP_PX of the
 *     start) promotes to edit mode on that text.
 *   - Edit: a contenteditable `<div>` is positioned over the canvas to
 *     receive keystrokes; Esc commits + returns to the previous tool.
 *
 * Why DOM overlay? Canvas can't take keyboard input. A DOM overlay
 * styled to look identical to the rendered text gives us native caret,
 * selection, IME composition, paste — everything for free. The on-canvas
 * version is hidden during edit via the `getEditingId()` getter consumed
 * by `rendertexts.ts`.
 *
 * Formatting model: OBJECT-LEVEL (the whole text is bold / italic /
 * underline, or none). Range-styled rich text inside a single text is
 * out of scope for v1 — simple per-text formatting is what most users
 * actually want, and the persisted record stays plain text + a font tag.
 *
 * Esc returns to the previous tool — main.ts owns that policy and
 * receives an `onEscExit` event from this module after the commit lands.
 * The text tool itself doesn't know which tool was previously active.
 *
 * ToolContext caching: the contextual menu and the external
 * `toggleFormat` entry (Cmd+B/I/U from main.ts's keymap) need access to
 * the camera + resolveColor without an event handing them in. We cache
 * the most recent ctx in `lastCtx` on each pointer event so menu / format
 * callsites can use it. If a menu opens before any pointer event has
 * fired (only happens via keyboard from a different tool), we skip the
 * camera-dependent visual refresh — the persistence still happens.
 */

import type { TextFontFamily, TextObject } from '@whiteboard/shared'
import { makeTextId } from '../ids'
import { pill, pillRow, sectionLabel, separator } from '../menu-ui'
import type { Op } from '../ops'
import {
  getTextBold,
  getTextColor,
  getTextFont,
  getTextItalic,
  getTextSize,
  getTextUnderline,
  setTextBold,
  setTextColor,
  setTextFont,
  setTextItalic,
  setTextSize,
  setTextUnderline,
} from '../settings'
import { buildSwatchPalette } from '../swatchpalette'
import {
  FONT_CSS,
  LINE_HEIGHT_MULT,
  TEXT_PADDING_X,
  TEXT_PADDING_Y,
  pointInText,
  resizeToFit,
} from '../textgeom'
import type { Tool, ToolContext } from './types'

/** Drag this many screen-pixels to upgrade a pointerdown from "click into
 *  edit mode" to "move drag". Generous because pen-on-tablet drift is
 *  significant on Wacom Intuos at default sensitivity. */
const DRAG_NOOP_PX = 4

/** Font families exposed in the contextual menu, in display order. */
const FONT_OPTIONS: { id: TextFontFamily; label: string }[] = [
  { id: 'mono', label: 'Mono' },
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
]

/** Size options in the contextual menu (board-pixel font sizes). 12 is
 *  the user-requested default. */
const SIZE_OPTIONS: number[] = [12, 14, 18, 24, 36]

export interface TextToolDeps {
  /** Live in-memory text array (mutated by ops). */
  getTexts: () => TextObject[]
  /** Next z slot above max(image z, text z). Single shared "object z"
   *  sequence keeps text + image stacking interleavable. */
  nextZ: () => number
  /** Push an op onto the undo stack. */
  pushOp: (op: Op) => void
  /** Persist a text record. */
  saveText: (t: TextObject) => void
  /** Mark the committed layer dirty (text render lives there). */
  markCommittedDirty: () => void
  /** Resolve a color token ('ink' / hex) to CSS. Mirrors ToolContext for
   *  use in callsites that don't have a ToolContext. */
  resolveColor: (token: string) => string
  /** Fires when the user presses Esc inside the editor (after commit).
   *  main.ts decides whether to switch tools — the tool itself doesn't
   *  need to know the previous tool id. Replaces the earlier
   *  setTool / getPreviousToolId callback pair, which created a
   *  re-entrant control flow (text → main.setTool → text.cleanup →
   *  text.commitEdit). The event-only shape keeps direction one-way. */
  onEscExit: () => void
}

export interface TextTool extends Tool {
  /** Id of the text currently in edit mode, or null. Read by the render
   *  loop to skip the on-canvas version of THAT text (the editable
   *  overlay paints it instead). */
  getEditingId(): string | null
  /** Returns true if the text tool is currently in edit mode. */
  isEditing(): boolean
  /** Toggle bold/italic/underline on the active text. Called from
   *  main.ts's keymap as a backup for Cmd+B/I/U when the editable
   *  doesn't intercept (e.g. focus left the editor for a moment). */
  toggleFormat(which: 'bold' | 'italic' | 'underline'): void
  /** Open the editor on an existing text by id. Used by the Select tool's
   *  double-click handoff: Select detects double-click on a text body,
   *  switches to Text tool via setTool, then calls this to immediately
   *  enter edit mode on the clicked text. `ctx` is needed because the
   *  Text tool's own pointer-event cache hasn't been populated yet —
   *  this is the FIRST interaction it sees after activation. Returns
   *  true on success; false if no text with the given id exists or it's
   *  soft-deleted. */
  editTextById(id: string, ctx: ToolContext): boolean
  /** Create a TextObject at the given board point with the user's sticky
   *  defaults, persist it, push the `create-text` op, and return its id.
   *  Used by main.ts's clipboard-text paste path so the paste flow goes
   *  through the same factory + same op as on-canvas text creation. Does
   *  NOT enter edit mode — the paste content is already final. */
  createTextAt(content: string, board: { x: number; y: number }): string
}

interface EditingState {
  text: TextObject
  /** Snapshot of the text's content / font / color / wrapWidth at
   *  edit-start. Used to build the edit-text op at commit time so
   *  undo can fully restore. wrapWidth is undefined for auto-width
   *  texts; both states round-trip through undo correctly. */
  before: {
    content: string
    font: TextObject['font']
    color: string
    wrapWidth: number | undefined
  }
  /** The contenteditable host. */
  el: HTMLDivElement
  /** Wire-up cleanups (event listeners). */
  cleanups: Array<() => void>
  /** True if this edit started from creating a new text. Determines
   *  whether commit pushes 'create-text' or 'edit-text'. */
  isNewText: boolean
}

interface DragState {
  textId: string
  startScreen: { x: number; y: number }
  before: TextObject['transform']
  movedPastNoop: boolean
}

export function createTextTool(deps: TextToolDeps): TextTool {
  let editing: EditingState | null = null
  let drag: DragState | null = null
  // Cache the most recent ToolContext from a pointer event. The contextual
  // menu and the external toggleFormat entry use it for camera-aware
  // visual refresh; both run AFTER at least one pointer event in normal
  // flows. null until populated; callsites null-check.
  let lastCtx: ToolContext | null = null

  /** Single factory for new TextObjects with sticky defaults applied + the
   *  content rect already measured. Used by both placement (empty-space
   *  pointerdown → enter edit mode) AND clipboard-text paste (content
   *  arrives pre-filled, never enters edit mode). Pure: builds and
   *  returns; the caller pushes / persists / op-records as appropriate
   *  for its flow. */
  const buildTextFromDefaults = (content: string, board: { x: number; y: number }): TextObject => {
    const nt: TextObject = {
      id: makeTextId(),
      content,
      font: {
        family: getTextFont(),
        size: getTextSize(),
        bold: getTextBold(),
        italic: getTextItalic(),
        underline: getTextUnderline(),
      },
      color: getTextColor(),
      transform: { x: board.x, y: board.y, w: 0, h: 0 },
      z: deps.nextZ(),
      createdAt: Date.now(),
    }
    const sized = resizeToFit(nt)
    return { ...nt, transform: sized.transform }
  }

  /** Convert board → screen using the cached camera. The DOM editor is
   *  fixed-positioned in screen-space; we re-apply on every refresh. */
  const boardToScreen = (ctx: ToolContext, x: number, y: number): { x: number; y: number } => ({
    x: (x - ctx.camera.x) * ctx.camera.scale,
    y: (y - ctx.camera.y) * ctx.camera.scale,
  })

  /** Apply / refresh the editor element's styles. Called at startEdit and
   *  on every input / format change so the editable stays WYSIWYG. */
  const applyEditorStyles = (el: HTMLDivElement, text: TextObject, ctx: ToolContext): void => {
    const { x, y, w, h } = text.transform
    const screen = boardToScreen(ctx, x, y)
    const screenW = w * ctx.camera.scale
    const screenH = h * ctx.camera.scale
    el.style.position = 'fixed'
    el.style.left = `${screen.x}px`
    el.style.top = `${screen.y}px`
    // Padding mirrors textgeom.TEXT_PADDING_X/Y so typed text aligns
    // with the rendered text's first-character left edge.
    el.style.padding = `${TEXT_PADDING_Y * ctx.camera.scale}px ${TEXT_PADDING_X * ctx.camera.scale}px`
    el.style.font = `${text.font.italic ? 'italic ' : ''}${text.font.bold ? '700 ' : ''}${text.font.size * ctx.camera.scale}px ${FONT_CSS[text.font.family]}`
    el.style.lineHeight = `${LINE_HEIGHT_MULT}`
    el.style.color = ctx.resolveColor(text.color)
    el.style.background = 'transparent'
    el.style.outline = '1px dashed rgba(37, 99, 235, 0.6)'
    el.style.outlineOffset = '2px'
    el.style.zIndex = '10000'
    el.style.pointerEvents = 'auto'
    el.style.textDecoration = text.font.underline ? 'underline' : 'none'
    el.style.cursor = 'text'
    el.style.caretColor = ctx.resolveColor(text.color)
    el.style.userSelect = 'text'
    el.style.boxSizing = 'border-box'
    // Wrap mode: when the TextObject has `wrapWidth`, the editor uses a
    // FIXED width (= rect screen width) and CSS `pre-wrap` so the
    // browser does soft-wrap with the same word boundaries our
    // measureText does. Without wrap, the editor uses `pre` (no
    // wrapping; the rect grows in width with content).
    if (text.wrapWidth && text.wrapWidth > 0) {
      el.style.width = `${screenW}px`
      el.style.minWidth = `${screenW}px`
      el.style.maxWidth = `${screenW}px`
      el.style.minHeight = `${screenH}px`
      el.style.whiteSpace = 'pre-wrap'
      el.style.wordWrap = 'break-word'
    } else {
      el.style.width = ''
      el.style.maxWidth = ''
      el.style.minWidth = `${screenW}px`
      el.style.minHeight = `${screenH}px`
      el.style.whiteSpace = 'pre'
      el.style.wordWrap = ''
    }
  }

  const toggleFormat = (which: 'bold' | 'italic' | 'underline', ctx: ToolContext | null): void => {
    if (!editing) return
    const t = editing.text
    if (which === 'bold') t.font.bold = !t.font.bold
    else if (which === 'italic') t.font.italic = !t.font.italic
    else t.font.underline = !t.font.underline
    // Sticky default for the next new text.
    if (which === 'bold') setTextBold(t.font.bold)
    if (which === 'italic') setTextItalic(t.font.italic)
    if (which === 'underline') setTextUnderline(t.font.underline)
    const resized = resizeToFit(t)
    t.transform = resized.transform
    if (ctx) applyEditorStyles(editing.el, t, ctx)
    deps.markCommittedDirty()
  }

  const startEdit = (text: TextObject, ctx: ToolContext, isNewText: boolean): void => {
    if (editing) commitEdit()
    const before = {
      content: text.content,
      font: { ...text.font },
      color: text.color,
      wrapWidth: text.wrapWidth,
    }
    const el = document.createElement('div')
    el.className = 'whiteboard-text-editor'
    el.contentEditable = 'true'
    // Plain-text only: pasted HTML's styling shouldn't carry into our
    // plain-text record. (Safari ignores 'plaintext-only' for the attribute
    // but honors it for the contentEditable property assignment below.)
    el.setAttribute('contenteditable', 'plaintext-only')
    el.spellcheck = false
    applyEditorStyles(el, text, ctx)
    el.textContent = text.content
    document.body.appendChild(el)
    placeCaretAtEnd(el)
    el.focus()

    const cleanups: Array<() => void> = []

    const handleInput = (): void => {
      if (!editing) return
      // Normalize line endings: CRLF (Windows) and bare CR (legacy macOS,
      // some IME compositions) both flatten to '\n'. measureText() splits
      // on '\n' only — a stray '\r' would merge two visual lines into one
      // very-wide measured line, corrupting the bounding rect.
      const newContent = el.innerText.replace(/\r\n?/g, '\n')
      editing.text.content = newContent
      const resized = resizeToFit(editing.text)
      editing.text.transform = resized.transform
      // NOTE: do NOT call `applyEditorStyles` here. Rewriting the editor's
      // `style.font` / `style.position` / etc. on every keystroke can
      // trigger browser-specific caret/focus resets that kicked the user
      // out of edit mode after the first character (observed during user
      // testing on 2026-05-13). The editable grows naturally with its
      // content via its CSS sizing — we don't need to bump styles.
      deps.markCommittedDirty()
    }
    el.addEventListener('input', handleInput)
    cleanups.push(() => el.removeEventListener('input', handleInput))

    const handleKey = (e: KeyboardEvent): void => {
      if (!editing) return
      // CRITICAL: stop propagation on EVERY keystroke. The global keymap
      // (attachKeymap on document) binds many UNMODIFIED single letters
      // — `b` / `s` / `v` / `l` / `t` / `f` / `p` / `c` / `o`, plus
      // `1`-`5` for brush presets. Without stopPropagation, typing any
      // of those letters into the editor ALSO fires the global tool-
      // switch handlers, which then `cleanup()`s the text tool and
      // discards the in-progress edit. That was the actual root cause
      // of "text mode exits after the first letter" — applyEditorStyles
      // wasn't the culprit. Browser-native shortcuts inside the
      // editable (Cmd+A select-all-in-editor, Cmd+Z undo-last-edit)
      // still fire because preventDefault isn't called below — only
      // propagation is stopped, so the document-level handlers can't
      // see the event but the browser's default behavior on the
      // editable still runs.
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        commitEdit()
        deps.onEscExit()
        return
      }
      const meta = e.metaKey || e.ctrlKey
      if (meta && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (k === 'b' || k === 'i' || k === 'u') {
          e.preventDefault()
          toggleFormat(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline', lastCtx)
          return
        }
      }
    }
    el.addEventListener('keydown', handleKey)
    cleanups.push(() => el.removeEventListener('keydown', handleKey))

    // Suppress the browser's native contextmenu over the editor. Without
    // this the user sees a Chrome / Firefox "Cut / Copy / Paste / spell-
    // check" menu whenever they right-click while typing. The editor's
    // own typing UX takes precedence; spell-check / clipboard ops are
    // already covered by Cmd+X / C / V (browser-native handling of the
    // contenteditable).
    const handleContextMenu = (e: Event): void => {
      e.preventDefault()
    }
    el.addEventListener('contextmenu', handleContextMenu)
    cleanups.push(() => el.removeEventListener('contextmenu', handleContextMenu))

    // Outside click commits + exits edit mode (without tool-switch — the
    // tool stays on Text). Capture phase so we win against any tool's
    // pointerdown that would otherwise fire on the same event.
    const handleDocPointerDown = (e: PointerEvent): void => {
      if (!editing) return
      if (e.target === el || el.contains(e.target as Node)) return
      commitEdit()
    }
    document.addEventListener('pointerdown', handleDocPointerDown, true)
    cleanups.push(() => document.removeEventListener('pointerdown', handleDocPointerDown, true))

    editing = { text, before, el, cleanups, isNewText }
    deps.markCommittedDirty()
  }

  const commitEdit = (): void => {
    if (!editing) return
    const e = editing
    editing = null
    for (const c of e.cleanups) c()
    e.el.remove()

    const after = {
      content: e.text.content,
      font: { ...e.text.font },
      color: e.text.color,
      wrapWidth: e.text.wrapWidth,
    }

    if (e.isNewText && e.text.content === '') {
      // Discard the empty starter — no point persisting an invisible
      // record. Roll back the in-memory insertion the tool did at
      // pointer-down time; persist as deleted so a future load skips it.
      // No undo op because there was nothing to undo to (the create
      // never happened from the user's perspective).
      const texts = deps.getTexts()
      const idx = texts.indexOf(e.text)
      if (idx >= 0) texts.splice(idx, 1)
      deps.saveText({ ...e.text, deleted: true })
      deps.markCommittedDirty()
      return
    }

    if (!e.isNewText && e.text.content === '') {
      // EXISTING text edited down to empty content → soft-delete so the
      // user doesn't have an invisible box on the canvas. Restore the
      // BEFORE state in-memory before saving so a single undo brings
      // back the original content + formatting AND un-deletes — the
      // user sees their pre-edit text restored in one Cmd+Z, not two.
      e.text.content = e.before.content
      e.text.font = { ...e.before.font }
      e.text.color = e.before.color
      e.text.wrapWidth = e.before.wrapWidth
      // Re-fit so the rect matches the restored content (otherwise
      // it'd retain the zero-content size).
      const refitted = resizeToFit(e.text)
      e.text.transform = refitted.transform
      e.text.deleted = true
      deps.saveText(e.text)
      deps.pushOp({ kind: 'delete-text', textId: e.text.id })
      deps.markCommittedDirty()
      return
    }

    if (e.isNewText) {
      // First-time creation: persist + push create op.
      deps.saveText(e.text)
      deps.pushOp({ kind: 'create-text', textId: e.text.id })
      deps.markCommittedDirty()
      return
    }

    // Editing an existing text. Anything changed?
    const changed =
      e.before.content !== after.content ||
      e.before.font.family !== after.font.family ||
      e.before.font.size !== after.font.size ||
      e.before.font.bold !== after.font.bold ||
      e.before.font.italic !== after.font.italic ||
      e.before.font.underline !== after.font.underline ||
      e.before.color !== after.color ||
      e.before.wrapWidth !== after.wrapWidth
    if (changed) {
      deps.saveText(e.text)
      deps.pushOp({
        kind: 'edit-text',
        textId: e.text.id,
        before: e.before,
        after,
      })
    }
    deps.markCommittedDirty()
  }

  const hitText = (board: { x: number; y: number }): TextObject | null => {
    const texts = deps.getTexts()
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i]
      if (!t || t.deleted) continue
      if (pointInText(board, t)) return t
    }
    return null
  }

  return {
    id: 'text',
    cursor: 'text',

    onPointerDown(e, ctx) {
      lastCtx = ctx
      // Outside-click commits via the document-level listener bound in
      // startEdit; if we're here AND editing, the click hit a different
      // text or empty space. The doc listener already ran (capture phase),
      // so editing should be null. Belt-and-braces:
      if (editing) commitEdit()
      const board = ctx.toBoard(e.clientX, e.clientY)
      const hit = hitText(board)
      if (hit) {
        drag = {
          textId: hit.id,
          startScreen: { x: e.clientX, y: e.clientY },
          before: { ...hit.transform },
          movedPastNoop: false,
        }
        return
      }
      // Empty space → create new text + enter edit mode. The create-text
      // op is pushed at commit time (in commitEdit) since an empty text
      // that the user immediately Esc-out-of without typing shouldn't
      // pollute undo history.
      const final = buildTextFromDefaults('', board)
      deps.getTexts().push(final)
      startEdit(final, ctx, true)
    },

    onPointerMove(e, ctx) {
      lastCtx = ctx
      if (!drag) return
      const dx = e.clientX - drag.startScreen.x
      const dy = e.clientY - drag.startScreen.y
      if (!drag.movedPastNoop && Math.hypot(dx, dy) > DRAG_NOOP_PX) {
        drag.movedPastNoop = true
      }
      if (!drag.movedPastNoop) return
      const text = deps.getTexts().find((t) => t.id === drag?.textId)
      if (!text) return
      const boardDx = dx / ctx.camera.scale
      const boardDy = dy / ctx.camera.scale
      text.transform = {
        ...drag.before,
        x: drag.before.x + boardDx,
        y: drag.before.y + boardDy,
      }
      deps.markCommittedDirty()
    },

    onPointerUp(_e, ctx) {
      lastCtx = ctx
      if (!drag) return
      const d = drag
      drag = null
      const text = deps.getTexts().find((t) => t.id === d.textId)
      if (!text) return
      if (!d.movedPastNoop) {
        startEdit(text, ctx, false)
        return
      }
      const after = { ...text.transform }
      if (
        d.before.x === after.x &&
        d.before.y === after.y &&
        d.before.w === after.w &&
        d.before.h === after.h
      ) {
        return
      }
      deps.saveText(text)
      deps.pushOp({
        kind: 'transform-text',
        textId: d.textId,
        before: d.before,
        after,
      })
    },

    renderContextualMenu(host, dismiss, rebuild, anchor) {
      // COLOR — shared palette (curated + custom + "+").
      host.appendChild(sectionLabel('Color'))
      const activeColor = editing ? editing.text.color : getTextColor()
      host.appendChild(
        buildSwatchPalette({
          active: activeColor,
          onPick: (c) => {
            if (editing) {
              editing.text.color = c
              if (lastCtx) applyEditorStyles(editing.el, editing.text, lastCtx)
              deps.markCommittedDirty()
            }
            setTextColor(c)
            dismiss()
          },
          addAt: anchor ?? { x: 0, y: 0 },
          onAddDone: () => rebuild?.(),
        }),
      )

      // FONT
      host.appendChild(separator())
      host.appendChild(sectionLabel('Font'))
      const fontRow = pillRow()
      const activeFont = editing ? editing.text.font.family : getTextFont()
      for (const f of FONT_OPTIONS) {
        fontRow.appendChild(
          pill({
            label: f.label,
            active: f.id === activeFont,
            onClick: () => {
              if (editing) {
                editing.text.font = { ...editing.text.font, family: f.id }
                const sized = resizeToFit(editing.text)
                editing.text.transform = sized.transform
                if (lastCtx) applyEditorStyles(editing.el, editing.text, lastCtx)
                deps.markCommittedDirty()
              }
              setTextFont(f.id)
              dismiss()
            },
          }),
        )
      }
      host.appendChild(fontRow)

      // SIZE
      host.appendChild(separator())
      host.appendChild(sectionLabel('Size'))
      const sizeRow = pillRow()
      const activeSize = editing ? editing.text.font.size : getTextSize()
      for (const s of SIZE_OPTIONS) {
        sizeRow.appendChild(
          pill({
            label: String(s),
            active: s === activeSize,
            onClick: () => {
              if (editing) {
                editing.text.font = { ...editing.text.font, size: s }
                const sized = resizeToFit(editing.text)
                editing.text.transform = sized.transform
                if (lastCtx) applyEditorStyles(editing.el, editing.text, lastCtx)
                deps.markCommittedDirty()
              }
              setTextSize(s)
              dismiss()
            },
          }),
        )
      }
      host.appendChild(sizeRow)
    },

    cleanup(): void {
      // Tool switched while editing — commit through the normal path so
      // the create-text / edit-text op lands in undo. Without this the
      // user could type into a new text, switch to Pen, and find that
      // undo can't reverse the edit (the text persists but no op was
      // ever pushed). Same data-loss shape as the v1.1.0 Tier-A "clear
      // board didn't reset images" bug (image-paste batch).
      commitEdit()
      drag = null
      lastCtx = null
    },

    getEditingId(): string | null {
      return editing?.text.id ?? null
    },
    isEditing(): boolean {
      return editing !== null
    },
    toggleFormat(which: 'bold' | 'italic' | 'underline'): void {
      toggleFormat(which, lastCtx)
    },
    editTextById(id: string, ctx: ToolContext): boolean {
      const t = deps.getTexts().find((x) => x.id === id)
      if (!t || t.deleted) return false
      lastCtx = ctx
      startEdit(t, ctx, false)
      return true
    },
    createTextAt(content: string, board: { x: number; y: number }): string {
      const t = buildTextFromDefaults(content, board)
      deps.getTexts().push(t)
      deps.saveText(t)
      deps.pushOp({ kind: 'create-text', textId: t.id })
      deps.markCommittedDirty()
      return t.id
    },
  }
}

function placeCaretAtEnd(el: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}
