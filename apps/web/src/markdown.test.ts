import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown.ts'

const parse = (markdown: string) => {
  const template = document.createElement('template')
  template.innerHTML = renderMarkdown(markdown)
  return template.content
}

const tagsIn = (markdown: string) =>
  [...parse(markdown).querySelectorAll('*')].map((element) => element.tagName.toLowerCase())

describe('002-text-entries: markdown renderer', () => {
  it('AC-4: renders bold, lists and links', () => {
    const content = parse('**bold**\n\n- one\n- two\n\n[site](https://example.test)')
    expect(content.querySelector('strong')?.textContent).toBe('bold')
    expect(content.querySelectorAll('ul > li')).toHaveLength(2)
    const link = content.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.test')
  })

  it('AC-4: every link gets rel="noopener noreferrer"', () => {
    const links = [...parse('[a](https://a.test) and <https://b.test>').querySelectorAll('a')]
    expect(links).toHaveLength(2)
    for (const link of links) expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  const xssStrings = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">click</a>',
    '<body onload=alert(1)>',
    '<details open ontoggle=alert(1)>',
    '"><script>alert(document.cookie)</script>',
    '<style>@import "https://evil.test/x.css"</style>',
  ]

  for (const attack of xssStrings) {
    it(`AC-4: shows raw HTML as text: ${attack}`, () => {
      const html = renderMarkdown(attack)
      const tags = tagsIn(attack)
      expect(tags.every((tag) => ['p', 'blockquote'].includes(tag))).toBe(true)
      expect(html).not.toMatch(/<(script|img|svg|iframe|a|body|details|style)[\s/>]/i)
      expect(parse(attack).textContent).toContain(attack)
    })
  }

  it('AC-4: javascript: links lose their href', () => {
    const link = parse('[x](javascript:alert(1))').querySelector('a')
    expect(link?.getAttribute('href') ?? '').not.toMatch(/javascript/i)
  })

  it('AC-4: markup inside inline code and links is text too', () => {
    const content = parse('`<b>x</b>` and [<i>y</i>](https://a.test)')
    expect(content.querySelector('b')).toBeNull()
    expect(content.querySelector('i')).toBeNull()
  })
})
