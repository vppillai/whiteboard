import { describe, expect, test } from 'bun:test'
import { rgbaToHex } from './eyedropper'

describe('eyedropper: rgbaToHex', () => {
  test('opaque red', () => {
    expect(rgbaToHex(255, 0, 0, 255)).toBe('#ff0000')
  })

  test('opaque white', () => {
    expect(rgbaToHex(255, 255, 255, 255)).toBe('#ffffff')
  })

  test('opaque black', () => {
    expect(rgbaToHex(0, 0, 0, 255)).toBe('#000000')
  })

  test('low-alpha pixel returns null', () => {
    expect(rgbaToHex(100, 100, 100, 100)).toBe(null)
  })

  test('alpha threshold at 128 (~0.5)', () => {
    // alpha 128 samples; below holds previous (handled by caller, not rgbaToHex)
    expect(rgbaToHex(100, 100, 100, 128)).toBe('#646464')
    expect(rgbaToHex(100, 100, 100, 127)).toBe(null)
  })

  test('lowercase hex output', () => {
    expect(rgbaToHex(171, 205, 239, 255)).toBe('#abcdef')
  })

  test('zero alpha returns null', () => {
    expect(rgbaToHex(255, 0, 0, 0)).toBe(null)
  })
})
