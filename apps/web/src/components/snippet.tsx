import { Fragment } from 'react'

const entities: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

const unescape = (text: string) =>
  text.replace(/&(?:amp|lt|gt|quot|#39);/g, (it) => entities[it] ?? it)

/** Shows a server snippet, escaped HTML where only `<mark>` is markup, as text and highlight elements. */
export function Snippet({ html }: { html: string }) {
  return (
    <>
      {html
        .split(/(<mark>.*?<\/mark>)/s)
        .map((part, index) =>
          part.startsWith('<mark>') && part.endsWith('</mark>') ? (
            <mark key={index}>{unescape(part.slice(6, -7))}</mark>
          ) : (
            <Fragment key={index}>{unescape(part)}</Fragment>
          ),
        )}
    </>
  )
}
