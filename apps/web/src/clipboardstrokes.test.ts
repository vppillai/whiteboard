import { describe, expect, test } from 'bun:test'
import type { Stroke } from '@whiteboard/shared'
import {
  type ClipboardStrokeBundle,
  buildClipboardHtml,
  extractStrokesFromHtml,
} from './clipboardstrokes'

function mkStroke(id: string, samples: { x: number; y: number }[]): Stroke {
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
    samples: samples.map((p) => ({ x: p.x, y: p.y, p: 0.5, t: 0 })),
    startedAt: 0,
  }
}

const fakePng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

describe('clipboardstrokes: round-trip', () => {
  test('basic strokes survive build → extract', () => {
    const bundle: ClipboardStrokeBundle = {
      v: 1,
      strokes: [
        mkStroke('a', [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ]),
      ],
      origin: { x: 0, y: 0 },
    }
    const html = buildClipboardHtml(bundle, fakePng)
    const restored = extractStrokesFromHtml(html)
    expect(restored).not.toBeNull()
    expect(restored?.v).toBe(1)
    expect(restored?.strokes.length).toBe(1)
    expect(restored?.strokes[0]?.id).toBe('a')
    expect(restored?.strokes[0]?.samples.length).toBe(2)
    expect(restored?.origin).toEqual({ x: 0, y: 0 })
  })

  test('multiple strokes preserve order and origin', () => {
    const bundle: ClipboardStrokeBundle = {
      v: 1,
      strokes: [
        mkStroke('a', [{ x: 100, y: 100 }]),
        mkStroke('b', [{ x: 200, y: 200 }]),
        mkStroke('c', [{ x: 300, y: 300 }]),
      ],
      origin: { x: 100, y: 100 },
    }
    const html = buildClipboardHtml(bundle, fakePng)
    const restored = extractStrokesFromHtml(html)
    expect(restored?.strokes.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(restored?.origin).toEqual({ x: 100, y: 100 })
  })

  test('non-whiteboard HTML returns null (Google Docs, etc.)', () => {
    expect(extractStrokesFromHtml('<p>Just some pasted text from a document</p>')).toBeNull()
    expect(extractStrokesFromHtml('')).toBeNull()
    expect(extractStrokesFromHtml('<div><img src="data:image/png;base64,XYZ" /></div>')).toBeNull()
  })

  test('malformed JSON returns null without throwing', () => {
    expect(extractStrokesFromHtml('<div data-whiteboard-v1="{not-valid-json}"></div>')).toBeNull()
    expect(extractStrokesFromHtml('<div data-whiteboard-v1=""></div>')).toBeNull()
  })

  test('unknown version returns null (forward-compat)', () => {
    const html =
      '<div data-whiteboard-v1="{&quot;v&quot;:99,&quot;strokes&quot;:[],&quot;origin&quot;:{&quot;x&quot;:0,&quot;y&quot;:0}}"></div>'
    expect(extractStrokesFromHtml(html)).toBeNull()
  })

  test('escapes attribute-breaking characters in JSON', () => {
    // A stroke id containing characters that could close the attribute
    // early or break the JSON wrapper if not encoded.
    const bundle: ClipboardStrokeBundle = {
      v: 1,
      strokes: [mkStroke('id-with-"quote"-and-<lt>', [{ x: 0, y: 0 }])],
      origin: { x: 0, y: 0 },
    }
    const html = buildClipboardHtml(bundle, fakePng)
    const restored = extractStrokesFromHtml(html)
    expect(restored?.strokes[0]?.id).toBe('id-with-"quote"-and-<lt>')
  })

  test('missing origin returns null', () => {
    const html = '<div data-whiteboard-v1="{&quot;v&quot;:1,&quot;strokes&quot;:[]}"></div>'
    expect(extractStrokesFromHtml(html)).toBeNull()
  })
})
