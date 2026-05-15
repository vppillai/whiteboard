import { describe, expect, test } from 'bun:test'
import type { ImageObject, Stroke } from '@whiteboard/shared'
import { type Bounds, computeBoardBounds, EXPORT_MARGIN } from './bounds'

function mkImage(x: number, y: number, w: number, h: number, deleted = false): ImageObject {
  return {
    id: Math.random().toString(36).slice(2),
    blobRef: '',
    format: 'png',
    natural: { w, h },
    transform: { x, y, w, h },
    z: 1,
    createdAt: 0,
    deleted,
  }
}

function expectBounds(b: Bounds | null): Bounds {
  if (b === null) throw new Error('expected bounds, got null')
  return b
}

function mkStroke(samples: { x: number; y: number }[], deleted = false): Stroke {
  return {
    id: Math.random().toString(36).slice(2),
    brush: {
      size: 3,
      color: '#000',
      thinning: 0.6,
      smoothing: 0.7,
      streamline: 0.4,
      taperStart: 0,
      taperEnd: 0,
      capStart: true,
      capEnd: true,
      pressureGamma: 1.5,
    },
    samples: samples.map((s) => ({ x: s.x, y: s.y, p: 0.5, t: 0 })),
    startedAt: 0,
    deleted,
  }
}

describe('export/bounds: computeBoardBounds', () => {
  test('empty array → null', () => {
    expect(computeBoardBounds([])).toBeNull()
  })

  test('all-deleted strokes → null', () => {
    const s = mkStroke(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      true,
    )
    expect(computeBoardBounds([s])).toBeNull()
  })

  test('single stroke → AABB + 32 px margin', () => {
    const s = mkStroke([
      { x: 10, y: 20 },
      { x: 50, y: 80 },
    ])
    const b = expectBounds(computeBoardBounds([s]))
    // getStrokeBBox pads by brush size + max taper + 2; we add another 32.
    // Just verify the margin is at least EXPORT_MARGIN and bounds contain
    // the sample range.
    expect(b.x).toBeLessThanOrEqual(10 - EXPORT_MARGIN + 1)
    expect(b.y).toBeLessThanOrEqual(20 - EXPORT_MARGIN + 1)
    expect(b.x + b.width).toBeGreaterThanOrEqual(50 + EXPORT_MARGIN - 1)
    expect(b.y + b.height).toBeGreaterThanOrEqual(80 + EXPORT_MARGIN - 1)
  })

  test('multiple strokes → union AABB + margin', () => {
    const s1 = mkStroke([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ])
    const s2 = mkStroke([
      { x: 200, y: 200 },
      { x: 300, y: 300 },
    ])
    const b = expectBounds(computeBoardBounds([s1, s2]))
    expect(b.x).toBeLessThanOrEqual(-EXPORT_MARGIN + 1)
    expect(b.x + b.width).toBeGreaterThanOrEqual(300 + EXPORT_MARGIN - 1)
  })

  test('soft-deleted excluded from union', () => {
    const s1 = mkStroke([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ])
    const s2 = mkStroke(
      [
        { x: 200, y: 200 },
        { x: 300, y: 300 },
      ],
      true,
    )
    const b = expectBounds(computeBoardBounds([s1, s2]))
    // s2 excluded — width should not extend to 300+
    expect(b.x + b.width).toBeLessThan(300 + EXPORT_MARGIN)
  })

  test('empty-samples stroke does not crash + does not contribute', () => {
    const s1 = mkStroke([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ])
    const s2 = mkStroke([]) // empty samples
    const b = expectBounds(computeBoardBounds([s1, s2]))
    expect(b.x + b.width).toBeLessThan(200)
  })

  test('images contribute to bounds', () => {
    const img = mkImage(200, 200, 100, 50)
    const b = expectBounds(computeBoardBounds([], [img]))
    expect(b.x).toBe(200 - EXPORT_MARGIN)
    expect(b.y).toBe(200 - EXPORT_MARGIN)
    expect(b.width).toBe(100 + 2 * EXPORT_MARGIN)
    expect(b.height).toBe(50 + 2 * EXPORT_MARGIN)
  })

  test('strokes + images combined gives the union of their bounds', () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 50, y: 50 },
    ])
    const img = mkImage(100, 100, 200, 200)
    const b = expectBounds(computeBoardBounds([s], [img]))
    expect(b.x).toBeLessThanOrEqual(0)
    expect(b.x + b.width).toBeGreaterThanOrEqual(300)
    expect(b.y + b.height).toBeGreaterThanOrEqual(300)
  })

  test('deleted images do not contribute', () => {
    const live = mkImage(0, 0, 50, 50)
    const dead = mkImage(500, 500, 100, 100, true)
    const b = expectBounds(computeBoardBounds([], [live, dead]))
    expect(b.x + b.width).toBeLessThan(500)
  })

  test('empty strokes + empty images → null', () => {
    expect(computeBoardBounds([], [])).toBeNull()
  })
})
