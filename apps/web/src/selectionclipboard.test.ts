import { describe, expect, test } from 'bun:test'
import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import type { ClipboardStrokeBundle } from './clipboardstrokes'
import type { Op } from './ops'
import {
  _selectionOrigin,
  _shouldUseSingleImageFastPath,
  pasteSelectionBundle,
  type SelectionClipboardContext,
} from './selectionclipboard'

function makeText(over: Partial<TextObject>): TextObject {
  return {
    id: 't_test',
    transform: { x: 100, y: 100, w: 80, h: 20 },
    z: 1,
    createdAt: 0,
    content: 'hi',
    font: { family: 'mono', size: 16, bold: false, italic: false, underline: false },
    color: 'ink',
    ...over,
  }
}

function makeShape(over: Partial<ShapeObject>): ShapeObject {
  return {
    id: 's_test',
    shape: 'rect',
    transform: { x: 0, y: 0, w: 100, h: 40 },
    z: 1,
    createdAt: 0,
    color: 'ink',
    strokeWidth: 4,
    ...over,
  }
}
describe('selectionclipboard: single-image fast path gating', () => {
  test('true for single-image-only selection', () => {
    expect(
      _shouldUseSingleImageFastPath({
        imageCount: 1,
        strokeCount: 0,
        textCount: 0,
        shapeCount: 0,
      }),
    ).toBe(true)
  })

  test('false when a shape is selected alongside the image', () => {
    expect(
      _shouldUseSingleImageFastPath({
        imageCount: 1,
        strokeCount: 0,
        textCount: 0,
        shapeCount: 1,
      }),
    ).toBe(false)
  })

  test('false when selection has more than one image', () => {
    expect(
      _shouldUseSingleImageFastPath({
        imageCount: 2,
        strokeCount: 0,
        textCount: 0,
        shapeCount: 0,
      }),
    ).toBe(false)
  })
})

describe('selectionclipboard: paste-anchor origin (_selectionOrigin)', () => {
  test('rotated text uses the rotation-aware AABB, not raw transform.x/y', () => {
    // 80x20 text at (100,100) rotated 90 deg around its center (140,110):
    // the visual AABB is 20x80 centered there → top-left (130, 70). The
    // raw pre-rotation transform.x/y is (100,100) — the buggy value.
    const t = makeText({ rotation: Math.PI / 2 })
    const origin = _selectionOrigin([], [t], [])
    expect(origin.x).toBeCloseTo(130)
    expect(origin.y).toBeCloseTo(70)
  })

  test('rotated shape uses the rotation-aware AABB, not the normalized rect', () => {
    // 100x40 rect at (0,0), strokeWidth 4 (pad 2), rotated 90 deg around
    // its center (50,20): the padded 104x44 box becomes 44x104 → top-left
    // (28, -32). The pre-fix normalized-rect value was (0, 0).
    const sh = makeShape({ rotation: Math.PI / 2 })
    const origin = _selectionOrigin([], [], [sh])
    expect(origin.x).toBeCloseTo(28)
    expect(origin.y).toBeCloseTo(-32)
  })

  test('unrotated selection is byte-identical to the legacy convention', () => {
    // Unrotated text contributes raw transform.x/y; unrotated line with
    // negative w/h contributes the bare normalized rect top-left with NO
    // strokeWidth inflation. Exact equality on purpose — this guards the
    // bundle-format invariant for pre-existing unrotated copies.
    const t = makeText({ transform: { x: 100, y: 155, w: 80, h: 20 } })
    const line = makeShape({
      shape: 'line',
      transform: { x: 200, y: 200, w: -110, h: -50 },
    })
    const origin = _selectionOrigin([], [t], [line])
    expect(origin).toEqual({ x: 90, y: 150 })
  })

  test('empty selection falls back to {0,0}', () => {
    expect(_selectionOrigin([], [], [])).toEqual({ x: 0, y: 0 })
  })
})

describe('selectionclipboard: paste pushes one composite op', () => {
  function mkStroke(id: string): Stroke {
    return {
      id,
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
  }

  function mkPasteCtx() {
    const strokes: Stroke[] = []
    const texts: TextObject[] = []
    const shapes: ShapeObject[] = []
    const images: ImageObject[] = []
    const pushed: Op[] = []
    let z = 0
    const ctx: SelectionClipboardContext = {
      getStrokes: () => strokes,
      getImages: () => images,
      getTexts: () => texts,
      getShapes: () => shapes,
      getSelections: () => [],
      getSelectedImage: () => null,
      getSettings: () => ({}) as never,
      loadImageBlob: () => Promise.resolve(null),
      strokes,
      texts,
      shapes,
      saveStroke: () => Promise.resolve(),
      saveText: () => {},
      saveShape: () => {},
      pushOp: (op) => pushed.push(op),
      nextTextZ: () => ++z,
      nextShapeZ: () => ++z,
      showInfoToast: () => {},
      setToolSelect: () => {},
      selectByIds: () => {},
      clearSelection: () => {},
      markCommittedDirty: () => {},
    }
    return { ctx, pushed, strokes, texts, shapes }
  }

  test('multi-object bundle paste pushes exactly one create-many op', () => {
    const h = mkPasteCtx()
    const srcText: TextObject = {
      id: 'src-t',
      content: 'hi',
      font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
      color: 'ink',
      wrapWidth: undefined,
      transform: { x: 5, y: 5, w: 40, h: 16 },
      z: 1,
      createdAt: 0,
    }
    const srcShape: ShapeObject = {
      id: 'src-sh',
      shape: 'rect',
      color: 'ink',
      strokeWidth: 2,
      transform: { x: 10, y: 10, w: 50, h: 40 },
      z: 2,
      createdAt: 0,
    }
    const bundle: ClipboardStrokeBundle = {
      v: 1,
      strokes: [mkStroke('src-s1'), mkStroke('src-s2')],
      texts: [srcText],
      shapes: [srcShape],
      origin: { x: 0, y: 0 },
    }
    pasteSelectionBundle(bundle, { x: 100, y: 100 }, h.ctx)

    expect(h.pushed).toHaveLength(1)
    const op = h.pushed[0]
    expect(op?.kind).toBe('create-many')
    if (op?.kind !== 'create-many') return
    expect(op.strokeIds).toHaveLength(2)
    expect(op.textIds).toHaveLength(1)
    expect(op.shapeIds).toHaveLength(1)
    // The op's ids reference the freshly-inserted (live) objects.
    expect(h.strokes.map((s) => s.id)).toEqual(op.strokeIds)
    expect(h.texts.map((t) => t.id)).toEqual(op.textIds)
    expect(h.shapes.map((s) => s.id)).toEqual(op.shapeIds)
  })

  test('empty bundle pushes nothing', () => {
    const h = mkPasteCtx()
    const bundle: ClipboardStrokeBundle = { v: 1, strokes: [], origin: { x: 0, y: 0 } }
    pasteSelectionBundle(bundle, { x: 100, y: 100 }, h.ctx)
    expect(h.pushed).toHaveLength(0)
  })
})
