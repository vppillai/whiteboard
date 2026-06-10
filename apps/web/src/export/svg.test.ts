import { describe, expect, test } from 'bun:test'
import type { ImageObject, ShapeObject, Stroke, TextObject } from '@whiteboard/shared'
import type { SettingsV1 } from '../settings'
import { exportSVG } from './svg'

function mkImage(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<ImageObject> = {},
): ImageObject {
  return {
    id,
    blobRef: `blob-${id}`,
    format: 'png',
    natural: { w, h },
    transform: { x, y, w, h },
    z: 1,
    createdAt: 0,
    deleted: false,
    ...extra,
  }
}

function mkText(
  content: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<TextObject> = {},
): TextObject {
  return {
    id: Math.random().toString(36).slice(2),
    content,
    font: { family: 'mono', size: 12, bold: false, italic: false, underline: false },
    color: 'ink',
    transform: { x, y, w, h },
    z: 1,
    createdAt: 0,
    deleted: false,
    ...extra,
  }
}

function mkShape(
  kind: ShapeObject['shape'],
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<ShapeObject> = {},
): ShapeObject {
  return {
    id: Math.random().toString(36).slice(2),
    shape: kind,
    transform: { x, y, w, h },
    color: 'ink',
    strokeWidth: 2,
    z: 1,
    createdAt: 0,
    deleted: false,
    ...extra,
  }
}

function mkStroke(samples: { x: number; y: number }[], extra: Partial<Stroke> = {}): Stroke {
  return {
    id: extra.id ?? 's1',
    brush: extra.brush ?? {
      size: 3,
      color: '#ef4444',
      thinning: 0.6,
      smoothing: 0.7,
      streamline: 0.4,
      taperStart: 0,
      taperEnd: 0,
      capStart: true,
      capEnd: true,
      pressureGamma: 1.5,
      opacity: 0.94,
    },
    samples: samples.map((s) => ({ x: s.x, y: s.y, p: 0.5, t: 0 })),
    startedAt: 0,
    ...extra,
  }
}

const baseSettings: SettingsV1 = {
  schemaVersion: 1,
  color: '#000000',
  brush: 'pen',
  eraserSize: 'medium',
  grid: { type: 'none', spacing: 24 },
  presets: {},
  customSwatches: [],
  recentColors: [],
  predictedEvents: false,
  mouseSyntheticPressure: false,
  laserColor: '#ef4444',
  textFont: 'mono',
  textSize: 12,
  textBold: false,
  textItalic: false,
  textUnderline: false,
  textColor: 'ink',
  shapeKind: 'rect',
  shapeColor: 'ink',
  shapeStrokeWidth: 2,
  shapeFillEnabled: false,
  shapeFillOpacity: 0.25,
}

