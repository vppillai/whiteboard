/**
 * Regression tests for the keymap's editable-target guard.
 *
 * `bun test` has no DOM, so `document` is stubbed just enough to capture
 * the keydown listener `attachKeymap` registers, and events are plain
 * objects with a stub `target.closest`. The guard must early-return for
 * targets inside input / textarea / [contenteditable] (review finding:
 * typing `?` or hex digits into the settings hex field toggled help /
 * switched tools) and must leave every other context untouched.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { attachKeymap, type KeyHandlers } from './keymap'

// --- document stub -------------------------------------------------------

type KeyListener = (e: KeyboardEvent) => void

let keydownListener: KeyListener | null = null

const docStub = {
  addEventListener: (type: string, fn: KeyListener): void => {
    if (type === 'keydown') keydownListener = fn
  },
  removeEventListener: (type: string, fn: KeyListener): void => {
    if (type === 'keydown' && keydownListener === fn) keydownListener = null
  },
}

const hadDocument = 'document' in globalThis
const originalDocument = (globalThis as Record<string, unknown>).document
;(globalThis as Record<string, unknown>).document = docStub

afterAll(() => {
  if (hadDocument) {
    ;(globalThis as Record<string, unknown>).document = originalDocument
  } else {
    delete (globalThis as Record<string, unknown>).document
  }
})

// --- handler + event factories -------------------------------------------

function makeHandlers(): { handlers: KeyHandlers; calls: string[] } {
  const calls: string[] = []
  const log = (name: string) => (): void => {
    calls.push(name)
  }
  const handlers: KeyHandlers = {
    undo: log('undo'),
    redo: log('redo'),
    zoomReset: log('zoomReset'),
    zoomIn: log('zoomIn'),
    zoomOut: log('zoomOut'),
    zoomToFit: log('zoomToFit'),
    clear: log('clear'),
    toggleTheme: log('toggleTheme'),
    toggleColor: log('toggleColor'),
    toggleOptions: log('toggleOptions'),
    toggleHelp: log('toggleHelp'),
    selectBrush: (i) => {
      calls.push(`selectBrush:${i}`)
    },
    selectDrawingTool: log('selectDrawingTool'),
    selectPenDefault: log('selectPenDefault'),
    selectEraserSticky: log('selectEraserSticky'),
    selectSelectTool: log('selectSelectTool'),
    selectLaserTool: log('selectLaserTool'),
    selectShapeRect: log('selectShapeRect'),
    selectShapeEllipse: log('selectShapeEllipse'),
    selectShapeLine: log('selectShapeLine'),
    selectShapeArrow: log('selectShapeArrow'),
    selectTextTool: log('selectTextTool'),
    toggleTextBold: log('toggleTextBold'),
    toggleTextItalic: log('toggleTextItalic'),
    toggleTextUnderline: log('toggleTextUnderline'),
    adjustTextSize: (d) => {
      calls.push(`adjustTextSize:${d}`)
    },
    deleteSelection: () => {
      calls.push('deleteSelection')
      return true
    },
    selectAll: log('selectAll'),
    togglePanel: log('togglePanel'),
    cancel: () => {
      calls.push('cancel')
      return true
    },
    toggleDistractionFree: log('toggleDistractionFree'),
    cyclePaletteBackward: log('cyclePaletteBackward'),
    cyclePaletteForward: log('cyclePaletteForward'),
    openExport: log('openExport'),
  }
  return { handlers, calls }
}

interface EventOpts {
  shift?: boolean
  meta?: boolean
  /** Simulate the event target sitting inside an input/textarea/editable. */
  editable?: boolean
}

interface StubKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  repeat: boolean
  target: { closest: (sel: string) => object | null }
  preventDefault: () => void
  readonly defaultPrevented: boolean
}

function makeEvent(key: string, opts: EventOpts = {}): StubKeyEvent {
  let prevented = false
  return {
    key,
    metaKey: opts.meta ?? false,
    ctrlKey: false,
    shiftKey: opts.shift ?? false,
    altKey: false,
    repeat: false,
    target: {
      // Real targets are HTMLElements; the guard only calls closest().
      closest: () => (opts.editable ? {} : null),
    },
    preventDefault: () => {
      prevented = true
    },
    get defaultPrevented() {
      return prevented
    },
  }
}

function dispatch(e: StubKeyEvent): void {
  if (!keydownListener) throw new Error('keymap listener not attached')
  keydownListener(e as unknown as KeyboardEvent)
}

// --- tests ----------------------------------------------------------------

describe('keymap editable-target guard', () => {
  let calls: string[]
  let detach: () => void

  beforeEach(() => {
    keydownListener = null
    const made = makeHandlers()
    calls = made.calls
    detach = attachKeymap(made.handlers)
  })

  test('? with input-focused target does not toggle help nor swallow the key', () => {
    const e = makeEvent('?', { shift: true, editable: true })
    dispatch(e)
    expect(calls).toEqual([])
    expect(e.defaultPrevented).toBe(false)
    detach()
  })

  test('? with non-editable target toggles help and prevents default', () => {
    const e = makeEvent('?', { shift: true })
    dispatch(e)
    expect(calls).toEqual(['toggleHelp'])
    expect(e.defaultPrevented).toBe(true)
    detach()
  })

  test('hex-field characters do not trigger single-key shortcuts', () => {
    // All of these are legal hex-input keystrokes that used to fire
    // tool switches: f → distraction-free, b → draw, a → arrow,
    // 1 → brush preset, Shift+C (uppercase hex) → color popover.
    dispatch(makeEvent('f', { editable: true }))
    dispatch(makeEvent('b', { editable: true }))
    dispatch(makeEvent('a', { editable: true }))
    dispatch(makeEvent('1', { editable: true }))
    const shiftC = makeEvent('c', { shift: true, editable: true })
    dispatch(shiftC)
    expect(calls).toEqual([])
    expect(shiftC.defaultPrevented).toBe(false)
    detach()
  })

  test('single-key shortcuts still fire outside editables', () => {
    dispatch(makeEvent('f'))
    dispatch(makeEvent('1'))
    expect(calls).toEqual(['toggleDistractionFree', 'selectBrush:1'])
    detach()
  })

  test('meta combos defer to the input (native undo / select-all)', () => {
    const undoEv = makeEvent('z', { meta: true, editable: true })
    dispatch(undoEv)
    const selectAllEv = makeEvent('a', { meta: true, editable: true })
    dispatch(selectAllEv)
    expect(calls).toEqual([])
    expect(undoEv.defaultPrevented).toBe(false)
    expect(selectAllEv.defaultPrevented).toBe(false)
    detach()
  })

  test('meta combos still fire outside editables', () => {
    const e = makeEvent('z', { meta: true })
    dispatch(e)
    expect(calls).toEqual(['undo'])
    expect(e.defaultPrevented).toBe(true)
    detach()
  })

  test('Backspace and Escape in an editable never reach board handlers', () => {
    const backspace = makeEvent('Backspace', { editable: true })
    dispatch(backspace)
    const esc = makeEvent('Escape', { editable: true })
    dispatch(esc)
    expect(calls).toEqual([])
    expect(backspace.defaultPrevented).toBe(false)
    expect(esc.defaultPrevented).toBe(false)
    detach()
  })

  test('Backspace and Escape outside editables still route to handlers', () => {
    dispatch(makeEvent('Backspace'))
    dispatch(makeEvent('Escape'))
    expect(calls).toEqual(['deleteSelection', 'cancel'])
    detach()
  })
})
