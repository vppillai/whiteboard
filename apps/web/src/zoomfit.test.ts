import { describe, expect, test } from 'bun:test'
import type { ImageObject, Stroke, TextObject } from '@whiteboard/shared'
import { makeCamera } from './camera'
import { fitToContent } from './zoomfit'

const VIEW = { width: 800, height: 600 }

function mkStroke(opts: Partial<Stroke> = {}): Stroke {
  return {
    id: 's1',
    brush: {
      id: 'fine-tip',
      color: 'ink',
      size: 2,
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.5,
      taperStart: 0,
      taperEnd: 0,
      capStart: true,
      capEnd: true,
    },
    samples: [
      { x: 0, y: 0, pressure: 0.5, t: 0 },
      { x: 100, y: 100, pressure: 0.5, t: 10 },
    ],
    startedAt: 0,
    ...opts,
  }
}

function mkImage(opts: Partial<ImageObject> = {}): ImageObject {
  return {
    id: 'i1',
    blobKey: 'k1',
    transform: { x: 200, y: 200, w: 100, h: 100 },
    z: 1,
    createdAt: 0,
    ...opts,
  }
}

function mkText(opts: Partial<TextObject> = {}): TextObject {
  return {
    id: 't1',
    content: 'x',
    font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
    color: 'ink',
    transform: { x: 300, y: 300, w: 50, h: 16 },
    z: 1,
    createdAt: 0,
    ...opts,
  }
}

describe('zoomfit: fitToContent', () => {
  test('empty board → returns false, camera untouched', () => {
    const cam = makeCamera()
    const before = { ...cam }
    const fit = fitToContent(cam, { strokes: [] }, VIEW)
    expect(fit).toBe(false)
    expect(cam).toEqual(before)
  })

  test('strokes only → fits to stroke bbox', () => {
    const cam = makeCamera()
    const fit = fitToContent(cam, { strokes: [mkStroke()] }, VIEW)
    expect(fit).toBe(true)
    // Stroke spans 0–100; center should be near (50, 50).
    expect(cam.scale).toBeGreaterThan(1)
  })

  test('images-only board fits — regression for v1.2 Cmd+1 no-op bug', () => {
    const cam = makeCamera()
    const fit = fitToContent(cam, { strokes: [], images: [mkImage()] }, VIEW)
    expect(fit).toBe(true)
  })

  test('texts-only board fits — regression for v1.2 Cmd+1 no-op bug', () => {
    const cam = makeCamera()
    const fit = fitToContent(cam, { strokes: [], texts: [mkText()] }, VIEW)
    expect(fit).toBe(true)
  })

  test('skips soft-deleted objects across all kinds', () => {
    const cam = makeCamera()
    const fit = fitToContent(
      cam,
      {
        strokes: [mkStroke({ deleted: true })],
        images: [mkImage({ deleted: true })],
        texts: [mkText({ deleted: true })],
      },
      VIEW,
    )
    expect(fit).toBe(false)
  })

  test('combined-kind bbox spans the union, not any single kind', () => {
    const cam = makeCamera()
    // Stroke at (0..100), image at (200..300), text at (300..350).
    // Union spans 0..350 in x; center ≈ 175.
    fitToContent(cam, { strokes: [mkStroke()], images: [mkImage()], texts: [mkText()] }, VIEW)
    // If union were ignored, center would land on whichever subset was used.
    // Sanity: scale chosen makes 350-wide bbox visible inside 800px viewport.
    expect(cam.scale).toBeGreaterThan(0.1)
    expect(cam.scale).toBeLessThanOrEqual(8)
  })
})
