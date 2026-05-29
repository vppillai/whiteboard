import { beforeEach, describe, expect, test } from 'bun:test'
import {
  __resetForTesting,
  _isMissingLocalStorageError,
  addCustomSwatch,
  clearPreset,
  clearPresetCurve,
  getEffectiveBrushConfig,
  getSettings,
  getShapeColor,
  getShapeFillEnabled,
  getShapeFillOpacity,
  getShapeKind,
  getShapeStrokeWidth,
  getTextBold,
  getTextColor,
  getTextFont,
  getTextItalic,
  getTextSize,
  getTextUnderline,
  migrate,
  pushRecentColor,
  removeCustomSwatch,
  resetAll,
  setBrushId,
  setColor,
  setPresetField,
  setShapeColor,
  setShapeFillEnabled,
  setShapeFillOpacity,
  setShapeKind,
  setShapeStrokeWidth,
  setTextBold,
  setTextColor,
  setTextFont,
  setTextItalic,
  setTextSize,
  setTextUnderline,
} from './settings'

beforeEach(__resetForTesting)

describe('settings: persistence warning guard', () => {
  test('identifies missing localStorage ReferenceError', () => {
    expect(_isMissingLocalStorageError(new ReferenceError('localStorage is not defined'))).toBe(
      true,
    )
  })

  test('does not match other errors', () => {
    expect(_isMissingLocalStorageError(new Error('boom'))).toBe(false)
    expect(_isMissingLocalStorageError(new ReferenceError('something else'))).toBe(false)
  })
})

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
    })
    expect(v1.recentColors).toHaveLength(6)
    expect(v1.recentColors[0]).toBe('#111111')
  })
})

