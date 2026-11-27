import { describe, expect, it } from 'vitest'
import { wordErrorRate } from './support/wer.ts'

describe('003-voice-entries: word error rate helper', () => {
  it('AC-29: identical text has no errors, ignoring case and punctuation', () => {
    expect(
      wordErrorRate('Swirl the powders, then squeeze.', 'swirl the powders then squeeze'),
    ).toBe(0)
  })

  it('AC-29: counts substitutions, deletions and insertions against the reference length', () => {
    expect(wordErrorRate('one two three four', 'one too three four')).toBe(0.25)
    expect(wordErrorRate('one two three four', 'one three four')).toBe(0.25)
    expect(wordErrorRate('one two', 'one two three four')).toBe(1)
  })

  it('AC-29: a missing accent is a wrong word', () => {
    expect(wordErrorRate('bíróságon', 'biróságon')).toBe(1)
  })

  it('AC-29: an empty reference is only right when nothing was heard', () => {
    expect(wordErrorRate('', '')).toBe(0)
    expect(wordErrorRate('', 'noise')).toBe(1)
  })
})
