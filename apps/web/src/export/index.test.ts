import { describe, expect, test } from 'bun:test'
import { makeCamera } from '../camera'
import { type ExportFormat, exportBoard } from './index'

// Dispatcher-level coverage for the error-handling added in M3 (C1). The
// renderers (png/svg/pdf) need a DOM canvas, so these tests exercise the
// pre-render branches only: a throwing accessor (error path) and an empty
// board (no-op path). Both confirm the try/catch wrapping routes each outcome
// to exactly one callback. Callback invocations are captured into arrays
// rather than reassigned `let`s — TS narrows a closure-only-assigned `let`
// back to its initializer, which would break the assertions' types.
describe('export/index: exportBoard error handling', () => {
  test('a throwing board accessor fires onError, never onSuccess', async () => {
    const successes: ExportFormat[] = []
    const errors: Array<{ fmt: ExportFormat; err: unknown }> = []
    await exportBoard('png', 'all', {
      getStrokes: () => {
        throw new Error('boom')
      },
      camera: makeCamera(),
      viewportWidth: 100,
      viewportHeight: 100,
      onSuccess: (fmt) => successes.push(fmt),
      onError: (fmt, err) => errors.push({ fmt, err }),
    })
    expect(successes).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]?.fmt).toBe('png')
    expect(errors[0]?.err).toBeInstanceOf(Error)
  })

  test('an empty board fires onEmptyBoard, never onError or onSuccess', async () => {
    const events: string[] = []
    await exportBoard('svg', 'all', {
      getStrokes: () => [],
      camera: makeCamera(),
      viewportWidth: 100,
      viewportHeight: 100,
      onEmptyBoard: () => events.push('empty'),
      onError: () => events.push('error'),
      onSuccess: () => events.push('success'),
    })
    expect(events).toEqual(['empty'])
  })
})
