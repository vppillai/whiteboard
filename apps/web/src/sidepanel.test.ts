/**
 * Regression tests for the side panel's Esc guard.
 *
 * `bun test` has no DOM, so `document` / `requestAnimationFrame` are
 * stubbed just enough for showSidePanel to build its shell and register
 * its capture-phase keydown listener. Review finding: Esc while typing
 * in a settings input (swatchadd's hex field) dismissed the whole panel
 * and preventDefault()ed; it must now leave editable targets alone.
 */

import { afterAll, expect, test } from 'bun:test'
import { isSidePanelOpen, showSidePanel } from './sidepanel'

// --- DOM stubs -------------------------------------------------------------

interface ElStub {
  className: string
  textContent: string
  type: string
  setAttribute: () => void
  appendChild: () => void
  append: () => void
  addEventListener: () => void
  removeEventListener: () => void
  classList: { add: () => void; remove: () => void }
  remove: () => void
  focus: () => void
  querySelector: () => ElStub
}

// Set when the element returned by querySelector receives focus — lets the
// focus-on-open behavior be asserted without a real DOM tree.
let queryResultFocused = false

function makeElStub(): ElStub {
  return {
    className: '',
    textContent: '',
    type: '',
    setAttribute: () => {},
    appendChild: () => {},
    append: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    classList: { add: () => {}, remove: () => {} },
    remove: () => {},
    focus: () => {},
    querySelector: () => {
      const child = makeElStub()
      child.focus = () => {
        queryResultFocused = true
      }
      return child
    },
  }
}

type KeyListener = (e: KeyboardEvent) => void

let captureKeydown: KeyListener | null = null

const docStub = {
  createElement: () => makeElStub(),
  body: {
    appendChild: () => {},
    classList: { add: () => {}, remove: () => {} },
  },
  addEventListener: (type: string, fn: KeyListener, capture?: boolean): void => {
    if (type === 'keydown' && capture === true) captureKeydown = fn
  },
  removeEventListener: (type: string, fn: KeyListener, capture?: boolean): void => {
    if (type === 'keydown' && capture === true && captureKeydown === fn) {
      captureKeydown = null
    }
  },
}

const g = globalThis as Record<string, unknown>
const hadDocument = 'document' in g
const originalDocument = g.document
const hadRaf = 'requestAnimationFrame' in g
const originalRaf = g.requestAnimationFrame
g.document = docStub
g.requestAnimationFrame = (_fn: FrameRequestCallback): number => 0

afterAll(() => {
  if (hadDocument) g.document = originalDocument
  else delete g.document
  if (hadRaf) g.requestAnimationFrame = originalRaf
  else delete g.requestAnimationFrame
})

// --- event factory ----------------------------------------------------------

function makeEscEvent(editable: boolean): {
  event: KeyboardEvent
  wasPrevented: () => boolean
} {
  let prevented = false
  const event = {
    key: 'Escape',
    target: { closest: () => (editable ? {} : null) },
    preventDefault: () => {
      prevented = true
    },
  } as unknown as KeyboardEvent
  return { event, wasPrevented: () => prevented }
}

// --- tests -------------------------------------------------------------------

test('Esc from inside an editable leaves the panel open and the key unswallowed', () => {
  let dismissed = false
  showSidePanel({
    title: 'Settings',
    content: makeElStub() as unknown as HTMLElement,
    onDismiss: () => {
      dismissed = true
    },
  })
  expect(isSidePanelOpen()).toBe(true)
  if (!captureKeydown) throw new Error('panel keydown listener not attached')

  const { event, wasPrevented } = makeEscEvent(true)
  captureKeydown(event)

  expect(isSidePanelOpen()).toBe(true)
  expect(dismissed).toBe(false)
  expect(wasPrevented()).toBe(false)
})

test('Esc from a non-editable target dismisses the panel and prevents default', () => {
  showSidePanel({
    title: 'Settings',
    content: makeElStub() as unknown as HTMLElement,
  })
  expect(isSidePanelOpen()).toBe(true)
  if (!captureKeydown) throw new Error('panel keydown listener not attached')

  const { event, wasPrevented } = makeEscEvent(false)
  captureKeydown(event)

  expect(isSidePanelOpen()).toBe(false)
  expect(wasPrevented()).toBe(true)
})

test('opening the panel moves keyboard focus into the dialog', () => {
  queryResultFocused = false
  showSidePanel({
    title: 'Settings',
    content: makeElStub() as unknown as HTMLElement,
  })
  expect(queryResultFocused).toBe(true)

  if (!captureKeydown) throw new Error('panel keydown listener not attached')
  captureKeydown(makeEscEvent(false).event) // leave no open panel behind
  expect(isSidePanelOpen()).toBe(false)
})
