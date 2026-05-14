import { describe, expect, test } from 'bun:test'
import { createEraserCommitCallbacks } from './erasercallbacks'
import type { Op, OpContext } from './ops'

function mkOpCtx(): OpContext {
  return {
    strokes: [],
    saveStroke: () => {},
    images: [],
    saveImageMeta: () => {},
    texts: [],
    saveText: () => {},
    shapes: [],
    saveShape: () => {},
    markDirty: () => {},
  }
}

describe('erasercallbacks: op dispatch', () => {
  test('onObjectErase dispatches stroke delete op', () => {
    const applied: Op[] = []
    const pushed: Op[] = []
    const cbs = createEraserCommitCallbacks({
      opCtx: mkOpCtx(),
      apply: (op) => applied.push(op),
      push: (op) => pushed.push(op),
    })
    cbs.onObjectErase('s1')
    expect(applied).toEqual([{ kind: 'delete', strokeIds: ['s1'] }])
    expect(pushed).toEqual([{ kind: 'delete', strokeIds: ['s1'] }])
  })

  test('onWipeErase no-ops for empty edits', () => {
    const applied: Op[] = []
    const pushed: Op[] = []
    const cbs = createEraserCommitCallbacks({
      opCtx: mkOpCtx(),
      apply: (op) => applied.push(op),
      push: (op) => pushed.push(op),
    })
    cbs.onWipeErase([])
    expect(applied).toHaveLength(0)
    expect(pushed).toHaveLength(0)
  })

  test('onWipeErase dispatches eraseStamps op for non-empty edits', () => {
    const applied: Op[] = []
    const pushed: Op[] = []
    const cbs = createEraserCommitCallbacks({
      opCtx: mkOpCtx(),
      apply: (op) => applied.push(op),
      push: (op) => pushed.push(op),
    })
    cbs.onWipeErase([{ strokeId: 's1', addedStamps: [{ x: 1, y: 2, r: 3 }] }])
    expect(applied).toEqual([
      { kind: 'eraseStamps', edits: [{ strokeId: 's1', addedStamps: [{ x: 1, y: 2, r: 3 }] }] },
    ])
    expect(pushed).toEqual([
      { kind: 'eraseStamps', edits: [{ strokeId: 's1', addedStamps: [{ x: 1, y: 2, r: 3 }] }] },
    ])
  })

  test('onWholeObjectErase emits one delete-many op only when needed', () => {
    const applied: Op[] = []
    const pushed: Op[] = []
    const cbs = createEraserCommitCallbacks({
      opCtx: mkOpCtx(),
      apply: (op) => applied.push(op),
      push: (op) => pushed.push(op),
    })

    cbs.onWholeObjectErase({ shapes: [], texts: [], images: [] })
    expect(applied).toHaveLength(0)
    expect(pushed).toHaveLength(0)

    cbs.onWholeObjectErase({ shapes: ['sh1'], texts: ['t1'], images: ['i1'] })
    expect(applied).toEqual([
      { kind: 'delete-many', shapeIds: ['sh1'], textIds: ['t1'], imageIds: ['i1'] },
    ])
    expect(pushed).toEqual([
      { kind: 'delete-many', shapeIds: ['sh1'], textIds: ['t1'], imageIds: ['i1'] },
    ])
  })
})
