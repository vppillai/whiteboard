import { describe, expect, test } from 'bun:test'
import { createWarnAndContinuePersist } from './persist-callbacks'

describe('persist-callbacks', () => {
  test('calls writer with payload', async () => {
    const seen: string[] = []
    const persist = createWarnAndContinuePersist<string>(
      async (v) => {
        seen.push(v)
      },
      'msg',
      () => {},
    )
    persist('a')
    await Promise.resolve()
    expect(seen).toEqual(['a'])
  })

  test('logs on rejected persistence', async () => {
    const logs: Array<{ msg: string; err: unknown }> = []
    const persist = createWarnAndContinuePersist<string>(
      async () => {
        throw new Error('boom')
      },
      'whiteboard/web: failed to persist thing:',
      (msg, err) => {
        logs.push({ msg, err })
      },
    )
    persist('a')
    await Promise.resolve()
    await Promise.resolve()
    expect(logs).toHaveLength(1)
    expect(logs[0]?.msg).toBe('whiteboard/web: failed to persist thing:')
  })

  test('does not log when writer succeeds', async () => {
    let logged = false
    const persist = createWarnAndContinuePersist<string>(
      async () => {},
      'msg',
      () => {
        logged = true
      },
    )
    persist('a')
    await Promise.resolve()
    expect(logged).toBe(false)
  })
})
