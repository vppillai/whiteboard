import { describe, expect, test } from 'bun:test'
import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import {
  loadAllStrokes,
  partitionForCompaction,
  partitionImagesForCompaction,
  partitionShapesForCompaction,
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

function mkShape(id: string, opts: { deleted?: boolean } = {}): ShapeObject {
  return {
    id,
    shape: 'rect',
    transform: { x: 0, y: 0, w: 100, h: 100 },
    color: 'ink',
    strokeWidth: 2,
    z: 1,
    createdAt: 0,
    ...(opts.deleted !== undefined ? { deleted: opts.deleted } : {}),
  }
}

describe('storage/partitionShapesForCompaction', () => {
  test('keeps non-deleted shapes', () => {
    const ts = [mkShape('a'), mkShape('b'), mkShape('c')]
    const { kept, toCompact } = partitionShapesForCompaction(ts)
    expect(kept.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(toCompact).toEqual([])
  })

  test('moves deleted=true shapes to toCompact (id only)', () => {
    const ts = [
      mkShape('a'),
      mkShape('b', { deleted: true }),
      mkShape('c'),
      mkShape('d', { deleted: true }),
    ]
    const { kept, toCompact } = partitionShapesForCompaction(ts)
    expect(kept.map((s) => s.id)).toEqual(['a', 'c'])
    expect(toCompact).toEqual(['b', 'd'])
  })

  test('treats deleted=false as kept', () => {
    const { kept, toCompact } = partitionShapesForCompaction([mkShape('a', { deleted: false })])
    expect(kept).toHaveLength(1)
    expect(toCompact).toEqual([])
  })

  test('empty input → empty output', () => {
    const { kept, toCompact } = partitionShapesForCompaction([])
    expect(kept).toEqual([])
    expect(toCompact).toEqual([])
  })
})

// ─── getDb open-failure caching (regression) ────────────────────────────────
//
// bun test has no real IndexedDB, but storage.ts reads the bare `indexedDB`
// global at call time, so a minimal fake on globalThis is enough to exercise
// the open path. Regression for the bug where a rejected open was cached in
// the module-level `dbPromise` forever, silently killing persistence for the
// whole session (persist-callbacks.ts swallows the rejections).

type FakeOpenRequest = {
  onupgradeneeded: (() => void) | null
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  onblocked: (() => void) | null
  result?: unknown
  error?: Error
}

/** Minimal IDBDatabase fake: any transaction/getAll resolves to []. */
function makeFakeDb(): unknown {
  return {
    onclose: null,
    transaction: () => ({
      objectStore: () => ({
        getAll: () => {
          const req: {
            onsuccess: (() => void) | null
            onerror: (() => void) | null
            result: unknown[]
          } = { onsuccess: null, onerror: null, result: [] }
          // IDB events are always async; fire after handlers are attached.
          queueMicrotask(() => req.onsuccess?.())
          return req
        },
      }),
    }),
  }
}

/** IDBFactory fake whose first open fails and later opens succeed. */
function makeFlakyIndexedDB(): { factory: IDBFactory; openCalls: () => number } {
  let calls = 0
  const factory = {
    open: () => {
      calls += 1
      const req: FakeOpenRequest = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      }
      if (calls === 1) {
        req.error = new Error('simulated open failure')
        queueMicrotask(() => req.onerror?.())
      } else {
        req.result = makeFakeDb()
        queueMicrotask(() => req.onsuccess?.())
      }
      return req
    },
  }
  return { factory: factory as unknown as IDBFactory, openCalls: () => calls }
}

describe('storage/getDb', () => {
  test('failed open is not cached — the next call retries and succeeds', async () => {
    const { factory, openCalls } = makeFlakyIndexedDB()
    const g = globalThis as { indexedDB?: IDBFactory }
    const prev = g.indexedDB
    g.indexedDB = factory
    try {
      // First call: open rejects.
      await expect(loadAllStrokes()).rejects.toThrow('simulated open failure')
      // Second call: before the fix this re-rejected with the cached
      // error; after the fix it re-opens and succeeds.
      const strokes = await loadAllStrokes()
      expect(strokes).toEqual([])
      expect(openCalls()).toBe(2)
    } finally {
      if (prev === undefined) delete g.indexedDB
      else g.indexedDB = prev
    }
  })
})
