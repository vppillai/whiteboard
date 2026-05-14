import { describe, expect, test } from 'bun:test'
import { _shouldUseSingleImageFastPath } from './selectionclipboard'

describe('selectionclipboard: single-image fast path gating', () => {
  test('true for single-image-only selection', () => {
    expect(
      _shouldUseSingleImageFastPath({
        imageCount: 1,
        strokeCount: 0,
        textCount: 0,
        shapeCount: 0,
      }),
    ).toBe(true)
  })

  test('false when a shape is selected alongside the image', () => {
    expect(
      _shouldUseSingleImageFastPath({
        imageCount: 1,
        strokeCount: 0,
        textCount: 0,
        shapeCount: 1,
      }),
    ).toBe(false)
  })

  test('false when selection has more than one image', () => {
    expect(
      _shouldUseSingleImageFastPath({
        imageCount: 2,
        strokeCount: 0,
        textCount: 0,
        shapeCount: 0,
      }),
    ).toBe(false)
  })
})
