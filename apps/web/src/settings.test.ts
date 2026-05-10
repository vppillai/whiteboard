import { describe, expect, test } from 'bun:test'
import { beforeEach } from 'bun:test'
import {
  __resetForTesting,
  addCustomSwatch,
  getSettings,
  pushRecentColor,
  removeCustomSwatch,
} from './settings'
import { getEffectiveBrushConfig, migrate } from './settings'

beforeEach(__resetForTesting)

describe('settings: migrate', () => {
  test('v0 with all fields migrates to v1 preserving values', () => {
    const v0 = {
      color: '#ef4444',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
    }
    const v1 = migrate(v0)
    expect(v1.schemaVersion).toBe(1)
    expect(v1.color).toBe('#ef4444')
    expect(v1.brush).toBe('pen')
    expect(v1.eraserSize).toBe('medium')
    expect(v1.grid).toEqual({ type: 'dots', spacing: 24 })
    expect(v1.presets).toEqual({})
    expect(v1.customSwatches).toEqual([])
    expect(v1.recentColors).toEqual([])
    expect(v1.fonts).toEqual([])
  })
})

describe('settings: migrate edge cases', () => {
  test('null input returns DEFAULTS shape', () => {
    const v1 = migrate(null)
    expect(v1.schemaVersion).toBe(1)
    expect(v1.color).toBe('ink')
    expect(v1.brush).toBe('pen')
  })

  test('empty object returns DEFAULTS', () => {
    const v1 = migrate({})
    expect(v1.color).toBe('ink')
    expect(v1.presets).toEqual({})
  })

  test('partial v1 fills missing fields with defaults', () => {
    const partial = {
      schemaVersion: 1,
      color: '#22c55e',
      brush: 'marker',
      eraserSize: 'large',
      grid: { type: 'dots', spacing: 24 },
      presets: {},
    }
    const v1 = migrate(partial)
    expect(v1.color).toBe('#22c55e')
    expect(v1.customSwatches).toEqual([])
    expect(v1.recentColors).toEqual([])
    expect(v1.fonts).toEqual([])
  })

  test('type-mismatched eraserSize falls back to default; rest preserved', () => {
    const v0 = {
      color: '#3b82f6',
      brush: 'pencil',
      eraserSize: 42,
      grid: { type: 'lines', spacing: 32 },
    }
    const v1 = migrate(v0)
    expect(v1.eraserSize).toBe('medium')
    expect(v1.color).toBe('#3b82f6')
    expect(v1.grid.spacing).toBe(32)
  })

  test('idempotent on v1 input', () => {
    const v1in = migrate({
      color: '#a855f7',
      brush: 'brush',
      eraserSize: 'small',
      grid: { type: 'ruled', spacing: 48 },
    })
    const v1out = migrate(v1in)
    expect(v1out).toEqual(v1in)
  })

  test('invalid hex strings filtered from customSwatches', () => {
    const v1 = migrate({
      schemaVersion: 1,
      color: 'ink',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {},
      customSwatches: ['#abcdef', 'not-a-hex', '#GGG', '#123456'],
      recentColors: [],
      fonts: [],
    })
    expect(v1.customSwatches).toEqual(['#abcdef', '#123456'])
  })

  test('recentColors capped at 6', () => {
    const tenColors = [
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
      '#888888',
      '#999999',
      '#aaaaaa',
    ]
    const v1 = migrate({
      schemaVersion: 1,
      color: 'ink',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {},
      customSwatches: [],
      recentColors: tenColors,
      fonts: [],
    })
    expect(v1.recentColors).toHaveLength(6)
    expect(v1.recentColors[0]).toBe('#111111')
  })
})

describe('settings: getEffectiveBrushConfig', () => {
  test('empty override returns SPEC default with color', () => {
    const cfg = getEffectiveBrushConfig('pen', '#ef4444')
    expect(cfg.size).toBe(3.5) // pen SPEC default
    expect(cfg.opacity).toBe(0.94)
    expect(cfg.pressureGamma).toBe(1.3)
    expect(cfg.color).toBe('#ef4444')
  })

  test('does not throw when no override is set', () => {
    expect(() => getEffectiveBrushConfig('marker', 'ink')).not.toThrow()
  })
})

describe('settings: customSwatches', () => {
  test('add appends, no duplicates', () => {
    addCustomSwatch('#fbcfe8')
    addCustomSwatch('#fbcfe8') // duplicate
    expect(getSettings().customSwatches).toEqual(['#fbcfe8'])
    addCustomSwatch('#7dd3fc')
    expect(getSettings().customSwatches).toEqual(['#fbcfe8', '#7dd3fc'])
  })

  test('remove drops the matching hex', () => {
    addCustomSwatch('#aabbcc')
    addCustomSwatch('#ddeeff')
    removeCustomSwatch('#aabbcc')
    expect(getSettings().customSwatches).toEqual(['#ddeeff'])
  })

  test('removing nonexistent is a no-op', () => {
    expect(() => removeCustomSwatch('#nonexistent')).not.toThrow()
  })

  test('invalid hex is rejected (no add)', () => {
    addCustomSwatch('not-a-hex')
    expect(getSettings().customSwatches).toEqual([])
  })
})

describe('settings: recentColors', () => {
  test('push prepends and dedupes', () => {
    pushRecentColor('#111111')
    pushRecentColor('#222222')
    expect(getSettings().recentColors.slice(0, 2)).toEqual(['#222222', '#111111'])
    pushRecentColor('#111111') // moves to front
    expect(getSettings().recentColors[0]).toBe('#111111')
  })

  test('caps at 6', () => {
    const colors = ['#a1a1a1', '#a2a2a2', '#a3a3a3', '#a4a4a4', '#a5a5a5', '#a6a6a6', '#a7a7a7']
    for (const c of colors) pushRecentColor(c)
    expect(getSettings().recentColors).toHaveLength(6)
    expect(getSettings().recentColors[0]).toBe('#a7a7a7') // most recent first
  })

  test('ink token is not pushed', () => {
    pushRecentColor('ink')
    expect(getSettings().recentColors.includes('ink')).toBe(false)
  })
})
