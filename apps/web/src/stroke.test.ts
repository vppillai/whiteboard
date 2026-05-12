import { describe, expect, test } from 'bun:test'
import type { BrushConfig } from '@whiteboard/shared'
import { applyPressure, bezierY, synthesizePressureFromVelocity } from './stroke'

describe('stroke: bezierY', () => {
  test('boundary: bezierY(0, anything) === 0', () => {
    expect(bezierY(0, [0.5, 0.5])).toBeCloseTo(0, 6)
    expect(bezierY(0, [0.7, 0.3])).toBeCloseTo(0, 6)
    expect(bezierY(0, [0.2, 0.8])).toBeCloseTo(0, 6)
  })

  test('boundary: bezierY(1, anything) === 1', () => {
    expect(bezierY(1, [0.5, 0.5])).toBeCloseTo(1, 6)
    expect(bezierY(1, [0.7, 0.3])).toBeCloseTo(1, 6)
    expect(bezierY(1, [0.2, 0.8])).toBeCloseTo(1, 6)
  })

  test('linear curve: mid at (0.5, 0.5) gives output === input', () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(bezierY(x, [0.5, 0.5])).toBeCloseTo(x, 5)
    }
  })

  test('curve below diagonal: mid at (0.5, 0.25)', () => {
    expect(bezierY(0.5, [0.5, 0.25])).toBeCloseTo(0.25, 5)
    expect(bezierY(0.25, [0.5, 0.25])).toBeLessThan(0.25)
  })

  test('curve above diagonal: mid at (0.5, 0.75)', () => {
    expect(bezierY(0.5, [0.5, 0.75])).toBeCloseTo(0.75, 5)
    expect(bezierY(0.25, [0.5, 0.75])).toBeGreaterThan(0.25)
  })

  test('output is clamped to [0, 1]', () => {
    for (const x of [0, 0.5, 1]) {
      const y = bezierY(x, [0.9, 0.1])
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(1)
    }
  })

  test('monotonic in x for sane curves', () => {
    let last = -1
    for (let x = 0; x <= 1; x += 0.1) {
      const y = bezierY(x, [0.5, 0.3])
      expect(y).toBeGreaterThanOrEqual(last - 1e-9)
      last = y
    }
  })
})

describe('stroke: applyPressure', () => {
  const baseBrush: BrushConfig = {
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
    opacity: 1,
  }

  test('no curve override → uses pressureGamma', () => {
    const out = applyPressure(0.5, baseBrush)
    expect(out).toBeCloseTo(0.5 ** 1.5, 6)
  })

  test('with curve override → uses bezier', () => {
    const brush = { ...baseBrush, pressureCurve: { mid: [0.5, 0.25] as [number, number] } }
    const out = applyPressure(0.5, brush)
    expect(out).toBeCloseTo(0.25, 5)
  })

  test('curve takes precedence over pressureGamma', () => {
    const brush = {
      ...baseBrush,
      pressureGamma: 3.0,
      pressureCurve: { mid: [0.5, 0.5] as [number, number] },
    }
    const out = applyPressure(0.5, brush)
    expect(out).toBeCloseTo(0.5, 5)
  })
})

describe('stroke: synthesizePressureFromVelocity', () => {
  test('zero velocity yields max pressure', () => {
    // Stationary cursor → fully pressed; matches the "first sample of a
    // stroke" path where there's no prior to compute a velocity from.
    expect(synthesizePressureFromVelocity(0)).toBeCloseTo(0.85, 5)
  })

  test('velocity at saturation yields min pressure', () => {
    // At and above V_SAT (1.6 px/ms) the curve flatlines at P_MIN — fast
    // scribbles stay visible, no fade-to-zero failure mode.
    expect(synthesizePressureFromVelocity(1.6)).toBeCloseTo(0.3, 5)
    expect(synthesizePressureFromVelocity(10)).toBeCloseTo(0.3, 5)
  })

  test('intermediate velocity interpolates monotonically', () => {
    const slow = synthesizePressureFromVelocity(0.3)
    const mid = synthesizePressureFromVelocity(0.8)
    const fast = synthesizePressureFromVelocity(1.3)
    expect(slow).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(fast)
    // Midpoint (~half V_SAT) lands roughly halfway between P_MAX and P_MIN.
    expect(mid).toBeCloseTo(0.85 - (0.85 - 0.3) * 0.5, 2)
  })

  test('rejects non-finite / negative input by returning max pressure', () => {
    // Defensive: NaN / Infinity from a malformed event shouldn't render a
    // ghost stroke at min pressure. Treat as "stationary" instead.
    expect(synthesizePressureFromVelocity(Number.NaN)).toBeCloseTo(0.85, 5)
    expect(synthesizePressureFromVelocity(Number.POSITIVE_INFINITY)).toBeCloseTo(0.85, 5)
    expect(synthesizePressureFromVelocity(-1)).toBeCloseTo(0.85, 5)
  })
})
