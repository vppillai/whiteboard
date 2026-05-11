import { describe, expect, test } from 'bun:test'
import { graphToNorm, normToGraph, sampleCurvePolyline } from './curve-editor'

describe('curve-editor: graph ↔ norm transforms', () => {
  const W = 200
  const H = 120

  test('graphToNorm bottom-left → (0, 0)', () => {
    const [x, y] = graphToNorm(0, H, W, H)
    expect(x).toBeCloseTo(0, 5)
    expect(y).toBeCloseTo(0, 5)
  })

  test('graphToNorm top-right → (1, 1)', () => {
    const [x, y] = graphToNorm(W, 0, W, H)
    expect(x).toBeCloseTo(1, 5)
    expect(y).toBeCloseTo(1, 5)
  })

  test('graphToNorm center → (0.5, 0.5)', () => {
    const [x, y] = graphToNorm(W / 2, H / 2, W, H)
    expect(x).toBeCloseTo(0.5, 5)
    expect(y).toBeCloseTo(0.5, 5)
  })

  test('graphToNorm clamps out-of-bounds inputs', () => {
    const [x1, y1] = graphToNorm(-50, -50, W, H)
    expect(x1).toBe(0)
    expect(y1).toBeCloseTo(1, 5)
    const [x2, y2] = graphToNorm(W + 50, H + 50, W, H)
    expect(x2).toBe(1)
    expect(y2).toBe(0)
  })

  test('normToGraph round-trips graphToNorm', () => {
    for (const [nx, ny] of [
      [0.25, 0.75],
      [0.5, 0.5],
      [0.7, 0.3],
    ] as const) {
      const [gx, gy] = normToGraph(nx, ny, W, H)
      const [nxOut, nyOut] = graphToNorm(gx, gy, W, H)
      expect(nxOut).toBeCloseTo(nx, 5)
      expect(nyOut).toBeCloseTo(ny, 5)
    }
  })
})

describe('curve-editor: sampleCurvePolyline', () => {
  test('linear curve (mid 0.5,0.5) gives diagonal samples', () => {
    const pts = sampleCurvePolyline([0.5, 0.5], 5)
    expect(pts).toHaveLength(5)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[4]).toEqual([1, 1])
    expect(pts[2]?.[0]).toBeCloseTo(0.5, 4)
    expect(pts[2]?.[1]).toBeCloseTo(0.5, 4)
  })

  test('through-point semantics: mid (0.5, 0.25) ⇒ at x=0.5, y≈0.25', () => {
    const pts = sampleCurvePolyline([0.5, 0.25], 5)
    expect(pts[2]?.[1]).toBeCloseTo(0.25, 4)
    expect(pts[2]?.[1]).toBeLessThan(pts[2]?.[0] ?? 1)
  })

  test('γ-shaped polyline (no override; passes pressureGamma)', () => {
    const pts = sampleCurvePolyline(null, 5, 1.5)
    expect(pts[0]).toEqual([0, 0])
    expect(pts[4]).toEqual([1, 1])
    expect(pts[2]?.[1]).toBeCloseTo(0.5 ** 1.5, 4)
  })
})
