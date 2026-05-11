import { describe, expect, test } from 'bun:test'
import { CURATED_COLORS, cyclePaletteIndex } from './colorpicker'

describe('colorpicker: cyclePaletteIndex', () => {
  test('returns 0 when current is not in CURATED_COLORS', () => {
    expect(cyclePaletteIndex('#unknown', 1)).toBe(0)
    expect(cyclePaletteIndex('#ffffff', -1)).toBe(0)
  })

  test('returns 0 for empty string', () => {
    expect(cyclePaletteIndex('', 1)).toBe(0)
  })

  test('forward cycle: index 0 → 1', () => {
    const first = CURATED_COLORS[0]
    expect(first).toBeDefined()
    expect(cyclePaletteIndex(first as string, 1)).toBe(1)
  })

  test('backward cycle wraps: index 0 → last', () => {
    const first = CURATED_COLORS[0]
    expect(first).toBeDefined()
    expect(cyclePaletteIndex(first as string, -1)).toBe(CURATED_COLORS.length - 1)
  })

  test('forward cycle wraps: last → 0', () => {
    const last = CURATED_COLORS[CURATED_COLORS.length - 1]
    expect(last).toBeDefined()
    expect(cyclePaletteIndex(last as string, 1)).toBe(0)
  })

  test('backward cycle: index 1 → 0', () => {
    const second = CURATED_COLORS[1]
    expect(second).toBeDefined()
    expect(cyclePaletteIndex(second as string, -1)).toBe(0)
  })

  test('curated palette has 10 entries including ink', () => {
    expect(CURATED_COLORS.length).toBe(10)
    expect(CURATED_COLORS[0]).toBe('ink')
  })
})
