/** Control characters the database puts around matches. The query replaces them in the text itself. */
export const markStart = '\u0001'
export const markEnd = '\u0002'

const contextBefore = 70
const contextAfter = 160

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => escapes[char] ?? char)

interface Span {
  start: number
  end: number
}

function readMarks(highlighted: string) {
  let plain = ''
  const spans: Span[] = []
  let open = -1
  for (const char of highlighted) {
    if (char === markStart) open = plain.length
    else if (char === markEnd) {
      if (open >= 0) spans.push({ start: open, end: plain.length })
      open = -1
    } else plain += char
  }
  return { plain, spans }
}

/**
 * Turns the database's highlighted text into a short HTML snippet where only `<mark>` is markup.
 * The database highlights the accent-free text, so the marks are moved onto the original text when
 * both have the same length.
 */
export function buildSnippet(text: string, highlighted: string): string {
  const { plain, spans } = readMarks(highlighted)
  const source = plain.length === text.length ? text : plain
  const first = spans[0]
  const from = first ? Math.max(0, first.start - contextBefore) : 0
  const to = Math.min(source.length, (first ? first.end : 0) + contextAfter)

  let html = ''
  let cursor = from
  for (const span of spans) {
    if (span.start >= to) break
    if (span.end <= cursor) continue
    html += escapeHtml(source.slice(cursor, span.start))
    html += `<mark>${escapeHtml(source.slice(span.start, Math.min(span.end, to)))}</mark>`
    cursor = Math.min(span.end, to)
  }
  html += escapeHtml(source.slice(cursor, to))

  const flattened = html.replace(/\s+/g, ' ').trim()
  return `${from > 0 ? '…' : ''}${flattened}${to < source.length ? '…' : ''}`
}
