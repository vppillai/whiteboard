import { describe, expect, test } from 'bun:test'
import type { Stroke } from '@whiteboard/shared'
import { type Bounds, EXPORT_MARGIN, computeBoardBounds } from './bounds'

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
})