describe('settings: M1.7.1 hardening', () => {
  test('migrate(null) does not include session-only eraserMode', () => {
    const v1 = migrate(null)
    expect('eraserMode' in v1).toBe(false)
  })

  test('validateOnePreset drops bad-typed numeric fields', () => {
    const v1 = migrate({
      schemaVersion: 1,
      color: 'ink',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {
        pen: { size: 'banana', opacity: 0.5, pressureGamma: Number.NaN },
      },
      customSwatches: [],
      recentColors: [],
    })
    // size dropped (not a number); pressureGamma dropped (NaN); opacity kept.
    expect(v1.presets.pen).toEqual({ opacity: 0.5 })
  })

  test('validateOnePreset drops bad-typed boolean fields', () => {
    const v1 = migrate({
      schemaVersion: 1,
      color: 'ink',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {
        pen: { capStart: 'yes', capEnd: false, size: 5 },
      },
      customSwatches: [],
      recentColors: [],
    })
    expect(v1.presets.pen).toEqual({ capEnd: false, size: 5 })
  })

  test('validatePresets drops a preset that ends up with no valid fields', () => {
    const v1 = migrate({
      schemaVersion: 1,
      color: 'ink',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {
        pen: { junk: 1, size: 'bad' },
      },
      customSwatches: [],
      recentColors: [],
    })
    // No valid fields → preset entry omitted entirely.
    expect(v1.presets).toEqual({})
  })

  test('validatePresets drops invalid brush ids', () => {
    const v1 = migrate({
      schemaVersion: 1,
      color: 'ink',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {
        notabrush: { size: 5 },
        pen: { size: 4 },
      },
      customSwatches: [],
      recentColors: [],
    })
    expect(v1.presets).toEqual({ pen: { size: 4 } })
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

describe('settings: setPresetField / clearPreset', () => {
  test('setPresetField writes a sparse override', () => {
    setPresetField('pen', 'size', 5)
    expect(getEffectiveBrushConfig('pen', 'ink').size).toBe(5)
    expect(getEffectiveBrushConfig('pen', 'ink').opacity).toBe(0.94) // unchanged
  })

  test('clearPreset removes the override entry entirely', () => {
    setPresetField('pen', 'size', 5)
    setPresetField('pen', 'opacity', 0.5)
    clearPreset('pen')
    const cfg = getEffectiveBrushConfig('pen', 'ink')
    expect(cfg.size).toBe(3.5) // SPEC default restored
    expect(cfg.opacity).toBe(0.94)
  })

  test('clearPreset on a brush with no override is a no-op', () => {
    expect(() => clearPreset('marker')).not.toThrow()
  })
})

describe('settings: predictedEvents (M2)', () => {
  test('migrate v1-shape missing predictedEvents fills false', () => {
    const v1Missing = {
      schemaVersion: 1,
      color: '#ef4444',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {},
      customSwatches: [],
      recentColors: [],
    }
    const out = migrate(v1Missing)
    expect(out.predictedEvents).toBe(false)
  })

  test('migrate type-mismatched predictedEvents (number) falls back to false', () => {
    const v1Bad = {
      schemaVersion: 1,
      color: '#ef4444',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {},
      customSwatches: [],
      recentColors: [],
      predictedEvents: 42,
    }
    const out = migrate(v1Bad)
    expect(out.predictedEvents).toBe(false)
  })

  test('migrate well-formed predictedEvents preserved', () => {
    const v1Ok = {
      schemaVersion: 1,
      color: '#ef4444',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: {},
      customSwatches: [],
      recentColors: [],
      predictedEvents: true,
    }
    const out = migrate(v1Ok)
    expect(out.predictedEvents).toBe(true)
  })

  test('defaultV1() has predictedEvents = false', () => {
    const out = migrate(null)
    expect(out.predictedEvents).toBe(false)
  })
})

describe('settings: pressureCurve preset (M2)', () => {
  test('setPresetField accepts pressureCurve and persists', () => {
    __resetForTesting()
    setPresetField('pen', 'pressureCurve', { mid: [0.7, 0.3] })
    const eff = getEffectiveBrushConfig('pen', '#000000')
    expect(eff.pressureCurve).toEqual({ mid: [0.7, 0.3] })
  })

  test('clearPresetCurve removes only pressureCurve', () => {
    __resetForTesting()
    setPresetField('pen', 'pressureCurve', { mid: [0.7, 0.3] })
    setPresetField('pen', 'size', 5)
    clearPresetCurve('pen')
    const eff = getEffectiveBrushConfig('pen', '#000000')
    expect(eff.pressureCurve).toBeUndefined()
    expect(eff.size).toBe(5)
  })

  test('clearPresetCurve on last field GCs the preset entry', () => {
    __resetForTesting()
    setPresetField('pen', 'pressureCurve', { mid: [0.7, 0.3] })
    clearPresetCurve('pen')
    // Directly assert the preset entry was removed (spec reviewer
    // strengthening — the previous indirect check via setPresetField + read
    // could pass even with a broken GC).
    expect(getSettings().presets.pen).toBeUndefined()
    // Re-add a different field and confirm subsequent operations work.
    setPresetField('pen', 'size', 7)
    const eff = getEffectiveBrushConfig('pen', '#000000')
    expect(eff.pressureCurve).toBeUndefined()
    expect(eff.size).toBe(7)
  })

  test('validateOnePreset rejects malformed pressureCurve', () => {
    const v1 = migrate({
      schemaVersion: 1,
      color: '#ef4444',
      brush: 'pen',
      eraserSize: 'medium',
      grid: { type: 'dots', spacing: 24 },
      presets: { pen: { pressureCurve: { mid: 'banana' } } },
      customSwatches: [],
      recentColors: [],
      predictedEvents: false,
    })
    // malformed mid (string not [number,number]) → pressureCurve dropped
    expect(v1.presets.pen?.pressureCurve).toBeUndefined()
  })
})

describe('settings: resetAll', () => {
  test('wipes presets, customSwatches, recentColors, scalar settings', () => {
    setPresetField('pen', 'size', 5)
    addCustomSwatch('#fbcfe8')
    pushRecentColor('#111111')
    setColor('#22c55e')
    setBrushId('marker')
    resetAll()
    const s = getSettings()
    expect(s.presets).toEqual({})
    expect(s.customSwatches).toEqual([])
    expect(s.recentColors).toEqual([])
    expect(s.color).toBe('ink')
    expect(s.brush).toBe('pen')
    expect(s.eraserSize).toBe('medium')
    expect(s.grid).toEqual({ type: 'dots', spacing: 24 })
  })
})

describe('settings: text defaults and setters', () => {
  test('getters return default values initially', () => {
    expect(getTextFont()).toBe('mono')
    expect(getTextSize()).toBe(12)
    expect(getTextBold()).toBe(false)
    expect(getTextItalic()).toBe(false)
    expect(getTextUnderline()).toBe(false)
    expect(getTextColor()).toBe('ink')
  })

  test('setters mutate state correctly', () => {
    setTextFont('sans')
    expect(getTextFont()).toBe('sans')

    setTextSize(18)
    expect(getTextSize()).toBe(18)

    setTextBold(true)
    expect(getTextBold()).toBe(true)

    setTextItalic(true)
    expect(getTextItalic()).toBe(true)

    setTextUnderline(true)
    expect(getTextUnderline()).toBe(true)

    setTextColor('#ff0000')
    expect(getTextColor()).toBe('#ff0000')
  })
})

describe('settings: shape defaults and setters', () => {
  test('getters return default values initially', () => {
    expect(getShapeKind()).toBe('rect')
    expect(getShapeColor()).toBe('ink')
    expect(getShapeStrokeWidth()).toBe(2)
    expect(getShapeFillEnabled()).toBe(false)
    expect(getShapeFillOpacity()).toBe(0.25)
  })

  test('setters mutate state correctly', () => {
    setShapeKind('ellipse')
    expect(getShapeKind()).toBe('ellipse')

    setShapeColor('#00ff00')
    expect(getShapeColor()).toBe('#00ff00')

    setShapeStrokeWidth(4)
    expect(getShapeStrokeWidth()).toBe(4)

    setShapeFillEnabled(true)
    expect(getShapeFillEnabled()).toBe(true)
  })

  test('setShapeFillOpacity clamps opacity to [0.05, 1.0]', () => {
    setShapeFillOpacity(0.5)
    expect(getShapeFillOpacity()).toBe(0.5)

    setShapeFillOpacity(0.01) // below min
    expect(getShapeFillOpacity()).toBe(0.05)

    setShapeFillOpacity(1.5) // above max
    expect(getShapeFillOpacity()).toBe(1.0)
  })
})

describe('settings: text and shape migration rules', () => {
  test('migrate v0 or empty text settings to defaults', () => {
    const v1 = migrate({ schemaVersion: 1 })
    expect(v1.textFont).toBe('mono')
    expect(v1.textSize).toBe(12)
    expect(v1.textBold).toBe(false)
    expect(v1.textItalic).toBe(false)
    expect(v1.textUnderline).toBe(false)
    expect(v1.textColor).toBe('ink')
  })

  test('migrate text font family invalid fallback', () => {
    const v1 = migrate({ textFont: 'comic-sans' })
    expect(v1.textFont).toBe('mono')
  })

  test('migrate text font family valid preservation', () => {
    const v1 = migrate({ textFont: 'serif' })
    expect(v1.textFont).toBe('serif')
  })

  test('migrate text size invalid fallback', () => {
    const v1 = migrate({ textSize: -5 })
    expect(v1.textSize).toBe(12)
    const v2 = migrate({ textSize: 'banana' })
    expect(v2.textSize).toBe(12)
  })

  test('migrate v0 or empty shape settings to defaults', () => {
    const v1 = migrate({ schemaVersion: 1 })
    expect(v1.shapeKind).toBe('rect')
    expect(v1.shapeColor).toBe('ink')
    expect(v1.shapeStrokeWidth).toBe(2)
    expect(v1.shapeFillEnabled).toBe(false)
    expect(v1.shapeFillOpacity).toBe(0.25)
  })

  test('migrate shapeKind invalid fallback', () => {
    const v1 = migrate({ shapeKind: 'star' })
    expect(v1.shapeKind).toBe('rect')
  })

  test('migrate shapeKind valid preservation', () => {
    const v1 = migrate({ shapeKind: 'arrow' })
    expect(v1.shapeKind).toBe('arrow')
  })

  test('migrate shapeStrokeWidth invalid fallback', () => {
    const v1 = migrate({ shapeStrokeWidth: 0 })
    expect(v1.shapeStrokeWidth).toBe(2)
    const v2 = migrate({ shapeStrokeWidth: -10 })
    expect(v2.shapeStrokeWidth).toBe(2)
    const v3 = migrate({ shapeStrokeWidth: 'thick' })
    expect(v3.shapeStrokeWidth).toBe(2)
  })

  test('migrate shapeFillOpacity clamping/validation fallback', () => {
    const v1 = migrate({ shapeFillOpacity: 0.01 })
    expect(v1.shapeFillOpacity).toBe(0.25)
    const v2 = migrate({ shapeFillOpacity: 1.5 })
    expect(v2.shapeFillOpacity).toBe(0.25)
    const v3 = migrate({ shapeFillOpacity: 'semi-transparent' })
    expect(v3.shapeFillOpacity).toBe(0.25)
  })
})
