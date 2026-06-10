import { describe, expect, test } from 'bun:test'
import { _cullExpired, LASER_FADE_MS, type Sample } from './laser'

/** Build a sample at timestamp `t`; positions don't matter for culling. */
function s(t: number, continueFromPrev = true): Sample {
  return { x: 0, y: 0, t, continueFromPrev }
}

describe('laser _cullExpired', () => {
  test('empty trail stays empty and reports nothing alive', () => {
    const samples: Sample[] = []
    expect(_cullExpired(samples, 1000)).toBe(false)
    expect(samples).toEqual([])
  })

  test('drops expired samples, preserves survivors in order', () => {
    const now = 10_000
    const expired1 = s(now - LASER_FADE_MS - 100)
    const expired2 = s(now - LASER_FADE_MS - 1)
    const alive1 = s(now - LASER_FADE_MS) // exactly at the fade boundary survives
    const alive2 = s(now - 50, false)
    const alive3 = s(now)
    const samples = [expired1, expired2, alive1, alive2, alive3]
    expect(_cullExpired(samples, now)).toBe(true)
    expect(samples).toEqual([alive1, alive2, alive3])
  })

  test('keeps everything when nothing has expired', () => {
    const now = 10_000
    const samples = [s(now - 10), s(now - 5), s(now)]
    const before = [...samples]
    expect(_cullExpired(samples, now)).toBe(true)
    expect(samples).toEqual(before)
  })

  test('clears the whole trail when every sample has expired', () => {
    const now = 100_000
    const samples = [s(now - LASER_FADE_MS - 500), s(now - LASER_FADE_MS - 1)]
    expect(_cullExpired(samples, now)).toBe(false)
    expect(samples).toEqual([])
  })
})
