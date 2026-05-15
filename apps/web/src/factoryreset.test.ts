import { describe, expect, test } from 'bun:test'
import { _stripFactoryResetParamFromHref } from './factoryreset'

describe('factory reset URL cleanup', () => {
  test('returns null when URL has no factoryReset param', () => {
    expect(_stripFactoryResetParamFromHref('https://example.com/?predict=1#x')).toBeNull()
  })

  test('removes factoryReset while preserving other params and hash', () => {
    expect(
      _stripFactoryResetParamFromHref('https://example.com/?factoryReset=123&predict=1#perf'),
    ).toBe('/?predict=1#perf')
  })

  test('removes lone factoryReset and leaves clean path', () => {
    expect(_stripFactoryResetParamFromHref('https://example.com/?factoryReset=123')).toBe('/')
  })
})
