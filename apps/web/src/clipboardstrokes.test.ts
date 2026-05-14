import { describe, expect, test } from 'bun:test'
import type { Stroke, TextObject } from '@whiteboard/shared'
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

function mkText(id: string, content: string, x = 50, y = 50): TextObject {
  return {
    id,
    content,
    font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
    color: 'ink',
    transform: { x, y, w: 50, h: 16 },
    z: 1,
    createdAt: 0,
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

  test('texts round-trip through the bundle', () => {
    const bundle: ClipboardStrokeBundle = {
      v: 1,
      strokes: [],
      texts: [mkText('t1', 'hello world'), mkText('t2', 'multi\nline', 200, 200)],
      origin: { x: 50, y: 50 },
    }
    const html = buildClipboardHtml(bundle, fakePng)
    const restored = extractStrokesFromHtml(html)
    expect(restored?.texts?.length).toBe(2)
    expect(restored?.texts?.[0]?.content).toBe('hello world')
    expect(restored?.texts?.[1]?.content).toBe('multi\nline')
    expect(restored?.texts?.[0]?.transform).toEqual({ x: 50, y: 50, w: 50, h: 16 })
  })

  test('mixed strokes + texts round-trip together', () => {
    const bundle: ClipboardStrokeBundle = {
      v: 1,
      strokes: [mkStroke('s1', [{ x: 0, y: 0 }])],
      texts: [mkText('t1', 'caption', 100, 100)],
      origin: { x: 0, y: 0 },
    }
    const html = buildClipboardHtml(bundle, fakePng)
    const restored = extractStrokesFromHtml(html)
    expect(restored?.strokes.length).toBe(1)
    expect(restored?.texts?.length).toBe(1)
    expect(restored?.strokes[0]?.id).toBe('s1')
    expect(restored?.texts?.[0]?.id).toBe('t1')
  })

  test('absent texts field is fine (strokes-only bundle)', () => {
    const bundle: ClipboardStrokeBundle = {
      v: 1,
      strokes: [mkStroke('a', [{ x: 0, y: 0 }])],
      origin: { x: 0, y: 0 },
    }
    const html = buildClipboardHtml(bundle, fakePng)
    const restored = extractStrokesFromHtml(html)
    expect(restored).not.toBeNull()
    expect(restored?.texts).toBeUndefined()
  })

  test('texts of wrong type (not array) returns null', () => {
    const html =
      '<div data-whiteboard-v1="{&quot;v&quot;:1,&quot;strokes&quot;:[],&quot;texts&quot;:&quot;not-an-array&quot;,&quot;origin&quot;:{&quot;x&quot;:0,&quot;y&quot;:0}}"></div>'
    expect(extractStrokesFromHtml(html)).toBeNull()
  })

  test('unknown additive fields are silently tolerated (forward-compat)', () => {
    // A future v=1 writer might add `images?` or other optional fields
    // — older readers should accept the bundle and ignore the unknowns.
    // This locks in the forward-compat policy documented in the file
    // header so a future patch that tightens the parser inadvertently
    // breaks cross-version clipboard.
    const bundle = {
      v: 1,
      strokes: [],
      origin: { x: 0, y: 0 },
      images: ['future-field-from-v1.4'],
      somethingElse: { nested: true },
    }
    const json = JSON.stringify(bundle)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
    const html = `<div data-whiteboard-v1="${json}"></div>`
    const restored = extractStrokesFromHtml(html)
    expect(restored).not.toBeNull()
    expect(restored?.strokes).toEqual([])
  })

  test('DoS cap: > 5000 strokes returns null', () => {
    // Defensive: a malicious page could put a huge stroke array in the
    // clipboard and try to flood IDB / slow the canvas. The parser
    // rejects bundles past the cap.
    const huge = { v: 1, strokes: new Array(5001).fill(null), origin: { x: 0, y: 0 } }
    const json = JSON.stringify(huge).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const html = `<div data-whiteboard-v1="${json}"></div>`
    expect(extractStrokesFromHtml(html)).toBeNull()
  })

  test('DoS cap: > 50000 samples per stroke returns null', () => {
    const stroke = mkStroke('s1', [])
    // Synthetically inflate samples past the cap.
    const inflated = {
      ...stroke,
      samples: new Array(50001).fill({ x: 0, y: 0, p: 0.5, t: 0 }),
    }
    const bundle = { v: 1, strokes: [inflated], origin: { x: 0, y: 0 } }
    const json = JSON.stringify(bundle).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const html = `<div data-whiteboard-v1="${json}"></div>`
    expect(extractStrokesFromHtml(html)).toBeNull()
  })

  test('shape validation rejects stroke missing required fields', () => {
    // `id` missing → reject entire bundle.
    const bogus = {
      v: 1,
      strokes: [{ samples: [], startedAt: 0, brush: {} }],
      origin: { x: 0, y: 0 },
    }
    const json = JSON.stringify(bogus).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const html = `<div data-whiteboard-v1="${json}"></div>`
    expect(extractStrokesFromHtml(html)).toBeNull()
  })

  test('shape validation rejects text missing required fields', () => {
    const bogus = {
      v: 1,
      strokes: [],
      texts: [{ id: 't1', content: 'x' }], // missing transform, font, color
      origin: { x: 0, y: 0 },
    }
    const json = JSON.stringify(bogus).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const html = `<div data-whiteboard-v1="${json}"></div>`
    expect(extractStrokesFromHtml(html)).toBeNull()
  })
})