describe('export/svg', () => {
  test('returns image/svg+xml blob', () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
    const blob = exportSVG(
      [s],
      [],
      new Map(),
      [],
      [],
      { x: -10, y: -10, width: 30, height: 30 },
      baseSettings,
    )
    expect(blob.type).toBe('image/svg+xml')
  })

  test('output contains viewBox + path element', async () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
    const blob = exportSVG(
      [s],
      [],
      new Map(),
      [],
      [],
      { x: -10, y: -10, width: 30, height: 30 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).toContain('<svg')
    expect(text).toContain('viewBox="-10.00 -10.00 30.00 30.00"')
    expect(text).toContain('<path')
  })

  test('highlighter stroke gets mix-blend-mode: multiply', async () => {
    const s = mkStroke(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      {
        brush: {
          size: 18,
          color: '#fbbf24',
          thinning: 0,
          smoothing: 0.3,
          streamline: 0.5,
          taperStart: 0,
          taperEnd: 0,
          capStart: false,
          capEnd: false,
          pressureGamma: 1,
          opacity: 0.4,
        },
      },
    )
    const blob = exportSVG(
      [s],
      [],
      new Map(),
      [],
      [],
      { x: -10, y: -10, width: 30, height: 30 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).toContain('mix-blend-mode:multiply')
  })

  test('non-highlighter stroke has no blend mode', async () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
    const blob = exportSVG(
      [s],
      [],
      new Map(),
      [],
      [],
      { x: -10, y: -10, width: 30, height: 30 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).not.toContain('mix-blend-mode')
  })

  test('stroke with erasedStamps gets a mask reference', async () => {
    const s = mkStroke(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      {
        erasedStamps: [{ x: 5, y: 5, r: 3 }],
      },
    )
    const blob = exportSVG(
      [s],
      [],
      new Map(),
      [],
      [],
      { x: -10, y: -10, width: 30, height: 30 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).toContain('<mask')
    expect(text).toContain('<circle')
    expect(text).toContain('mask="url(#wb-mask-')
  })

  test('grid type "none" omits pattern', async () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
    const blob = exportSVG(
      [s],
      [],
      new Map(),
      [],
      [],
      { x: -10, y: -10, width: 30, height: 30 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).not.toContain('<pattern')
  })

  test('grid type "dots" includes pattern + background rect', async () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
    const dotted: SettingsV1 = {
      ...baseSettings,
      grid: { type: 'dots', spacing: 24 },
    }
    const blob = exportSVG(
      [s],
      [],
      new Map(),
      [],
      [],
      { x: -10, y: -10, width: 30, height: 30 },
      dotted,
    )
    const text = await blob.text()
    expect(text).toContain('<pattern')
    expect(text).toContain('id="wb-grid"')
    expect(text).toContain('fill="url(#wb-grid)"')
  })

  test('grid type "lines" includes vertical+horizontal paths', async () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
    const lines: SettingsV1 = {
      ...baseSettings,
      grid: { type: 'lines', spacing: 24 },
    }
    const blob = exportSVG(
      [s],
      [],
      new Map(),
      [],
      [],
      { x: -10, y: -10, width: 30, height: 30 },
      lines,
    )
    const text = await blob.text()
    expect(text).toContain('<pattern')
    expect(text).toContain('M 0 0 L 24 0 M 0 0 L 0 24')
  })

  test('stroke path uses quadratic curves (Q) to match canvas hull', async () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ])
    const blob = exportSVG(
      [s],
      [],
      new Map(),
      [],
      [],
      { x: -10, y: -10, width: 40, height: 40 },
      baseSettings,
    )
    const text = await blob.text()
    // SVG `Q` quadratic-curve command — matches the canvas
    // `quadraticCurveTo(x0, y0, midX, midY)` hull in stroke.ts. Was a
    // straight-line `L` polyline pre-#10, producing sharp corners.
    expect(text).toMatch(/<path d="M[^"]* Q /)
  })

  test('deleted strokes are excluded', async () => {
    const s = mkStroke(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      { deleted: true },
    )
    const blob = exportSVG(
      [s],
      [],
      new Map(),
      [],
      [],
      { x: -10, y: -10, width: 30, height: 30 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).not.toContain('<path')
  })

  test('images are serialized correctly with data URIs', async () => {
    const img = mkImage('img1', 0, 0, 100, 100)
    const uris = new Map([['img1', 'data:image/png;base64,abc']])
    const blob = exportSVG(
      [],
      [img],
      uris,
      [],
      [],
      { x: -10, y: -10, width: 120, height: 120 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).toContain('<image')
    expect(text).toContain('href="data:image/png;base64,abc"')
    expect(text).toContain('width="100.00"')
    expect(text).toContain('height="100.00"')
  })

  test('rotated images include rotation transform', async () => {
    const img = mkImage('img1', 0, 0, 100, 100, { rotation: Math.PI / 2 })
    const uris = new Map([['img1', 'data:image/png;base64,abc']])
    const blob = exportSVG(
      [],
      [img],
      uris,
      [],
      [],
      { x: -10, y: -10, width: 120, height: 120 },
      baseSettings,
    )
    const text = await blob.text()
    // PI / 2 is 90 degrees. Center of {0,0,100,100} is 50,50
    expect(text).toContain('transform="rotate(90.00 50.00 50.00)"')
  })

  test('texts are serialized correctly with tspans', async () => {
    const t = mkText('hello\nworld', 10, 10, 50, 30)
    const blob = exportSVG(
      [],
      [],
      new Map(),
      [t],
      [],
      { x: 0, y: 0, width: 100, height: 100 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).toContain('<text')
    expect(text).toContain('<tspan x="16.00" y="14.00" dominant-baseline="hanging">hello</tspan>')
    expect(text).toContain('<tspan x="16.00" y="29.00" dominant-baseline="hanging">world</tspan>')
  })

  test('texts decoration and style attributes are preserved', async () => {
    const t = mkText('bold-italic-underline', 0, 0, 100, 30, {
      font: { family: 'sans', size: 16, bold: true, italic: true, underline: true },
    })
    const blob = exportSVG(
      [],
      [],
      new Map(),
      [t],
      [],
      { x: 0, y: 0, width: 100, height: 100 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).toContain('font-style="italic"')
    expect(text).toContain('font-weight="700"')
    expect(text).toContain('text-decoration="underline"')
    expect(text).toContain('font-family="ui-sans-serif')
  })

  test('shapes rect serialization is correct', async () => {
    const r = mkShape('rect', 10, 20, 30, 40, { fill: 'ink', fillOpacity: 0.5 })
    const blob = exportSVG(
      [],
      [],
      new Map(),
      [],
      [r],
      { x: 0, y: 0, width: 100, height: 100 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).toContain('<rect x="10.00" y="20.00" width="30.00" height="40.00"')
    expect(text).toContain('fill-opacity="0.50"')
  })

  test('shapes ellipse serialization is correct', async () => {
    const e = mkShape('ellipse', 10, 20, 30, 40)
    const blob = exportSVG(
      [],
      [],
      new Map(),
      [],
      [e],
      { x: 0, y: 0, width: 100, height: 100 },
      baseSettings,
    )
    const text = await blob.text()
    // center: { 10 + 15, 20 + 20 } = { 25, 40 }. radii: rx = 15, ry = 20.
    expect(text).toContain('<ellipse cx="25.00" cy="40.00" rx="15.00" ry="20.00"')
  })

  test('shapes line serialization is correct', async () => {
    const l = mkShape('line', 10, 20, 30, 40)
    const blob = exportSVG(
      [],
      [],
      new Map(),
      [],
      [l],
      { x: 0, y: 0, width: 100, height: 100 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).toContain('<line x1="10.00" y1="20.00" x2="40.00" y2="60.00"')
  })

  test('shapes arrow serialization is correct', async () => {
    const a = mkShape('arrow', 10, 20, 30, 40)
    const blob = exportSVG(
      [],
      [],
      new Map(),
      [],
      [a],
      { x: 0, y: 0, width: 100, height: 100 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).toContain('<line x1="10.00" y1="20.00" x2="40.00" y2="60.00"')
    expect(text).toContain('<polyline points=')
  })

  test('hostile brush.color is escaped — no attribute breakout in export (H1)', async () => {
    // Attribute-breakout payload: if interpolated raw it would close the
    // fill attribute, terminate the <path>, and inject a <script> that
    // executes when the exported SVG is opened standalone.
    const payload = 'red"/><script>alert(1)</script><path d="'
    const hostile = mkStroke(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      {
        id: 'hostile',
        brush: {
          size: 3,
          color: payload,
          thinning: 0.6,
          smoothing: 0.7,
          streamline: 0.4,
          taperStart: 0,
          taperEnd: 0,
          capStart: true,
          capEnd: true,
          pressureGamma: 1.5,
          opacity: 0.94,
        },
      },
    )
    // A legit hex stroke in the same export proves escaping is identity
    // for real colors (escapeAttr touches only & " < — hex has none).
    const legit = mkStroke(
      [
        { x: 20, y: 20 },
        { x: 30, y: 30 },
      ],
      { id: 'legit' },
    )
    const blob = exportSVG(
      [hostile, legit],
      [],
      new Map(),
      [],
      [],
      { x: 0, y: 0, width: 100, height: 100 },
      baseSettings,
    )
    const text = await blob.text()
    expect(text).not.toContain('<script')
    expect(text).not.toContain('"><')
    // The payload survives only in escaped form inside the attribute.
    expect(text).toContain('fill="red&quot;')
    // Legit hex color is byte-identical.
    expect(text).toContain('fill="#ef4444"')
  })
})
