import { describe, expect, test } from 'bun:test'
import { _shouldPushStrokeTransformManyItem } from './select'

describe('select transform-many stroke commit guard', () => {
  test('false when net drag delta is zero', () => {
    expect(_shouldPushStrokeTransformManyItem(undefined, 0, 0)).toBe(false)
    expect(_shouldPushStrokeTransformManyItem({ id: 's1' }, 0, 0)).toBe(false)
  })

  test('false when stroke is missing or deleted', () => {
    expect(_shouldPushStrokeTransformManyItem(undefined, 4, 2)).toBe(false)
    expect(_shouldPushStrokeTransformManyItem({ id: 's1', deleted: true }, 4, 2)).toBe(false)
  })

  test('true only for live stroke with non-zero delta', () => {
    expect(_shouldPushStrokeTransformManyItem({ id: 's1' }, 4, 2)).toBe(true)
  })
})
