/**
 * Op apply/unapply round-trip tests for text op kinds (create-text /
 * delete-text / transform-text / edit-text). Validates that undo/redo
 * correctly toggle state without drift — the load-bearing property for
 * the text feature's undo behavior.
 *
 * Strokes / images are already covered by integration paths; this file
 * focuses on the new v1.2 text ops. The op-pipeline itself (applyOp /
 * unapplyOp switch dispatch) is exercised across all kinds via the
 * dispatch tests.
 */

import { describe, expect, test } from 'bun:test'
import type { ImageObject, Stroke, TextObject } from '@whiteboard/shared'
import { type Op, type OpContext, applyOp, unapplyOp } from './ops'

function mkText(id: string, overrides: Partial<TextObject> = {}): TextObject {
  return {
    id,
    content: 'hello',
    font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
    color: 'ink',
    transform: { x: 10, y: 20, w: 40, h: 16 },
    z: 1,
    createdAt: 0,
    ...overrides,
  }
}

interface Harness {
  ctx: OpContext
  saved: TextObject[]
  dirtyCount: number
}

function mkHarness(initialTexts: TextObject[] = []): Harness {
  const strokes: Stroke[] = []
  const images: ImageObject[] = []
  const texts: TextObject[] = initialTexts.map((t) => ({ ...t }))
  const saved: TextObject[] = []
  let dirtyCount = 0
  const ctx: OpContext = {
    strokes,
    saveStroke: () => {},
    images,
    saveImageMeta: () => {},
    texts,
    saveText: (t) => {
      saved.push({ ...t, font: { ...t.font }, transform: { ...t.transform } })
    },
    markDirty: () => {
      dirtyCount++
    },
  }
  return {
    ctx,
    saved,
    get dirtyCount() {
      return dirtyCount
    },
  }
}

describe('ops: create-text', () => {
  test('apply flips deleted→false, unapply flips deleted→true', () => {
    const t = mkText('a', { deleted: true })
    const h = mkHarness([t])
    const op: Op = { kind: 'create-text', textId: 'a' }
    applyOp(op, h.ctx)
    expect(h.ctx.texts[0]?.deleted).toBeUndefined()
    unapplyOp(op, h.ctx)
    expect(h.ctx.texts[0]?.deleted).toBe(true)
  })

  test('apply/unapply round-trip is idempotent over multiple cycles', () => {
    const h = mkHarness([mkText('a', { deleted: true })])
    const op: Op = { kind: 'create-text', textId: 'a' }
    for (let i = 0; i < 3; i++) {
      applyOp(op, h.ctx)
      expect(h.ctx.texts[0]?.deleted).toBeUndefined()
      unapplyOp(op, h.ctx)
      expect(h.ctx.texts[0]?.deleted).toBe(true)
    }
  })

  test('apply on unknown id is a no-op', () => {
    const h = mkHarness([mkText('a')])
    applyOp({ kind: 'create-text', textId: 'nonexistent' }, h.ctx)
    expect(h.ctx.texts).toHaveLength(1)
    expect(h.ctx.texts[0]?.id).toBe('a')
  })
})

describe('ops: delete-text', () => {
  test('apply flips deleted→true, unapply flips deleted→false', () => {
    const h = mkHarness([mkText('a')])
    const op: Op = { kind: 'delete-text', textId: 'a' }
    applyOp(op, h.ctx)
    expect(h.ctx.texts[0]?.deleted).toBe(true)
    unapplyOp(op, h.ctx)
    expect(h.ctx.texts[0]?.deleted).toBeUndefined()
  })
})

describe('ops: transform-text', () => {
  test('apply sets transform.after, unapply restores transform.before', () => {
    const before = { x: 0, y: 0, w: 40, h: 16 }
    const after = { x: 100, y: 50, w: 40, h: 16 }
    const h = mkHarness([mkText('a', { transform: before })])
    const op: Op = { kind: 'transform-text', textId: 'a', before, after }
    applyOp(op, h.ctx)
    expect(h.ctx.texts[0]?.transform).toEqual(after)
    unapplyOp(op, h.ctx)
    expect(h.ctx.texts[0]?.transform).toEqual(before)
  })

  test('transform is copied by value (no aliasing)', () => {
    // The op's `after` payload shouldn't be the same reference as the
    // text's transform after apply — mutating the text shouldn't
    // retroactively change the stored op.
    const before = { x: 0, y: 0, w: 40, h: 16 }
    const after = { x: 100, y: 50, w: 40, h: 16 }
    const h = mkHarness([mkText('a', { transform: before })])
    const op: Op = { kind: 'transform-text', textId: 'a', before, after }
    applyOp(op, h.ctx)
    // Mutate the text's transform AFTER apply.
    if (h.ctx.texts[0]) h.ctx.texts[0].transform.x = 9999
    // The op's `after` should remain unchanged.
    if (op.kind === 'transform-text') {
      expect(op.after.x).toBe(100)
    }
  })
})

