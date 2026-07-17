/**
 * Regression tests for the spring-loaded eraser's editable-target guard.
 *
 * v1.5 review finding: typing `e` into the settings hex field switched
 * the active tool to the eraser (and the tool switch fired the outgoing
 * tool's cleanup, dropping any Select selection). The keydown must
 * ignore editable targets; the keyup must stay UNGUARDED so a hold that
 * began on canvas still releases when focus moved into an input
 * mid-hold. Mirrors keymap.test.ts's document/event stubbing.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { attachEraserHold } from './eraserhold'
import type { ToolId } from './tools/types'

// --- document stub -------------------------------------------------------

type KeyListener = (e: KeyboardEvent) => void

let keydownListener: KeyListener | null = null
let keyupListener: KeyListener | null = null

const docStub = {
  addEventListener: (type: string, fn: KeyListener): void => {
    if (type === 'keydown') keydownListener = fn
    if (type === 'keyup') keyupListener = fn
  },
  removeEventListener: (type: string, fn: KeyListener): void => {
    if (type === 'keydown' && keydownListener === fn) keydownListener = null
    if (type === 'keyup' && keyupListener === fn) keyupListener = null
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

// --- event factory --------------------------------------------------------

// isEditableTarget duck-types `target.closest`, so a plain-object stub
// suffices (same idiom as keymap.test.ts).
function keyEvent(key: string, opts: { editable?: boolean } = {}): KeyboardEvent {
  const editable = opts.editable ?? false
  return {
    key,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: { closest: (_sel: string) => (editable ? {} : null) },
  } as unknown as KeyboardEvent
}

// --- tests -----------------------------------------------------------------

describe('attachEraserHold editable guard', () => {
  let activeTool: ToolId
  let setToolCalls: ToolId[]
  let detach: (() => void) | null = null

  beforeEach(() => {
    detach?.()
    activeTool = 'pen'
    setToolCalls = []
    detach = attachEraserHold({
      getActiveToolId: () => activeTool,
      setTool: (id) => {
        setToolCalls.push(id)
        activeTool = id
      },
    })
  })

  test('E on canvas spring-loads eraser and restores on release', () => {
    keydownListener?.(keyEvent('e'))
    expect(setToolCalls).toEqual(['eraser'])
    keyupListener?.(keyEvent('e'))
    expect(setToolCalls).toEqual(['eraser', 'pen'])
  })

  test('E typed into an editable does not switch tools', () => {
    keydownListener?.(keyEvent('e', { editable: true }))
    expect(setToolCalls).toEqual([])
    // The matching keyup is a no-op too (nothing was held).
    keyupListener?.(keyEvent('e', { editable: true }))
    expect(setToolCalls).toEqual([])
  })

  test('hold begun on canvas releases even when keyup lands in an editable', () => {
    keydownListener?.(keyEvent('e'))
    expect(activeTool).toBe('eraser')
    // Focus moved into an input mid-hold; release must still restore.
    keyupListener?.(keyEvent('e', { editable: true }))
    expect(activeTool).toBe('pen')
  })
})
