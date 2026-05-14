import { describe, expect, test } from 'bun:test'
import { createSelectionClipboardHandlers } from './selectionclipboard-events'

function mkClipboardEvent(target: EventTarget | null = null): {
  ev: ClipboardEvent
  get prevented(): boolean
} {
  let prevented = false
  const ev = {
    target,
    preventDefault: () => {
      prevented = true
    },
  } as unknown as ClipboardEvent
  return {
    ev,
    get prevented() {
      return prevented
    },
  }
}

describe('selectionclipboard-events', () => {
  test('copy: no-op when select tool is not active', async () => {
    let copied = 0
    const handlers = createSelectionClipboardHandlers({
      isSelectActive: () => false,
      selectionCount: () => 1,
      performCopy: async () => {
        copied++
        return true
      },
      deleteSelected: () => {},
    })
    const e = mkClipboardEvent()
    handlers.onCopy(e.ev)
    await Promise.resolve()
    expect(e.prevented).toBe(false)
    expect(copied).toBe(0)
  })

  test('copy: active select + selection prevents default and copies', async () => {
    let copied = 0
    const handlers = createSelectionClipboardHandlers({
      isSelectActive: () => true,
      selectionCount: () => 1,
      performCopy: async () => {
        copied++
        return true
      },
      deleteSelected: () => {},
    })
    const e = mkClipboardEvent()
    handlers.onCopy(e.ev)
    await Promise.resolve()
    expect(e.prevented).toBe(true)
    expect(copied).toBe(1)
  })

  test('cut: deletes only when copy succeeds', async () => {
    let deleted = 0
    const handlers = createSelectionClipboardHandlers({
      isSelectActive: () => true,
      selectionCount: () => 1,
      performCopy: async () => false,
      deleteSelected: () => {
        deleted++
      },
    })
    const e = mkClipboardEvent()
    handlers.onCut(e.ev)
    await Promise.resolve()
    await Promise.resolve()
    expect(e.prevented).toBe(true)
    expect(deleted).toBe(0)
  })
})
