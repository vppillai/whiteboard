import { describe, expect, test } from 'bun:test'
import type { ImageObject, Stroke, TextObject } from '@whiteboard/shared'
import {
  partitionForCompaction,
  partitionImagesForCompaction,
  partitionTextsForCompaction,
} from './storage'

function mkImage(id: string, opts: { z?: number; deleted?: boolean } = {}): ImageObject {
  return {
    id,
    blobRef: id,
    format: 'png',
    natural: { w: 100, h: 100 },
    transform: { x: 0, y: 0, w: 100, h: 100 },
    z: opts.z ?? 1,
    createdAt: 0,
    ...(opts.deleted !== undefined ? { deleted: opts.deleted } : {}),
  }
}

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

describe('storage/partitionImagesForCompaction', () => {
  test('keeps non-deleted images', () => {
    const imgs = [mkImage('a'), mkImage('b'), mkImage('c')]
    const { kept, toCompact } = partitionImagesForCompaction(imgs)
    expect(kept.map((i) => i.id)).toEqual(['a', 'b', 'c'])
    expect(toCompact).toEqual([])
  })

  test('moves deleted=true images to toCompact with {id, blobRef}', () => {
    const imgs = [
      mkImage('a'),
      mkImage('b', { deleted: true }),
      mkImage('c'),
      mkImage('d', { deleted: true }),
    ]
    const { kept, toCompact } = partitionImagesForCompaction(imgs)
    expect(kept.map((i) => i.id)).toEqual(['a', 'c'])
    // toCompact carries `{ id, blobRef }` so deleteImage can drop the
    // matching blob row even if a future schema makes blobRef !== id.
    expect(toCompact).toEqual([
      { id: 'b', blobRef: 'b' },
      { id: 'd', blobRef: 'd' },
    ])
  })

  test('treats deleted=false as kept', () => {
    const i = mkImage('a', { deleted: false })
    const { kept, toCompact } = partitionImagesForCompaction([i])
    expect(kept).toHaveLength(1)
    expect(toCompact).toEqual([])
  })

  test('empty input → empty output', () => {
    const { kept, toCompact } = partitionImagesForCompaction([])
    expect(kept).toEqual([])
    expect(toCompact).toEqual([])
  })
})

function mkText(id: string, opts: { deleted?: boolean } = {}): TextObject {
  return {
    id,
    content: 'hello',
    font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
    color: 'ink',
    transform: { x: 0, y: 0, w: 40, h: 16 },
    z: 1,
    createdAt: 0,
    ...(opts.deleted !== undefined ? { deleted: opts.deleted } : {}),
  }
}

describe('storage/partitionTextsForCompaction', () => {
  test('keeps non-deleted texts', () => {
    const ts = [mkText('a'), mkText('b'), mkText('c')]
    const { kept, toCompact } = partitionTextsForCompaction(ts)
    expect(kept.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(toCompact).toEqual([])
  })

  test('moves deleted=true texts to toCompact (id only)', () => {
    const ts = [
      mkText('a'),
      mkText('b', { deleted: true }),
      mkText('c'),
      mkText('d', { deleted: true }),
    ]
    const { kept, toCompact } = partitionTextsForCompaction(ts)
    expect(kept.map((t) => t.id)).toEqual(['a', 'c'])
    // Unlike images, text records have no companion blob store — the
    // compaction identifier is just `id`, no `blobRef` tuple needed.
    expect(toCompact).toEqual(['b', 'd'])
  })

  test('treats deleted=false as kept', () => {
    const { kept, toCompact } = partitionTextsForCompaction([mkText('a', { deleted: false })])
    expect(kept).toHaveLength(1)
    expect(toCompact).toEqual([])
  })

  test('empty input → empty output', () => {
    const { kept, toCompact } = partitionTextsForCompaction([])
    expect(kept).toEqual([])
    expect(toCompact).toEqual([])
  })
})
