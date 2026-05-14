import { describe, expect, test } from 'bun:test'
import type { TextObject } from '@whiteboard/shared'
import { pointInText, resizeToFit, textAABB } from './textgeom'

const baseFont: TextObject['font'] = {
  family: 'mono',
  size: 12,
  bold: false,
  italic: false,
  underline: false,
}

function mkText(opts: Partial<TextObject> = {}): TextObject {
  return {
    id: 't1',
    content: 'hello',
    font: { ...baseFont },
    color: 'ink',
    transform: { x: 100, y: 50, w: 40, h: 16 },
    z: 1,
    createdAt: 0,
    ...opts,
  }
}

describe('textgeom: textAABB', () => {
  test('unrotated AABB matches transform rect', () => {
    const t = mkText()
    const bb = textAABB(t)
    expect(bb).toEqual({ minX: 100, minY: 50, maxX: 140, maxY: 66 })
  })

  test('rotation = 0 (explicit) hits the fast path', () => {
    // The render gate uses Math.abs(r) < 1e-9 — make sure exact-zero
    // rotation collapses to the un-rotated AABB.
    const t = mkText({ rotation: 0 })
    const bb = textAABB(t)
    expect(bb).toEqual({ minX: 100, minY: 50, maxX: 140, maxY: 66 })
  })

  test('90-degree rotation produces correct AABB around center', () => {
    // A 40×16 rect rotated 90° around its center → AABB is 16×40 around
    // the same center. Center of original rect = (120, 58).
    const t = mkText({ rotation: Math.PI / 2 })
    const bb = textAABB(t)
    const cx = 120
    const cy = 58
    expect(bb.minX).toBeCloseTo(cx - 8, 5)
    expect(bb.maxX).toBeCloseTo(cx + 8, 5)
    expect(bb.minY).toBeCloseTo(cy - 20, 5)
    expect(bb.maxY).toBeCloseTo(cy + 20, 5)
  })
})

describe('textgeom: pointInText', () => {
  test('hit inside rect returns true', () => {
    const t = mkText()
    expect(pointInText({ x: 110, y: 55 }, t)).toBe(true)
  })

  test('miss outside rect returns false', () => {
    const t = mkText()
    expect(pointInText({ x: 200, y: 100 }, t)).toBe(false)
    expect(pointInText({ x: 99, y: 60 }, t)).toBe(false)
    expect(pointInText({ x: 110, y: 49 }, t)).toBe(false)
  })

  test('hit on rotated rect uses inverse-rotated test', () => {
    // 90°-rotated rect: a point that would MISS the un-rotated rect can
    // HIT the rotated one. With center (120, 58), the rotated rect spans
    // x: 112..128, y: 38..78. (120, 70) is inside that.
    const t = mkText({ rotation: Math.PI / 2 })
    expect(pointInText({ x: 120, y: 70 }, t)).toBe(true)
    // And a point that hit the un-rotated rect now misses.
    expect(pointInText({ x: 138, y: 55 }, t)).toBe(false)
  })
})

describe('textgeom: resizeToFit', () => {
  test('non-empty content produces non-zero w/h', () => {
    // Bun tests run without a DOM canvas, so the fallback heuristic kicks
    // in: width = chars * size * 0.6, height = lines * lineHeight. We
    // can't assert exact pixel values without re-implementing the
    // heuristic, but we CAN assert "non-zero + monotonic with size".
    const small = resizeToFit(mkText({ content: 'hi', font: { ...baseFont, size: 12 } }))
    const big = resizeToFit(mkText({ content: 'hi', font: { ...baseFont, size: 24 } }))
    expect(small.transform.w).toBeGreaterThan(0)
    expect(small.transform.h).toBeGreaterThan(0)
    expect(big.transform.w).toBeGreaterThan(small.transform.w)
    expect(big.transform.h).toBeGreaterThan(small.transform.h)
  })

  test('multi-line content grows height per added line', () => {
    // Two lines should add exactly one lineHeight (size × LINE_HEIGHT_MULT
    // = 12 × 1.25 = 15 px) to the height; three lines should add two.
    // Padding is constant across line counts so the delta isolates the
    // per-line height contribution.
    const single = resizeToFit(mkText({ content: 'one' }))
    const triple = resizeToFit(mkText({ content: 'one\ntwo\nthree' }))
    expect(triple.transform.h - single.transform.h).toBeCloseTo(2 * 12 * 1.25, 5)
  })

  test('preserves id, font, color, z, createdAt, transform.x/y', () => {
    const orig = mkText({ content: 'abc', color: '#ff0000', z: 42, createdAt: 123 })
    const sized = resizeToFit(orig)
    expect(sized.id).toBe(orig.id)
    expect(sized.color).toBe(orig.color)
    expect(sized.z).toBe(orig.z)
    expect(sized.createdAt).toBe(orig.createdAt)
    expect(sized.font).toEqual(orig.font)
    expect(sized.transform.x).toBe(orig.transform.x)
    expect(sized.transform.y).toBe(orig.transform.y)
  })
})
