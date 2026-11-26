import { entryDateSchema, type TimelineBadge } from '@nightjar/shared'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { z } from 'zod'

const excerptLength = 300

interface MarkdownNode {
  type: string
  value?: string
  alt?: string | null
  children?: MarkdownNode[]
}

const blockTypes = new Set(['paragraph', 'heading', 'code', 'listItem', 'thematicBreak', 'break'])

function collectText(node: MarkdownNode, parts: string[]) {
  if (node.type === 'html') return
  if (node.type === 'image') parts.push(node.alt ?? '')
  else if (node.value !== undefined) parts.push(node.value)
  for (const child of node.children ?? []) collectText(child, parts)
  if (blockTypes.has(node.type)) parts.push(' ')
}

const tidy = (text: string) =>
  Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, excerptLength).join('')

/** What a card shows: the body without Markdown, else the first finished transcript, else nothing. */
export function buildExcerpt(bodyMd: string, transcript: string | null): string | null {
  const parts: string[] = []
  collectText(fromMarkdown(bodyMd), parts)
  const fromBody = tidy(parts.join(''))
  if (fromBody !== '') return fromBody
  const fromTranscript = tidy(transcript ?? '')
  return fromTranscript === '' ? null : fromTranscript
}

/** The one badge a card shows for the statuses of its recordings. */
export function badgeFor(statuses: string[]): TimelineBadge | null {
  if (statuses.includes('failed')) return 'failed'
  if (statuses.includes('pending') || statuses.includes('transcribing')) return 'working'
  if (statuses.includes('skipped')) return 'off'
  return null
}

const cursorSchema = z.tuple([
  entryDateSchema,
  z.string().regex(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?[+-]\d\d(:\d\d)?$/),
  z.uuid(),
])

export interface TimelinePosition {
  entryDate: string
  /** Postgres text form of `created_at`, which keeps the microseconds a JS Date would drop. */
  createdAt: string
  id: string
}

export const encodeCursor = ({ entryDate, createdAt, id }: TimelinePosition) =>
  Buffer.from(JSON.stringify([entryDate, createdAt, id])).toString('base64url')

export function decodeCursor(cursor: string): TimelinePosition | null {
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString()))
    if (!parsed.success) return null
    const [entryDate, createdAt, id] = parsed.data
    return { entryDate, createdAt, id }
  } catch {
    return null
  }
}
