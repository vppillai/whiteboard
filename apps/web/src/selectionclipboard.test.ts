import { describe, expect, test } from 'bun:test'
import type { ShapeObject, TextObject } from '@whiteboard/shared'
import { _selectionOrigin, _shouldUseSingleImageFastPath } from './selectionclipboard'

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
