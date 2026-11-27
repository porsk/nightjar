import { describe, expect, it } from 'vitest'
import { buildSnippet } from './snippet.ts'

const accents: Record<string, string> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ö: 'o',
  ő: 'o',
  ú: 'u',
  ü: 'u',
  ű: 'u',
  ß: 'ss',
  æ: 'ae',
}

/** What the database returns for each character: lower case and without accents. */
const normalize = (text: string) =>
  Array.from(text).map((char) => {
    const lower = char.toLowerCase()
    return accents[lower] ?? lower
  })

const whole = { before: false, after: false }
const snippet = (text: string, words: string[], cut = whole) =>
  buildSnippet(text, normalize(text), words, cut)

describe('005-search: snippets', () => {
  it('AC-6: wraps the matched words in <mark> and escapes everything else', () => {
    expect(snippet('Went to <img src=x onerror=alert(1)> for the move & more', ['move'])).toBe(
      'Went to &lt;img src=x onerror=alert(1)&gt; for the <mark>move</mark> &amp; more',
    )
  })

  it('AC-6: escapes a match that itself looks like markup', () => {
    expect(snippet('<script>alert(1)</script>', ['<script>'])).toBe(
      '<mark>&lt;script&gt;</mark>alert(1)&lt;/script&gt;',
    )
  })

  it('AC-2: keeps the accents of the original while the match was found without them', () => {
    expect(snippet('A költözésről beszéltünk', ['koltozes'])).toBe(
      'A <mark>költözés</mark>ről beszéltünk',
    )
  })

  it('AC-15: marks every occurrence, also inside a longer word', () => {
    expect(snippet('Hello, ez egy első bejegyzés.', ['egy'])).toBe(
      'Hello, ez <mark>egy</mark> első bej<mark>egy</mark>zés.',
    )
  })

  it('AC-15: shows the accents as written on a match typed without them', () => {
    expect(snippet('Hello, ez egy első bejegyzés.', ['elso'])).toBe(
      'Hello, ez egy <mark>első</mark> bejegyzés.',
    )
  })

  it('AC-15: maps matches back when the accent-free form is longer than the original', () => {
    expect(snippet('Die Straße und Æther in der Straße', ['strasse', 'aether'])).toBe(
      'Die <mark>Straße</mark> und <mark>Æther</mark> in der <mark>Straße</mark>',
    )
    expect(snippet('Straße', ['sse'])).toBe('Stra<mark>ße</mark>')
  })

  it('AC-15: counts characters outside the basic plane as one', () => {
    expect(snippet('😀 éjjel 😀 jel', ['jel'])).toBe('😀 éj<mark>jel</mark> 😀 <mark>jel</mark>')
  })

  it('AC-16: marks every word and merges overlapping matches', () => {
    expect(snippet('Alpha in the text, omega in the voice', ['omega', 'alpha'])).toBe(
      '<mark>Alpha</mark> in the text, <mark>omega</mark> in the voice',
    )
    expect(snippet('walking', ['walk', 'king'])).toBe('<mark>walking</mark>')
  })

  it('AC-6: a cut window gets ellipses and loses the words that were cut in half', () => {
    expect(
      snippet('ndowed words around the needle and then some mo', ['needle'], {
        before: true,
        after: true,
      }),
    ).toBe('…words around the <mark>needle</mark> and then some…')
  })

  it('AC-6: shows the text as it is when nothing is marked and flattens line breaks', () => {
    expect(snippet('first line\nsecond <b>line</b>', ['nothing'])).toBe(
      'first line second &lt;b&gt;line&lt;/b&gt;',
    )
  })
})
