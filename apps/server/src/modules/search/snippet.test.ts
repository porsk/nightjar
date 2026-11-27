import { describe, expect, it } from 'vitest'
import { buildSnippet, markEnd, markStart } from './snippet.ts'

const mark = (word: string) => `${markStart}${word}${markEnd}`
const whole = { before: false, after: false }

describe('005-search: snippets', () => {
  it('AC-6: wraps the matched words in <mark> and escapes everything else', () => {
    const text = 'Went to <img src=x onerror=alert(1)> for the move & more'
    const highlighted = `Went to <img src=x onerror=alert(1)> for the ${mark('move')} & more`
    expect(buildSnippet(text, highlighted, whole)).toBe(
      'Went to &lt;img src=x onerror=alert(1)&gt; for the <mark>move</mark> &amp; more',
    )
  })

  it('AC-6: escapes a match that itself looks like markup', () => {
    const text = '<script>alert(1)</script>'
    const highlighted = `${mark('<script>')}alert(1)</script>`
    expect(buildSnippet(text, highlighted, whole)).toBe(
      '<mark>&lt;script&gt;</mark>alert(1)&lt;/script&gt;',
    )
  })

  it('AC-2: keeps the accents of the original while the match was found without them', () => {
    const text = 'A költözésről beszéltünk'
    const highlighted = `A ${mark('koltozesrol')} beszeltunk`
    expect(buildSnippet(text, highlighted, whole)).toBe('A <mark>költözésről</mark> beszéltünk')
  })

  it('AC-6: a cut window gets ellipses and loses the words that were cut in half', () => {
    const text = 'ndowed words around the needle and then some mo'
    const highlighted = 'ndowed words around the ' + mark('needle') + ' and then some mo'
    expect(buildSnippet(text, highlighted, { before: true, after: true })).toBe(
      '…words around the <mark>needle</mark> and then some…',
    )
  })

  it('AC-6: falls back to the unaccented text when the lengths differ', () => {
    const text = 'Straße move'
    const highlighted = `Strasse ${mark('move')}`
    expect(buildSnippet(text, highlighted, whole)).toBe('Strasse <mark>move</mark>')
  })

  it('AC-6: shows the text as it is when nothing is marked and flattens line breaks', () => {
    expect(
      buildSnippet('first line\nsecond <b>line</b>', 'first line\nsecond <b>line</b>', whole),
    ).toBe('first line second &lt;b&gt;line&lt;/b&gt;')
  })
})
