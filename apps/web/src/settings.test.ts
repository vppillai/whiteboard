import { describe, expect, test } from 'bun:test'
import { migrate } from './settings'

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
