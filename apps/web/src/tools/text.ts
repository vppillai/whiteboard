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
 * Esc returns to the previous tool — main.ts tracks the previous tool
 * id via the `getPreviousToolId` dep so the user can flip into text mode
 * with `T`, type, hit Esc, and land back in pen / select / wherever
 * they were.
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
import { CURATED_COLORS as PALETTE } from '../colorpicker'
import { paletteGrid, pill, pillRow, sectionLabel, separator, swatch } from '../menu-ui'
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
import {
  FONT_CSS,
  LINE_HEIGHT_MULT,
  TEXT_PADDING_X,
  TEXT_PADDING_Y,
  pointInText,
  resizeToFit,
} from '../textgeom'
import type { Tool, ToolContext, ToolId } from './types'

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
  /** Switch back to the previous tool when edit mode exits via Esc. */
  setTool: (id: ToolId) => void
  /** Returns the tool that was active before Text was selected. Used
   *  for Esc-exits-to-previous-tool. Null falls back to 'pen'. */
  getPreviousToolId: () => ToolId | null
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
}

interface EditingState {
  text: TextObject
  /** Snapshot of the text's content/font/color at edit-start. Used to
   *  build the edit-text op at commit time. */
  before: {
    content: string
    font: TextObject['font']
    color: string
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

  const makeId = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `t_${crypto.randomUUID()}`
      : `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

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
    el.style.minWidth = `${screenW}px`
    el.style.minHeight = `${screenH}px`
    // Padding mirrors textgeom.TEXT_PADDING_X/Y so typed text aligns
    // with the rendered text's first-character left edge.
    el.style.padding = `${TEXT_PADDING_Y * ctx.camera.scale}px ${TEXT_PADDING_X * ctx.camera.scale}px`
    el.style.font = `${text.font.italic ? 'italic ' : ''}${text.font.bold ? '700 ' : ''}${text.font.size * ctx.camera.scale}px ${FONT_CSS[text.font.family]}`
    el.style.lineHeight = `${LINE_HEIGHT_MULT}`
    el.style.color = ctx.resolveColor(text.color)
    el.style.background = 'transparent'
    el.style.outline = '1px dashed rgba(37, 99, 235, 0.6)'
    el.style.outlineOffset = '2px'
    el.style.whiteSpace = 'pre'
    el.style.zIndex = '10000'
    el.style.pointerEvents = 'auto'
    el.style.textDecoration = text.font.underline ? 'underline' : 'none'
    el.style.cursor = 'text'
    el.style.caretColor = ctx.resolveColor(text.color)
    el.style.userSelect = 'text'
    el.style.boxSizing = 'border-box'
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
      const newContent = el.innerText.replace(/\r\n/g, '\n')
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
      if (e.key === 'Escape') {
        e.preventDefault()
        // Stop propagation so the global keymap's Esc-cancel handler
        // doesn't ALSO run on the same event (it would clear popovers /
        // run the double-tap toggle on top of our commit).
        e.stopPropagation()
        const prev = deps.getPreviousToolId() ?? 'pen'
        commitEdit()
        deps.setTool(prev)
        return
      }
      const meta = e.metaKey || e.ctrlKey
      if (meta && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (k === 'b' || k === 'i' || k === 'u') {
          e.preventDefault()
          // CRITICAL: stop propagation so the document-level keymap
          // (which has its OWN Cmd+B/I/U handler routed to
          // toggleFormat() as a backup) doesn't fire on the same
          // event. Without this both handlers fire and the toggle
          // cancels itself, making B/I/U appear broken.
          e.stopPropagation()
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
    }

    if (e.isNewText && e.text.content === '') {
      // Discard the empty starter — no point persisting an invisible
      // record. Roll back the in-memory insertion the tool did at
      // pointer-down time; persist as deleted so a future load skips it.
      const texts = deps.getTexts()
      const idx = texts.indexOf(e.text)
      if (idx >= 0) texts.splice(idx, 1)
      deps.saveText({ ...e.text, deleted: true })
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
      e.before.color !== after.color
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
      // Empty space → create new text + enter edit mode.
      const nt: TextObject = {
        id: makeId(),
        content: '',
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
      const final: TextObject = { ...nt, transform: sized.transform }
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

    renderContextualMenu(host, dismiss) {
      // COLOR
      host.appendChild(sectionLabel('Color'))
      const palette = paletteGrid()
      const activeColor = editing ? editing.text.color : getTextColor()
      for (const c of PALETTE) {
        palette.appendChild(
          swatch({
            color: c,
            active: activeColor === c,
            onClick: () => {
              if (editing) {
                editing.text.color = c
                if (lastCtx) applyEditorStyles(editing.el, editing.text, lastCtx)
                deps.markCommittedDirty()
              }
              setTextColor(c)
              dismiss()
            },
          }),
        )
      }
      host.appendChild(palette)

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
      // Tool switched while editing — best-effort persist + tear down the
      // overlay. No op is pushed here because the user didn't take a
      // tool-level action; the in-memory state stays as the user left it.
      if (editing) {
        for (const c of editing.cleanups) c()
        editing.el.remove()
        if (editing.text.content !== '') {
          deps.saveText(editing.text)
        }
        editing = null
      }
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
