/**
 * Regression tests for the pointer router's single-pointer ownership.
 *
 * `bun test` has no DOM, so the event target is stubbed just enough to
 * capture the four listeners `attachPointer` registers and to record
 * `setPointerCapture` / `hasPointerCapture` / `releasePointerCapture` calls.
 * The active `Tool` is a recording fake — only `onPointerDown` /
 * `onPointerMove` / `onPointerUp` matter here, each pushes `"<name>:<id>"`
 * onto a `calls` array so tests can assert both which callback fired and
 * for which pointerId.
 *
 * Covers the ownership rules from the file header: a second concurrent
 * pointerdown must not reach the tool or steal capture; a stray up/cancel
 * from a non-owning pointer must not end the active gesture; the owner's
 * up clears ownership; implicit pen-lift still fires for the owner; and
 * hover moves (no gesture active) still reach the tool regardless of which
 * pointerId they come from.
 */

import { describe, expect, test } from 'bun:test'
import { attachPointer } from './pointer'
import type { Tool, ToolContext } from './tools/types'

// --- target stub ----------------------------------------------------------

type Listener = (e: PointerEvent) => void

function makeTarget() {
  const listeners: Record<string, Listener[]> = {
    pointerdown: [],
    pointermove: [],
    pointerup: [],
    pointercancel: [],
  }
  const capturedIds = new Set<number>()
  const captureCalls: number[] = []
  const releaseCalls: number[] = []

  const target = {
    addEventListener: (type: string, fn: Listener): void => {
      listeners[type]?.push(fn)
    },
    removeEventListener: (type: string, fn: Listener): void => {
      const arr = listeners[type]
      if (!arr) return
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
    setPointerCapture: (id: number): void => {
      captureCalls.push(id)
      capturedIds.add(id)
    },
    hasPointerCapture: (id: number): boolean => capturedIds.has(id),
    releasePointerCapture: (id: number): void => {
      releaseCalls.push(id)
      capturedIds.delete(id)
    },
  }

  const fire = (type: string, e: PointerEvent): void => {
    for (const fn of listeners[type] ?? []) fn(e)
  }

  return { target, fire, capturedIds, captureCalls, releaseCalls }
}

// --- pointer event + tool + context stubs ----------------------------------

interface EventOpts {
  pointerType?: string
  button?: number
  buttons?: number
}

function makeEvent(pointerId: number, opts: EventOpts = {}): PointerEvent {
  let prevented = false
  return {
    pointerId,
    pointerType: opts.pointerType ?? 'pen',
    button: opts.button ?? 0,
    buttons: opts.buttons ?? 1,
    preventDefault: () => {
      prevented = true
    },
    get defaultPrevented() {
      return prevented
    },
  } as unknown as PointerEvent
}

function makeTool(): { tool: Tool; calls: string[] } {
  const calls: string[] = []
  const tool: Tool = {
    id: 'pen',
    onPointerDown: (e) => {
      calls.push(`down:${e.pointerId}`)
    },
    onPointerMove: (e) => {
      calls.push(`move:${e.pointerId}`)
    },
    onPointerUp: (e) => {
      calls.push(`up:${e.pointerId}`)
    },
  }
  return { tool, calls }
}

// Never inspected by the fake tool above; a cast stub keeps the test focused
// on router behavior instead of ToolContext plumbing.
const ctx = {} as unknown as ToolContext

// --- tests ------------------------------------------------------------------

describe('pointer router single-pointer ownership', () => {
  test('second concurrent pointerdown is ignored while first is active', () => {
    const { target, fire, captureCalls } = makeTarget()
    const { tool, calls } = makeTool()
    attachPointer(target as unknown as HTMLElement, { getActiveTool: () => tool, context: ctx })

    fire('pointerdown', makeEvent(1))
    fire('pointerdown', makeEvent(2))

    expect(calls).toEqual(['down:1'])
    expect(captureCalls).toEqual([1])
  })

  test('stray pointerup from a non-owning pointerId is ignored', () => {
    const { target, fire, capturedIds } = makeTarget()
    const { tool, calls } = makeTool()
    attachPointer(target as unknown as HTMLElement, { getActiveTool: () => tool, context: ctx })

    fire('pointerdown', makeEvent(1))
    fire('pointerup', makeEvent(2))

    expect(calls).toEqual(['down:1'])
    // Ownership (and capture) is untouched by the stray up.
    expect(capturedIds.has(1)).toBe(true)
  })

  test("owner's pointerup dispatches to the tool and clears ownership", () => {
    const { target, fire, capturedIds, releaseCalls } = makeTarget()
    const { tool, calls } = makeTool()
    attachPointer(target as unknown as HTMLElement, { getActiveTool: () => tool, context: ctx })

    fire('pointerdown', makeEvent(1))
    fire('pointerup', makeEvent(1))

    expect(calls).toEqual(['down:1', 'up:1'])
    expect(releaseCalls).toEqual([1])
    expect(capturedIds.has(1)).toBe(false)

    // Ownership cleared: a new pointer can now start a gesture.
    fire('pointerdown', makeEvent(2))
    expect(calls).toEqual(['down:1', 'up:1', 'down:2'])
  })

  test('implicit pen-lift: owner move with buttons===0 routes to onPointerUp', () => {
    const { target, fire, capturedIds } = makeTarget()
    const { tool, calls } = makeTool()
    attachPointer(target as unknown as HTMLElement, { getActiveTool: () => tool, context: ctx })

    fire('pointerdown', makeEvent(1))
    fire('pointermove', makeEvent(1, { buttons: 0 }))

    expect(calls).toEqual(['down:1', 'up:1'])
    expect(capturedIds.has(1)).toBe(false)

    // A late genuine pointerup for the same (now-released) pointer is
    // harmless — ownership no longer matches, so the router ignores it.
    fire('pointerup', makeEvent(1))
    expect(calls).toEqual(['down:1', 'up:1'])
  })

  test('hover moves still dispatch when no gesture is active', () => {
    const { target, fire } = makeTarget()
    const { tool, calls } = makeTool()
    attachPointer(target as unknown as HTMLElement, { getActiveTool: () => tool, context: ctx })

    fire('pointermove', makeEvent(5, { buttons: 0 }))
    fire('pointermove', makeEvent(7, { buttons: 0 }))

    expect(calls).toEqual(['move:5', 'move:7'])
  })
})
