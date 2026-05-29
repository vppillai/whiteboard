import { describe, expect, test } from 'bun:test'
import type { Stroke } from '@whiteboard/shared'
import { _applyStrokeMoveStep } from './select'

// Characterization tests for the stroke move-delta helper extracted in M4
// (A4). The two call sites (single-drag onPointerMove + multi-drag tick) have
// no integration coverage, so these lock in the step-delta arithmetic that
// both rely on: incremental translation, erasedStamps tracking, and the
// applied-total advance.
function mkStroke(): Stroke {
  return {
    id: 's1',
    brush: {
      size: 2,
      color: 'ink',
      thinning: 0.5,
      smoothing: 0.5,
      streamline: 0.5,
      taperStart: 0,
      taperEnd: 0,
      capStart: true,
      capEnd: true,
      pressureGamma: 1,
    },
    samples: [
      { x: 10, y: 20, p: 0.5, t: 0 },
      { x: 12, y: 24, p: 0.5, t: 1 },
    ],
    startedAt: 0,
  }
}

describe('select: _applyStrokeMoveStep', () => {
  test('translates samples by the step delta and advances the applied tracker', () => {
    const stroke = mkStroke()
    const applied = { dx: 0, dy: 0 }
    _applyStrokeMoveStep(stroke, applied, 5, -3)
    expect(stroke.samples[0]).toMatchObject({ x: 15, y: 17 })
    expect(stroke.samples[1]).toMatchObject({ x: 17, y: 21 })
    expect(applied).toEqual({ dx: 5, dy: -3 })
  })

  test('applies only the incremental step on a second call (delta, not absolute)', () => {
    const stroke = mkStroke()
    const applied = { dx: 0, dy: 0 }
    _applyStrokeMoveStep(stroke, applied, 5, 5) // step +5,+5
    _applyStrokeMoveStep(stroke, applied, 8, 5) // step +3,0 only
    expect(stroke.samples[0]).toMatchObject({ x: 18, y: 25 }) // 10+8, 20+5
    expect(applied).toEqual({ dx: 8, dy: 5 })
  })

  test('translates erasedStamps alongside samples', () => {
    const stroke = mkStroke()
    stroke.erasedStamps = [{ x: 100, y: 200, r: 8 }]
    _applyStrokeMoveStep(stroke, { dx: 0, dy: 0 }, 5, -3)
    expect(stroke.erasedStamps[0]).toEqual({ x: 105, y: 197, r: 8 })
  })

  test('no-op on a zero step (samples + tracker unchanged)', () => {
    const stroke = mkStroke()
    const applied = { dx: 4, dy: 4 }
    _applyStrokeMoveStep(stroke, applied, 4, 4) // step 0,0
    expect(stroke.samples[0]).toMatchObject({ x: 10, y: 20 })
    expect(applied).toEqual({ dx: 4, dy: 4 })
  })
})
