/** Control characters the database puts around matches. The query replaces them in the text itself. */
export const markStart = '\u0001'
export const markEnd = '\u0002'

/** How far a cut at the edge of the window may reach back to find the end of a word. */
const wordEdge = 20

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

export interface Window {
  /** The window was cut off from text before it. */
  before: boolean
  /** The window was cut off from text after it. */
  after: boolean
}

/**
 * Turns a window of an entry's text and the database's highlighted version of it into a short HTML
 * snippet where only `<mark>` is markup. The database highlights the accent-free text, so the marks
 * are moved onto the original text when both have the same length.
 */
export function buildSnippet(text: string, highlighted: string, cut: Window): string {
  const { plain, spans } = readMarks(highlighted)
  const source = plain.length === text.length ? text : plain
  const firstBreak = cut.before ? source.slice(0, wordEdge).search(/\s/) : -1
  const from = firstBreak >= 0 ? firstBreak + 1 : 0
  const tail = Math.max(0, source.length - wordEdge)
  const lastBreak = cut.after ? source.slice(tail).search(/\s\S*$/) : -1
  const to = lastBreak >= 0 ? tail + lastBreak : source.length

  let html = ''
  let cursor = from
  for (const span of spans) {
    if (span.start >= to) break
    if (span.end <= cursor) continue
    const start = Math.max(span.start, cursor)
    html += escapeHtml(source.slice(cursor, start))
    html += `<mark>${escapeHtml(source.slice(start, Math.min(span.end, to)))}</mark>`
    cursor = Math.min(span.end, to)
  }
  html += escapeHtml(source.slice(cursor, to))

  return `${cut.before ? '…' : ''}${html.replace(/\s+/g, ' ').trim()}${cut.after ? '…' : ''}`
}
