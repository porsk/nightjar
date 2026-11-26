import { micromark } from 'micromark'

/**
 * Markdown to HTML. micromark escapes raw HTML and drops unsafe link protocols unless told otherwise,
 * so the text of an entry can never bring its own markup. Every link it makes gets a rel.
 */
export function renderMarkdown(source: string): string {
  return micromark(source).replaceAll('<a href="', '<a rel="noopener noreferrer" href="')
}
