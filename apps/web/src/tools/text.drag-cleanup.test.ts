/**
 * Regression test: switching tools mid-drag (cleanup()) must COMMIT the
 * in-flight text move, not drop it. onPointerMove mutates the text's
 * transform in place every tick; before the fix, cleanup() just nulled
 * the drag state, so the moved transform was never persisted (snapped
 * back on reload) and never recorded as an op (invisible to undo).
 *
 * The drag path is drivable without DOM: pointer-down on an existing
 * text starts a drag (no contenteditable involved), and cleanup() with
 * no active edit session skips commitEdit's DOM work entirely. The
 * only DOM-touching seam is the click-without-motion → edit-mode
 * promotion on pointerUP, which these tests deliberately never trigger.
 */
import { describe, expect, test } from 'bun:test'
import type { TextObject } from '@whiteboard/shared'
import type { Op } from '../ops'
import { createTextTool, type TextToolDeps } from './text'
import type { ToolContext } from './types'

function makeText(): TextObject {
  return {
    id: 'text-1',
    content: 'hello',
    font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
    color: 'ink',
    transform: { x: 0, y: 0, w: 100, h: 40 },
    z: 1,
    createdAt: 0,
  }
}

function makeHarness(): {
  tool: ReturnType<typeof createTextTool>
  text: TextObject
  saved: TextObject[]
  ops: Op[]
  ctx: ToolContext
} {
  const text = makeText()
  const texts = [text]
  const saved: TextObject[] = []
  const ops: Op[] = []
  const deps: TextToolDeps = {
    getTexts: () => texts,
    nextZ: () => 2,
    pushOp: (op) => ops.push(op),
    applyOp: () => {},
    saveText: (t) => saved.push({ ...t, transform: { ...t.transform } }),
    markCommittedDirty: () => {},
    resolveColor: (c) => c,
    onEscExit: () => {},
  }
  // Identity camera: client coords == board coords. Only the fields the
  // drag path reads (toBoard, camera.scale) matter; the rest are stubs.
  const ctx = {
    toBoard: (x: number, y: number) => ({ x, y }),
    getBrush: () => {
      throw new Error('unused')
    },
    liveLayer: {} as ToolContext['liveLayer'],
    camera: { x: 0, y: 0, scale: 1 },
    dpr: 1,
    resolveColor: (c: string) => c,
    markCommittedDirty: () => {},
    setCursor: () => {},
    getLastPointer: () => ({ x: 0, y: 0 }),
  } as unknown as ToolContext
  return { tool: createTextTool(deps), text, saved, ops, ctx }
}

const pointer = (x: number, y: number): PointerEvent => ({ clientX: x, clientY: y }) as PointerEvent

describe('text tool drag + cleanup', () => {
  test('cleanup mid-drag persists the moved transform and pushes the move op', () => {
    const { tool, text, saved, ops, ctx } = makeHarness()
    // Start drag inside the text body, move well past the noop threshold.
    tool.onPointerDown(pointer(10, 10), ctx)
    tool.onPointerMove(pointer(40, 35), ctx)
    expect(text.transform.x).toBe(30)
    expect(text.transform.y).toBe(25)
    // Tool switch fires cleanup() before any pointerup.
    tool.cleanup?.()
    expect(saved).toHaveLength(1)
    expect(saved[0]?.transform).toEqual({ x: 30, y: 25, w: 100, h: 40 })
    expect(ops).toHaveLength(1)
    expect(ops[0]).toEqual({
      kind: 'transform-text',
      textId: 'text-1',
      before: { x: 0, y: 0, w: 100, h: 40 },
      after: { x: 30, y: 25, w: 100, h: 40 },
    })
  })

  test('cleanup after a sub-threshold drag pushes no op and persists nothing', () => {
    const { tool, saved, ops, ctx } = makeHarness()
    tool.onPointerDown(pointer(10, 10), ctx)
    // 2px of motion — below DRAG_NOOP_PX, so the transform never moved.
    tool.onPointerMove(pointer(12, 10), ctx)
    tool.cleanup?.()
    expect(saved).toHaveLength(0)
    expect(ops).toHaveLength(0)
  })

  test('pointerup remains the normal commit path (drag → release)', () => {
    const { tool, saved, ops, ctx } = makeHarness()
    tool.onPointerDown(pointer(10, 10), ctx)
    tool.onPointerMove(pointer(60, 10), ctx)
    tool.onPointerUp(pointer(60, 10), ctx)
    expect(saved).toHaveLength(1)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toEqual({
      kind: 'transform-text',
      textId: 'text-1',
      before: { x: 0, y: 0, w: 100, h: 40 },
      after: { x: 50, y: 0, w: 100, h: 40 },
    })
    // cleanup after a committed drag must not double-commit.
    tool.cleanup?.()
    expect(saved).toHaveLength(1)
    expect(ops).toHaveLength(1)
  })
})
