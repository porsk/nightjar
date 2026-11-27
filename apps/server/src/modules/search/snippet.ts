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

/**
 * Finds every word in the normalized copy of the text and returns the matches as ranges of the original
 * text (UTF-16 offsets). `normalized[i]` is the normalized form of the i-th character of `text`; it can
 * be longer or shorter than the character itself (ß becomes ss), so a match is mapped back character by
 * character and covers every original character it touches.
 */
function findSpans(text: string, normalized: readonly string[], words: readonly string[]): Span[] {
  const chars = Array.from(text)
  const offsets: number[] = []
  let offset = 0
  for (const char of chars) {
    offsets.push(offset)
    offset += char.length
  }
  offsets.push(offset)

  let flat = ''
  const owner: number[] = []
  chars.forEach((char, at) => {
    const form = normalized[at] ?? char.toLowerCase()
    flat += form
    for (let unit = 0; unit < form.length; unit += 1) owner.push(at)
  })

  const found: Span[] = []
  for (const word of words) {
    if (word === '') continue
    for (let at = flat.indexOf(word); at >= 0; at = flat.indexOf(word, at + 1)) {
      const first = owner[at]
      const last = owner[at + word.length - 1]
      if (first === undefined || last === undefined) continue
      found.push({ start: offsets[first] ?? 0, end: offsets[last + 1] ?? text.length })
    }
  }

  found.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Span[] = []
  for (const span of found) {
    const previous = merged[merged.length - 1]
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}

export interface Window {
  /** The window was cut off from text before it. */
  before: boolean
  /** The window was cut off from text after it. */
  after: boolean
}

/**
 * Turns a window of an entry's text into a short HTML snippet where only `<mark>` is markup. The marks
 * go on the original characters, found through `normalized` (the lower-case, accent-free form of each
 * character) and the normalized search words.
 */
export function buildSnippet(
  text: string,
  normalized: readonly string[],
  words: readonly string[],
  cut: Window,
): string {
  const spans = findSpans(text, normalized, words)
  const firstBreak = cut.before ? text.slice(0, wordEdge).search(/\s/) : -1
  const from = firstBreak >= 0 ? firstBreak + 1 : 0
  const tail = Math.max(0, text.length - wordEdge)
  const lastBreak = cut.after ? text.slice(tail).search(/\s\S*$/) : -1
  const to = lastBreak >= 0 ? tail + lastBreak : text.length

  let html = ''
  let cursor = from
  for (const span of spans) {
    if (span.start >= to) break
    if (span.end <= cursor) continue
    const start = Math.max(span.start, cursor)
    html += escapeHtml(text.slice(cursor, start))
    html += `<mark>${escapeHtml(text.slice(start, Math.min(span.end, to)))}</mark>`
    cursor = Math.min(span.end, to)
  }
  html += escapeHtml(text.slice(cursor, to))

  return `${cut.before ? '…' : ''}${html.replace(/\s+/g, ' ').trim()}${cut.after ? '…' : ''}`
}
