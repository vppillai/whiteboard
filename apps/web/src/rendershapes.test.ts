/**
 * Tests for shapeAABB — the only purely numeric piece of rendershapes.
 * The canvas drawing itself runs against a 2D context, which Bun's
 * happy-dom doesn't provide; we exercise that in browser smoke tests.
 *
 * What this file pins down:
 *   - Non-rotated rect/ellipse: bbox is the transform rect padded by
 *     half the stroke width (so stroke edges aren't viewport-culled
 *     prematurely).
 *   - Lines with negative w/h: bbox normalizes so min/max are well
 *     ordered regardless of draw direction.
 *   - Arrows: bbox inflates by the arrow-head perpendicular extent so
 *     the head doesn't get clipped at the edge of the viewport.
 *   - Rotated rect: bbox is the rotation-aware union of the four
 *     corners of the padded rect.
 */

import { describe, expect, it } from 'bun:test'
import type { ShapeObject } from '@whiteboard/shared'
import { pointInShape, shapeAABB } from './rendershapes'

function mkShape(over: Partial<ShapeObject>): ShapeObject {
  return {
    id: 's1',
    shape: 'rect',
    transform: { x: 0, y: 0, w: 100, h: 60 },
    color: 'ink',
    strokeWidth: 4,
    z: 0,
    createdAt: 0,
    ...over,
  }
}

describe('rendershapes: shapeAABB', () => {
  it('non-rotated rect: bbox = transform rect padded by stroke/2', () => {
    const s = mkShape({ shape: 'rect', strokeWidth: 4 })
    const bb = shapeAABB(s)
    expect(bb).toEqual({ minX: -2, minY: -2, maxX: 102, maxY: 62 })
  })

  it('non-rotated ellipse: bbox = bounding rect padded by stroke/2', () => {
    const s = mkShape({ shape: 'ellipse', strokeWidth: 6 })
    const bb = shapeAABB(s)
    expect(bb).toEqual({ minX: -3, minY: -3, maxX: 103, maxY: 63 })
  })

  it('line with negative w/h: bbox is normalized', () => {
    const s = mkShape({
      shape: 'line',
      transform: { x: 50, y: 40, w: -50, h: -40 },
      strokeWidth: 2,
    })
    const bb = shapeAABB(s)
    // Normalized rect = (0,0,50,40); pad by 1 each side.
    expect(bb).toEqual({ minX: -1, minY: -1, maxX: 51, maxY: 41 })
  })

  it('arrow inflates bbox by head perpendicular extent', () => {
    const s = mkShape({ shape: 'arrow', strokeWidth: 2 })
    const bbArrow = shapeAABB(s)
    const bbLine = shapeAABB(mkShape({ shape: 'line', strokeWidth: 2 }))
    // Arrow bbox grows outward in every direction relative to a line
    // with the same transform.
    expect(bbArrow.minX).toBeLessThan(bbLine.minX)
    expect(bbArrow.minY).toBeLessThan(bbLine.minY)
    expect(bbArrow.maxX).toBeGreaterThan(bbLine.maxX)
    expect(bbArrow.maxY).toBeGreaterThan(bbLine.maxY)
  })

  it('rotated rect: bbox rotates corners around center', () => {
    // 90° rotation of a 100×60 rect centered at (50,30) yields a
    // 60×100 bbox centered at the same point. Padding adds half the
    // stroke (=1) to every edge.
    const s = mkShape({ strokeWidth: 2, rotation: Math.PI / 2 })
    const bb = shapeAABB(s)
    expect(bb.minX).toBeCloseTo(50 - 30 - 1, 5)
    expect(bb.maxX).toBeCloseTo(50 + 30 + 1, 5)
    expect(bb.minY).toBeCloseTo(30 - 50 - 1, 5)
    expect(bb.maxY).toBeCloseTo(30 + 50 + 1, 5)
  })
})

describe('rendershapes: pointInShape', () => {
  it('filled rect: hits anywhere inside the rect', () => {
    const s = mkShape({ shape: 'rect', fill: 'ink' })
    expect(pointInShape({ x: 50, y: 30 }, s, 1)).toBe(true)
    expect(pointInShape({ x: -10, y: 30 }, s, 1)).toBe(false)
  })

  it('outline-only rect: hits near edges, misses interior', () => {
    const s = mkShape({ shape: 'rect', fill: undefined })
    // Near top edge
    expect(pointInShape({ x: 50, y: 0 }, s, 1)).toBe(true)
    // Interior — no fill, no hit
    expect(pointInShape({ x: 50, y: 30 }, s, 1)).toBe(false)
  })

  it('filled ellipse: hits inside, misses corner of bbox', () => {
    const s = mkShape({ shape: 'ellipse', fill: 'ink' })
    expect(pointInShape({ x: 50, y: 30 }, s, 1)).toBe(true) // center
    expect(pointInShape({ x: 0, y: 0 }, s, 1)).toBe(false) // bbox corner
  })

  it('line: hits within tolerance of the segment', () => {
    const s = mkShape({
      shape: 'line',
      transform: { x: 0, y: 0, w: 100, h: 0 }, // horizontal line
      strokeWidth: 2,
    })
    // Right on the line
    expect(pointInShape({ x: 50, y: 0 }, s, 0)).toBe(true)
    // Just outside tolerance (strokeWidth/2 = 1)
    expect(pointInShape({ x: 50, y: 5 }, s, 0)).toBe(false)
    // With screen tolerance, the same off-axis point hits
    expect(pointInShape({ x: 50, y: 5 }, s, 10)).toBe(true)
  })

  it('arrow with rotation: hit-test honors the rotation', () => {
    // 90° rotated arrow — the segment from (0,0) → (100,0) becomes
    // vertical in the world. A point on the rotated line should hit.
    const s = mkShape({
      shape: 'arrow',
      transform: { x: 0, y: 0, w: 100, h: 0 },
      rotation: Math.PI / 2,
    })
    // Center of segment in world coords: rotates (50,0) around (50,0)
    // (the center), still (50, 0). Pre-rotation tip (100,0) ends up at
    // (50, 50). A point near the tip should hit.
    expect(pointInShape({ x: 50, y: 50 }, s, 5)).toBe(true)
    // A point far from the rotated line should not hit.
    expect(pointInShape({ x: 200, y: 200 }, s, 1)).toBe(false)
  })
})
