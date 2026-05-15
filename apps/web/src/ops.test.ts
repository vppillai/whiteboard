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
import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import { applyOp, type Op, type OpContext, unapplyOp } from './ops'

function mkText(id: string, overrides: Partial<TextObject> = {}): TextObject {
  return {
    id,
    content: 'hello',
    font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
    color: 'ink',
    wrapWidth: undefined,
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
  const shapes: ShapeObject[] = []
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
    shapes,
    saveShape: () => {},
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
      wrapWidth: undefined,
    }
    const after = {
      content: 'world!',
      font: { family: 'serif' as const, size: 24, bold: true, italic: true, underline: true },
      color: '#ef4444',
      wrapWidth: undefined,
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
      wrapWidth: undefined,
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
      wrapWidth: undefined,
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

describe('ops: shape op kinds', () => {
  function mkShape(id: string, overrides: Partial<ShapeObject> = {}): ShapeObject {
    return {
      id,
      shape: 'rect',
      color: 'ink',
      strokeWidth: 2,
      transform: { x: 0, y: 0, w: 100, h: 80 },
      z: 1,
      createdAt: 0,
      ...overrides,
    }
  }

  function mkShapeHarness(initial: ShapeObject[] = []): { ctx: OpContext; saved: ShapeObject[] } {
    const shapes: ShapeObject[] = initial.map((s) => ({ ...s, transform: { ...s.transform } }))
    const saved: ShapeObject[] = []
    const ctx: OpContext = {
      strokes: [],
      saveStroke: () => {},
      images: [],
      saveImageMeta: () => {},
      texts: [],
      saveText: () => {},
      shapes,
      saveShape: (s) => {
        saved.push({ ...s, transform: { ...s.transform } })
      },
      markDirty: () => {},
    }
    return { ctx, saved }
  }

  test('create-shape / delete-shape round-trip soft-delete flag', () => {
    const h = mkShapeHarness([mkShape('s1', { deleted: true })])
    applyOp({ kind: 'create-shape', shapeId: 's1' }, h.ctx)
    expect(h.ctx.shapes[0]?.deleted).toBeUndefined()
    unapplyOp({ kind: 'create-shape', shapeId: 's1' }, h.ctx)
    expect(h.ctx.shapes[0]?.deleted).toBe(true)
  })

  test('transform-shape swaps the rect on apply / unapply', () => {
    const h = mkShapeHarness([mkShape('s1')])
    const op: Op = {
      kind: 'transform-shape',
      shapeId: 's1',
      before: { x: 0, y: 0, w: 100, h: 80 },
      after: { x: 50, y: 25, w: 100, h: 80 },
    }
    applyOp(op, h.ctx)
    expect(h.ctx.shapes[0]?.transform).toEqual({ x: 50, y: 25, w: 100, h: 80 })
    unapplyOp(op, h.ctx)
    expect(h.ctx.shapes[0]?.transform).toEqual({ x: 0, y: 0, w: 100, h: 80 })
  })

  test('rotate-shape swaps the angle and stores undefined for zero', () => {
    const h = mkShapeHarness([mkShape('s1', { rotation: Math.PI / 4 })])
    applyOp({ kind: 'rotate-shape', shapeId: 's1', before: Math.PI / 4, after: 0 }, h.ctx)
    expect(h.ctx.shapes[0]?.rotation).toBeUndefined()
  })

  test('edit-shape swaps color / strokeWidth / fill / fillOpacity', () => {
    const h = mkShapeHarness([
      mkShape('s1', { color: 'ink', strokeWidth: 2, fill: undefined, fillOpacity: undefined }),
    ])
    const op: Op = {
      kind: 'edit-shape',
      shapeId: 's1',
      before: { color: 'ink', strokeWidth: 2, fill: undefined, fillOpacity: undefined },
      after: { color: '#ff0000', strokeWidth: 4, fill: '#ffeeee', fillOpacity: 0.5 },
    }
    applyOp(op, h.ctx)
    expect(h.ctx.shapes[0]?.color).toBe('#ff0000')
    expect(h.ctx.shapes[0]?.strokeWidth).toBe(4)
    expect(h.ctx.shapes[0]?.fill).toBe('#ffeeee')
    expect(h.ctx.shapes[0]?.fillOpacity).toBe(0.5)
    unapplyOp(op, h.ctx)
    expect(h.ctx.shapes[0]?.color).toBe('ink')
    expect(h.ctx.shapes[0]?.fill).toBeUndefined()
    expect(h.ctx.shapes[0]?.fillOpacity).toBeUndefined()
  })

  test('transform-many carries shape variants alongside images / texts', () => {
    const h = mkShapeHarness([mkShape('s1')])
    const op: Op = {
      kind: 'transform-many',
      items: [
        {
          kind: 'shape',
          shapeId: 's1',
          before: { x: 0, y: 0, w: 100, h: 80 },
          after: { x: 30, y: 30, w: 100, h: 80 },
        },
      ],
    }
    applyOp(op, h.ctx)
    expect(h.ctx.shapes[0]?.transform).toEqual({ x: 30, y: 30, w: 100, h: 80 })
    unapplyOp(op, h.ctx)
    expect(h.ctx.shapes[0]?.transform).toEqual({ x: 0, y: 0, w: 100, h: 80 })
  })
})

describe('ops: transform-many composite op', () => {
  function mkImg(id: string, overrides: Partial<ImageObject> = {}): ImageObject {
    return {
      id,
      blobRef: id,
      format: 'png',
      natural: { w: 100, h: 100 },
      transform: { x: 0, y: 0, w: 100, h: 100 },
      z: 1,
      createdAt: 0,
      ...overrides,
    }
  }

  function mkHarnessMulti(opts: {
    images?: ImageObject[]
    texts?: TextObject[]
    strokes?: Stroke[]
    shapes?: ShapeObject[]
  }): { ctx: OpContext } {
    const strokes = (opts.strokes ?? []).map((s) => ({
      ...s,
      samples: s.samples.map((p) => ({ ...p })),
    }))
    const images = (opts.images ?? []).map((i) => ({ ...i, transform: { ...i.transform } }))
    const texts = (opts.texts ?? []).map((t) => ({ ...t, transform: { ...t.transform } }))
    const shapes = (opts.shapes ?? []).map((sh) => ({ ...sh, transform: { ...sh.transform } }))
    const ctx: OpContext = {
      strokes,
      saveStroke: () => {},
      images,
      saveImageMeta: () => {},
      texts,
      saveText: () => {},
      shapes,
      saveShape: () => {},
      markDirty: () => {},
    }
    return { ctx }
  }

  test('apply translates each item independently per kind', () => {
    const img = mkImg('i1')
    const txt = mkText('t1')
    const stroke: Stroke = {
      id: 's1',
      brush: {
        color: 'ink',
        size: 2,
        thinning: 0,
        smoothing: 0.5,
        streamline: 0.5,
        taperStart: 0,
        taperEnd: 0,
        capStart: true,
        capEnd: true,
        pressureGamma: 1,
      },
      samples: [{ x: 0, y: 0, p: 0.5, t: 0 }],
      startedAt: 0,
    }
    const h = mkHarnessMulti({ images: [img], texts: [txt], strokes: [stroke] })
    const op: Op = {
      kind: 'transform-many',
      items: [
        {
          kind: 'image',
          imageId: 'i1',
          before: { x: 0, y: 0, w: 100, h: 100 },
          after: { x: 50, y: 50, w: 100, h: 100 },
        },
        {
          kind: 'text',
          textId: 't1',
          before: { x: 10, y: 20, w: 40, h: 16 },
          after: { x: 100, y: 200, w: 40, h: 16 },
        },
        { kind: 'stroke', strokeId: 's1', dx: 30, dy: 40 },
      ],
    }
    applyOp(op, h.ctx)
    expect(h.ctx.images[0]?.transform.x).toBe(50)
    expect(h.ctx.images[0]?.transform.y).toBe(50)
    expect(h.ctx.texts[0]?.transform.x).toBe(100)
    expect(h.ctx.texts[0]?.transform.y).toBe(200)
    expect(h.ctx.strokes[0]?.samples[0]?.x).toBe(30)
    expect(h.ctx.strokes[0]?.samples[0]?.y).toBe(40)
  })

  test('unapply reverses every item symmetrically', () => {
    const img = mkImg('i1', { transform: { x: 50, y: 50, w: 100, h: 100 } })
    const txt = mkText('t1', { transform: { x: 100, y: 200, w: 40, h: 16 } })
    const stroke: Stroke = {
      id: 's1',
      brush: {
        color: 'ink',
        size: 2,
        thinning: 0,
        smoothing: 0.5,
        streamline: 0.5,
        taperStart: 0,
        taperEnd: 0,
        capStart: true,
        capEnd: true,
        pressureGamma: 1,
      },
      samples: [{ x: 30, y: 40, p: 0.5, t: 0 }],
      startedAt: 0,
    }
    const h = mkHarnessMulti({ images: [img], texts: [txt], strokes: [stroke] })
    const op: Op = {
      kind: 'transform-many',
      items: [
        {
          kind: 'image',
          imageId: 'i1',
          before: { x: 0, y: 0, w: 100, h: 100 },
          after: { x: 50, y: 50, w: 100, h: 100 },
        },
        {
          kind: 'text',
          textId: 't1',
          before: { x: 10, y: 20, w: 40, h: 16 },
          after: { x: 100, y: 200, w: 40, h: 16 },
        },
        { kind: 'stroke', strokeId: 's1', dx: 30, dy: 40 },
      ],
    }
    unapplyOp(op, h.ctx)
    expect(h.ctx.images[0]?.transform.x).toBe(0)
    expect(h.ctx.texts[0]?.transform.x).toBe(10)
    expect(h.ctx.strokes[0]?.samples[0]?.x).toBe(0)
    expect(h.ctx.strokes[0]?.samples[0]?.y).toBe(0)
  })

  test('apply→unapply→apply round-trips back to applied state', () => {
    const img = mkImg('i1')
    const h = mkHarnessMulti({ images: [img] })
    const op: Op = {
      kind: 'transform-many',
      items: [
        {
          kind: 'image',
          imageId: 'i1',
          before: { x: 0, y: 0, w: 100, h: 100 },
          after: { x: 50, y: 50, w: 100, h: 100 },
        },
      ],
    }
    applyOp(op, h.ctx)
    expect(h.ctx.images[0]?.transform.x).toBe(50)
    unapplyOp(op, h.ctx)
    expect(h.ctx.images[0]?.transform.x).toBe(0)
    applyOp(op, h.ctx)
    expect(h.ctx.images[0]?.transform.x).toBe(50)
  })
})

describe('ops dispatch: markDirty fires once per apply / unapply', () => {
  test('all four text op kinds bump the dirty counter exactly once', () => {
    const t = mkText('a')
    const h = mkHarness([t])
    const before = { ...t.transform }
    const after = { ...before, x: 100 }
    const editBefore = {
      content: t.content,
      font: { ...t.font },
      color: t.color,
      wrapWidth: t.wrapWidth,
    }
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

describe('ops: delete-many composite op', () => {
  test('apply/unapply toggles deleted for shapes, texts, and images together', () => {
    const image: ImageObject = {
      id: 'img-1',
      blobRef: 'blob:img-1',
      format: 'png',
      natural: { w: 1000, h: 800 },
      transform: { x: 10, y: 10, w: 100, h: 80 },
      z: 1,
      createdAt: 0,
    }
    const text: TextObject = {
      id: 'txt-1',
      content: 'hello',
      font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
      color: 'ink',
      wrapWidth: undefined,
      transform: { x: 20, y: 20, w: 40, h: 16 },
      z: 2,
      createdAt: 0,
    }
    const shape: ShapeObject = {
      id: 'sh-1',
      shape: 'rect',
      color: 'ink',
      strokeWidth: 2,
      transform: { x: 30, y: 30, w: 50, h: 40 },
      z: 3,
      createdAt: 0,
    }
    const ctx: OpContext = {
      strokes: [],
      saveStroke: () => {},
      images: [image],
      saveImageMeta: () => {},
      texts: [text],
      saveText: () => {},
      shapes: [shape],
      saveShape: () => {},
      markDirty: () => {},
    }
    const op: Op = {
      kind: 'delete-many',
      imageIds: ['img-1'],
      textIds: ['txt-1'],
      shapeIds: ['sh-1'],
    }
    applyOp(op, ctx)
    expect(ctx.images[0]?.deleted).toBe(true)
    expect(ctx.texts[0]?.deleted).toBe(true)
    expect(ctx.shapes[0]?.deleted).toBe(true)
    unapplyOp(op, ctx)
    expect(ctx.images[0]?.deleted).toBeUndefined()
    expect(ctx.texts[0]?.deleted).toBeUndefined()
    expect(ctx.shapes[0]?.deleted).toBeUndefined()
  })

  test('safe no-op for unknown ids', () => {
    const ctx: OpContext = {
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
    const op: Op = {
      kind: 'delete-many',
      imageIds: ['missing-image'],
      textIds: ['missing-text'],
      shapeIds: ['missing-shape'],
    }
    applyOp(op, ctx)
    unapplyOp(op, ctx)
    expect(ctx.images).toHaveLength(0)
    expect(ctx.texts).toHaveLength(0)
    expect(ctx.shapes).toHaveLength(0)
  })
})
