/**
 * Select-tool group-delete seam test: deleting a multi-kind selection
 * must emit exactly ONE composite `delete-many` op (so the whole group
 * restores in a single undo step) while preserving the per-object
 * soft-delete + persistence semantics. Wires the tool's `applyOp` dep
 * to the real ops module so the test observes actual state flips, not
 * just op recording.
 */

import { describe, expect, test } from 'bun:test'
import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import { applyOp, type Op, type OpContext } from '../ops'
import { createSelectTool } from './select'

function mkStroke(id: string): Stroke {
  return {
    id,
    brush: {
      color: 'ink',
      size: 2,
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.5,
      taperStart: 0,
      taperEnd: 0,
      capStart: true,
      capEnd: true,
      pressureGamma: 1,
    },
    samples: [{ x: 0, y: 0, p: 0.5, t: 0 }],
    startedAt: 0,
  }
}

function mkHarness() {
  const strokes: Stroke[] = [mkStroke('st-1'), mkStroke('st-2')]
  const images: ImageObject[] = [
    {
      id: 'img-1',
      blobRef: 'blob:img-1',
      format: 'png',
      natural: { w: 100, h: 100 },
      transform: { x: 0, y: 0, w: 100, h: 100 },
      z: 1,
      createdAt: 0,
    },
  ]
  const texts: TextObject[] = [
    {
      id: 'txt-1',
      content: 'hello',
      font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
      color: 'ink',
      wrapWidth: undefined,
      transform: { x: 20, y: 20, w: 40, h: 16 },
      z: 2,
      createdAt: 0,
    },
  ]
  const shapes: ShapeObject[] = [
    {
      id: 'sh-1',
      shape: 'rect',
      color: 'ink',
      strokeWidth: 2,
      transform: { x: 30, y: 30, w: 50, h: 40 },
      z: 3,
      createdAt: 0,
    },
  ]
  const pushed: Op[] = []
  const opCtx: OpContext = {
    strokes,
    saveStroke: () => {},
    images,
    saveImageMeta: () => {},
    texts,
    saveText: () => {},
    shapes,
    saveShape: () => {},
    markDirty: () => {},
  }
  const tool = createSelectTool({
    getImages: () => images,
    saveImageMeta: () => {},
    getTexts: () => texts,
    saveText: () => {},
    getShapes: () => shapes,
    saveShape: () => {},
    getStrokes: () => strokes,
    saveStroke: () => {},
    pushOp: (op) => pushed.push(op),
    applyOp: (op) => applyOp(op, opCtx),
    markCommittedDirty: () => {},
  })
  return { tool, pushed, strokes, images, texts, shapes }
}

describe('select: group delete emits one composite op', () => {
  test('deleting a mixed 5-object selection pushes exactly one delete-many', () => {
    const h = mkHarness()
    h.tool.selectByIds([
      { kind: 'stroke', id: 'st-1' },
      { kind: 'stroke', id: 'st-2' },
      { kind: 'image', id: 'img-1' },
      { kind: 'text', id: 'txt-1' },
      { kind: 'shape', id: 'sh-1' },
    ])
    expect(h.tool.deleteSelected()).toBe(true)
    expect(h.pushed).toHaveLength(1)
    expect(h.pushed[0]).toEqual({
      kind: 'delete-many',
      imageIds: ['img-1'],
      textIds: ['txt-1'],
      shapeIds: ['sh-1'],
      strokeIds: ['st-1', 'st-2'],
    })
    // The composite apply actually soft-deleted every object.
    expect(h.strokes.every((s) => s.deleted)).toBe(true)
    expect(h.images[0]?.deleted).toBe(true)
    expect(h.texts[0]?.deleted).toBe(true)
    expect(h.shapes[0]?.deleted).toBe(true)
    // Selection cleared.
    expect(h.tool.getSelections()).toHaveLength(0)
  })

  test('already-deleted objects are skipped; nothing live → no op pushed', () => {
    const h = mkHarness()
    h.tool.selectByIds([{ kind: 'stroke', id: 'st-1' }])
    const stroke = h.strokes[0]
    if (stroke) stroke.deleted = true
    expect(h.tool.deleteSelected()).toBe(false)
    expect(h.pushed).toHaveLength(0)
  })
})
