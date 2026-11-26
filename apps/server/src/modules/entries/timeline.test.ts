import { describe, expect, it } from 'vitest'
import { badgeFor, buildExcerpt, decodeCursor, encodeCursor } from './timeline.ts'

describe('004-timeline: excerpt, badge and cursor helpers', () => {
  it('AC-3: the excerpt is the body text with Markdown stripped', () => {
    const body =
      '# Title\n\nSome **bold** and _soft_ words with a [link](https://example.test).\n\n- one\n- two\n\n> quoted\n\n`code` ![alt text](x.png)'
    expect(buildExcerpt(body, null)).toBe(
      'Title Some bold and soft words with a link. one two quoted code alt text',
    )
  })

  it('AC-3: with no body text the excerpt is the first finished transcript', () => {
    expect(buildExcerpt('  \n ', 'First   words\nof the day')).toBe('First words of the day')
  })

  it('AC-3: with neither the excerpt is empty so the card can say there is no text', () => {
    expect(buildExcerpt('', null)).toBeNull()
    expect(buildExcerpt('', '   ')).toBeNull()
  })

  it('AC-3: a long excerpt is cut', () => {
    expect(buildExcerpt('word '.repeat(200), null)?.length).toBe(300)
  })

  it('AC-4: the badge follows failed, then working, then off, then nothing', () => {
    expect(badgeFor(['done', 'failed', 'pending'])).toBe('failed')
    expect(badgeFor(['done', 'skipped', 'transcribing'])).toBe('working')
    expect(badgeFor(['pending', 'skipped'])).toBe('working')
    expect(badgeFor(['done', 'skipped'])).toBe('off')
    expect(badgeFor(['done', 'done'])).toBeNull()
    expect(badgeFor([])).toBeNull()
  })

  it('AC-5: a cursor round-trips and garbage is rejected', () => {
    const position = {
      entryDate: '2026-11-26',
      createdAt: '2026-11-26 20:30:00.123456+00',
      id: '6f1c2f0e-5d5c-4a5e-9d3c-0b7e0f2f9a11',
    }
    expect(decodeCursor(encodeCursor(position))).toEqual(position)
    expect(decodeCursor('not a cursor')).toBeNull()
    expect(decodeCursor(Buffer.from('["2026-13-40","x","y"]').toString('base64url'))).toBeNull()
    expect(decodeCursor(Buffer.from('{"a":1}').toString('base64url'))).toBeNull()
  })
})
