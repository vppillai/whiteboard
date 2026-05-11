import { describe, expect, test } from 'bun:test'
import type { Stroke } from '@whiteboard/shared'
import { partitionForCompaction } from './storage'

function mkStroke(id: string, deleted?: boolean): Stroke {
  return {
    id,
    brush: {
      size: 3,
      color: 'ink',
      thinning: 0.6,
      smoothing: 0.7,
      streamline: 0.4,
      taperStart: 0,
      taperEnd: 0,
      capStart: true,
      capEnd: true,
      pressureGamma: 1.5,
    },
    samples: [{ x: 0, y: 0, p: 0.5, t: 0 }],
    startedAt: 0,
    ...(deleted !== undefined ? { deleted } : {}),
  }
}

describe('storage/partitionForCompaction', () => {
  test('keeps non-deleted strokes', () => {
    const strokes = [mkStroke('a'), mkStroke('b'), mkStroke('c')]
    const { kept, toCompact } = partitionForCompaction(strokes)
    expect(kept.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(toCompact).toEqual([])
  })

  test('moves deleted=true strokes to toCompact', () => {
    const strokes = [mkStroke('a'), mkStroke('b', true), mkStroke('c'), mkStroke('d', true)]
    const { kept, toCompact } = partitionForCompaction(strokes)
    expect(kept.map((s) => s.id)).toEqual(['a', 'c'])
    expect(toCompact).toEqual(['b', 'd'])
  })

  test('treats deleted=false as kept (explicit false != true)', () => {
    const s = mkStroke('a', false)
    const { kept, toCompact } = partitionForCompaction([s])
    expect(kept).toHaveLength(1)
    expect(toCompact).toEqual([])
  })

  test('empty input → empty output', () => {
    const { kept, toCompact } = partitionForCompaction([])
    expect(kept).toEqual([])
    expect(toCompact).toEqual([])
  })
})
