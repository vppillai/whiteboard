import { describe, expect, test } from 'bun:test'
import type { BrushConfig, ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import { createEraserTool } from './eraser'
import type { ToolContext } from './types'

function mkCtx(): ToolContext {
  const ctx2d = {
    setTransform: () => {},
    save: () => {},
    clearRect: () => {},
    restore: () => {},
    beginPath: () => {},
    arc: () => {},
    stroke: () => {},
    fill: () => {},
  } as unknown as CanvasRenderingContext2D
  const liveLayer = {
    el: { width: 100, height: 100 } as HTMLCanvasElement,
    ctx: ctx2d,
  }
  const brush: BrushConfig = {
    size: 2,
    color: 'ink',
    thinning: 0.7,
    smoothing: 0.5,
    streamline: 0.5,
    taperStart: 0,
    taperEnd: 0,
    capStart: true,
    capEnd: true,
    pressureGamma: 1,
  }
  return {
    toBoard: (x, y) => ({ x, y }),
    getBrush: () => brush,
    liveLayer,
    camera: { x: 0, y: 0, scale: 1 },
    dpr: 1,
    resolveColor: (token) => token,
    markCommittedDirty: () => {},
    setCursor: () => {},
    getLastPointer: () => ({ x: 0, y: 0 }),
  }
}

function mkPointer(x: number, y: number, shiftKey: boolean): PointerEvent {
  return {
    clientX: x,
    clientY: y,
    shiftKey,
    getCoalescedEvents: () => [],
  } as unknown as PointerEvent
}

describe('eraser object mode selection semantics', () => {
  test('tap picks one topmost non-stroke object only', () => {
    const shapes: ShapeObject[] = [
      {
        id: 'shape-1',
        shape: 'rect',
        color: 'ink',
        strokeWidth: 2,
        fill: 'ink',
        transform: { x: 0, y: 0, w: 20, h: 20 },
        z: 1,
        createdAt: 0,
      },
    ]
    const texts: TextObject[] = [
      {
        id: 'text-1',
        content: 'top',
        font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
        color: 'ink',
        transform: { x: 0, y: 0, w: 20, h: 20 },
        z: 3,
        createdAt: 0,
      },
    ]
    const images: ImageObject[] = [
      {
        id: 'img-1',
        blobRef: 'blob-1',
        format: 'png',
        natural: { w: 20, h: 20 },
        transform: { x: 0, y: 0, w: 20, h: 20 },
        z: 2,
        createdAt: 0,
      },
    ]
    const strokeDeletes: string[] = []
    const wholeDeletes: Array<{ shapes: string[]; texts: string[]; images: string[] }> = []
    const tool = createEraserTool({
      callbacks: {
        getStrokes: () => [],
        getShapes: () => shapes,
        getTexts: () => texts,
        getImages: () => images,
        onObjectErase: (id) => strokeDeletes.push(id),
        onWipeErase: () => {},
        onWholeObjectErase: (d) => wholeDeletes.push(d),
      },
    })
    const ctx = mkCtx()

    tool.onPointerDown(mkPointer(10, 10, true), ctx)
    tool.onPointerUp(mkPointer(10, 10, true), ctx)

    expect(strokeDeletes).toHaveLength(0)
    expect(wholeDeletes).toHaveLength(1)
    expect(wholeDeletes[0]).toEqual({
      shapes: [],
      texts: ['text-1'],
      images: [],
    })
  })

  test('stroke hit suppresses non-stroke deletes for same tap', () => {
    const strokes: Stroke[] = [
      {
        id: 'stroke-1',
        brush: {
          size: 2,
          color: 'ink',
          thinning: 0.7,
          smoothing: 0.5,
          streamline: 0.5,
          taperStart: 0,
          taperEnd: 0,
          capStart: true,
          capEnd: true,
          pressureGamma: 1,
        },
        samples: [
          { x: 0, y: 0, p: 1, t: 0 },
          { x: 20, y: 20, p: 1, t: 1 },
        ],
        startedAt: 0,
      },
    ]
    const shapes: ShapeObject[] = [
      {
        id: 'shape-1',
        shape: 'rect',
        color: 'ink',
        strokeWidth: 2,
        fill: 'ink',
        transform: { x: 0, y: 0, w: 30, h: 30 },
        z: 1,
        createdAt: 0,
      },
    ]
    const strokeDeletes: string[] = []
    const wholeDeletes: Array<{ shapes: string[]; texts: string[]; images: string[] }> = []
    const tool = createEraserTool({
      callbacks: {
        getStrokes: () => strokes,
        getShapes: () => shapes,
        getTexts: () => [],
        getImages: () => [],
        onObjectErase: (id) => strokeDeletes.push(id),
        onWipeErase: () => {},
        onWholeObjectErase: (d) => wholeDeletes.push(d),
      },
    })
    const ctx = mkCtx()

    tool.onPointerDown(mkPointer(10, 10, true), ctx)
    tool.onPointerUp(mkPointer(10, 10, true), ctx)

    expect(strokeDeletes).toEqual(['stroke-1'])
    expect(wholeDeletes).toHaveLength(0)
  })
})
