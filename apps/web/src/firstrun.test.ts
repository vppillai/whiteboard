import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type FirstRunStorage,
  __resetForTesting,
  dismissFirstRunHint,
  shouldShowHint,
} from './firstrun'

class FakeStorage implements FirstRunStorage {
  private val: string | null = null
  get(): string | null {
    return this.val
  }
  set(value: string): void {
    this.val = value
  }
}

describe('firstrun: shouldShowHint', () => {
  test('returns true when flag is absent', () => {
    const storage = new FakeStorage()
    expect(shouldShowHint(storage)).toBe(true)
  })

  test('returns false when flag is set', () => {
    const storage = new FakeStorage()
    storage.set('true')
    expect(shouldShowHint(storage)).toBe(false)
  })

  test('returns true for any non-"true" value', () => {
    const storage = new FakeStorage()
    storage.set('false')
    expect(shouldShowHint(storage)).toBe(true)
    storage.set('1')
    expect(shouldShowHint(storage)).toBe(true)
  })
})

describe('firstrun: dismissFirstRunHint', () => {
  beforeEach(() => {
    __resetForTesting()
  })

  test('sets storage flag to "true"', () => {
    const storage = new FakeStorage()
    dismissFirstRunHint(storage)
    expect(storage.get()).toBe('true')
  })

  test('is idempotent: second call does not re-set storage', () => {
    const storage = new FakeStorage()
    dismissFirstRunHint(storage)
    let writes = 0
    const counting: FirstRunStorage = {
      get: () => storage.get(),
      set: (v) => {
        writes++
        storage.set(v)
      },
    }
    dismissFirstRunHint(counting)
    expect(writes).toBe(0)
  })

  test('does not throw when no element was mounted', () => {
    const storage = new FakeStorage()
    expect(() => dismissFirstRunHint(storage)).not.toThrow()
  })
})
