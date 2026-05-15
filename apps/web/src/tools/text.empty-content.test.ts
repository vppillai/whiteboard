import { describe, expect, test } from 'bun:test'
import { _isEffectivelyEmptyTextContent } from './text'

describe('text tool empty-content guard', () => {
  test('treats blank and whitespace-only content as empty', () => {
    expect(_isEffectivelyEmptyTextContent('')).toBe(true)
    expect(_isEffectivelyEmptyTextContent('   ')).toBe(true)
    expect(_isEffectivelyEmptyTextContent('\n\t  \n')).toBe(true)
  })

  test('keeps content with visible characters', () => {
    expect(_isEffectivelyEmptyTextContent('a')).toBe(false)
    expect(_isEffectivelyEmptyTextContent('  a  ')).toBe(false)
  })
})
