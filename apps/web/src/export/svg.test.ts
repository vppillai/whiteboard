import { describe, expect, test } from 'bun:test'
import type { Stroke } from '@whiteboard/shared'
import type { SettingsV1 } from '../settings'
import { exportSVG } from './svg'

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
  fonts: [],
  predictedEvents: false,
}

describe('export/svg', () => {
  test('returns image/svg+xml blob', () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, baseSettings)
    expect(blob.type).toBe('image/svg+xml')
  })

  test('output contains viewBox + path element', async () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, baseSettings)
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
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, baseSettings)
    const text = await blob.text()
    expect(text).toContain('mix-blend-mode:multiply')
  })

  test('non-highlighter stroke has no blend mode', async () => {
    const s = mkStroke([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ])
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, baseSettings)
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
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, baseSettings)
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
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, baseSettings)
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
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, dotted)
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
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, lines)
    const text = await blob.text()
    expect(text).toContain('<pattern')
    expect(text).toContain('M 0 0 L 24 0 M 0 0 L 0 24')
  })

  test('deleted strokes are excluded', async () => {
    const s = mkStroke(
      [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      { deleted: true },
    )
    const blob = exportSVG([s], { x: -10, y: -10, width: 30, height: 30 }, baseSettings)
    const text = await blob.text()
    expect(text).not.toContain('<path')
  })
})