describe('ops: edit-text', () => {
  test('apply swaps content + font + color to `after`; unapply restores `before`', () => {
    const before = {
      content: 'hello',
      font: { family: 'mono' as const, size: 12, bold: false, italic: false, underline: false },
      color: 'ink',
    }
    const after = {
      content: 'world!',
      font: { family: 'serif' as const, size: 24, bold: true, italic: true, underline: true },
      color: '#ef4444',
    }
    const h = mkHarness([mkText('a', before)])
    const op: Op = { kind: 'edit-text', textId: 'a', before, after }
    applyOp(op, h.ctx)
    expect(h.ctx.texts[0]?.content).toBe('world!')
    expect(h.ctx.texts[0]?.font).toEqual(after.font)
    expect(h.ctx.texts[0]?.color).toBe('#ef4444')
    unapplyOp(op, h.ctx)
    expect(h.ctx.texts[0]?.content).toBe('hello')
    expect(h.ctx.texts[0]?.font).toEqual(before.font)
    expect(h.ctx.texts[0]?.color).toBe('ink')
  })

  test('apply re-fits transform.w/h via resizeToFit', () => {
    // The edit-text path runs through textgeom.resizeToFit so the rect
    // stays consistent with measured content. Empty content fits to a
    // caret-height-sized rect (per the measureText fallback).
    const before = {
      content: '',
      font: { family: 'mono' as const, size: 12, bold: false, italic: false, underline: false },
      color: 'ink',
    }
    const after = { ...before, content: 'abc' }
    const h = mkHarness([mkText('a', { ...before, transform: { x: 0, y: 0, w: 0, h: 0 } })])
    const op: Op = { kind: 'edit-text', textId: 'a', before, after }
    applyOp(op, h.ctx)
    // After apply: rect has non-zero w/h that reflects the new content.
    expect(h.ctx.texts[0]?.transform.w).toBeGreaterThan(0)
    expect(h.ctx.texts[0]?.transform.h).toBeGreaterThan(0)
    unapplyOp(op, h.ctx)
    // Undo: rect re-fits to the empty content (small but non-zero
    // because measureText returns padding even for empty input).
    expect(h.ctx.texts[0]?.content).toBe('')
  })

  test('save is fired on every apply / unapply so persistence stays in sync', () => {
    const before = {
      content: 'a',
      font: { family: 'mono' as const, size: 12, bold: false, italic: false, underline: false },
      color: 'ink',
    }
    const after = { ...before, content: 'b' }
    const h = mkHarness([mkText('a', before)])
    const op: Op = { kind: 'edit-text', textId: 'a', before, after }
    applyOp(op, h.ctx)
    unapplyOp(op, h.ctx)
    applyOp(op, h.ctx)
    expect(h.saved.length).toBe(3)
  })
})

describe('ops dispatch: markDirty fires once per apply / unapply', () => {
  test('all four text op kinds bump the dirty counter exactly once', () => {
    const t = mkText('a')
    const h = mkHarness([t])
    const before = { ...t.transform }
    const after = { ...before, x: 100 }
    const editBefore = { content: t.content, font: { ...t.font }, color: t.color }
    const editAfter = { ...editBefore, content: 'changed' }
    const ops: Op[] = [
      { kind: 'create-text', textId: 'a' },
      { kind: 'delete-text', textId: 'a' },
      { kind: 'transform-text', textId: 'a', before, after },
      { kind: 'edit-text', textId: 'a', before: editBefore, after: editAfter },
    ]
    for (const op of ops) {
      const beforeCount = h.dirtyCount
      applyOp(op, h.ctx)
      expect(h.dirtyCount).toBe(beforeCount + 1)
      unapplyOp(op, h.ctx)
      expect(h.dirtyCount).toBe(beforeCount + 2)
    }
  })
})
