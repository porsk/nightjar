import { describe, expect, it } from 'vitest'
import { buildSnippet, markEnd, markStart } from './snippet.ts'

const mark = (word: string) => `${markStart}${word}${markEnd}`

describe('005-search: snippets', () => {
  it('AC-6: wraps the matched words in <mark> and escapes everything else', () => {
    const text = 'Went to <img src=x onerror=alert(1)> for the move & more'
    const highlighted = `Went to <img src=x onerror=alert(1)> for the ${mark('move')} & more`
    expect(buildSnippet(text, highlighted)).toBe(
      'Went to &lt;img src=x onerror=alert(1)&gt; for the <mark>move</mark> &amp; more',
    )
  })

  it('AC-6: escapes a match that itself looks like markup', () => {
    const text = '<script>alert(1)</script>'
    const highlighted = `${mark('<script>')}alert(1)</script>`
    expect(buildSnippet(text, highlighted)).toBe(
      '<mark>&lt;script&gt;</mark>alert(1)&lt;/script&gt;',
    )
  })

  it('AC-2: keeps the accents of the original while the match was found without them', () => {
    const text = 'A költözésről beszéltünk'
    const highlighted = `A ${mark('koltozesrol')} beszeltunk`
    expect(buildSnippet(text, highlighted)).toBe('A <mark>költözésről</mark> beszéltünk')
  })

  it('AC-6: shows a window around the first match with ellipses', () => {
    const before = 'word '.repeat(60)
    const after = ' tail'.repeat(80)
    const text = `${before}needle${after}`
    const snippet = buildSnippet(text, `${before}${mark('needle')}${after}`)
    expect(snippet.startsWith('…')).toBe(true)
    expect(snippet.endsWith('…')).toBe(true)
    expect(snippet).toContain('<mark>needle</mark>')
    expect(snippet.length).toBeLessThan(400)
  })

  it('AC-6: falls back to the unaccented text when the lengths differ', () => {
    const text = 'Straße move'
    const highlighted = `Strasse ${mark('move')}`
    expect(buildSnippet(text, highlighted)).toBe('Strasse <mark>move</mark>')
  })

  it('AC-6: starts at the beginning when nothing is marked and flattens line breaks', () => {
    expect(buildSnippet('first line\nsecond <b>line</b>', 'first line\nsecond <b>line</b>')).toBe(
      'first line second &lt;b&gt;line&lt;/b&gt;',
    )
  })
})
