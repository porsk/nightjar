import { describe, expect, it } from 'vitest'
import { en } from './en.ts'
import { hu } from './hu.ts'

const leaves = (tree: object, prefix = ''): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? leaves(value as object, `${prefix}${key}.`)
      : [[`${prefix}${key}`, String(value)] as [string, string]],
  )

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort()

describe('006-settings: i18n catalogues', () => {
  it('AC-5: has every key in both hu and en, with no empty text', () => {
    expect(leaves(en).map(([key]) => key)).toEqual(leaves(hu).map(([key]) => key))
    for (const [key, text] of [...leaves(en), ...leaves(hu)]) {
      expect(text, key).toEqual(expect.stringMatching(/\S/))
    }
  })

  it('AC-5: hu and en use the same {{placeholders}} in every key', () => {
    const huLeaves = new Map(leaves(hu))
    for (const [key, text] of leaves(en)) {
      expect(placeholders(huLeaves.get(key) ?? ''), key).toEqual(placeholders(text))
    }
  })

  it('AC-5: the settings keys from the spec exist', () => {
    const keys = leaves(en).map(([key]) => key)
    for (const key of [
      'settings.title',
      'settings.personal',
      'settings.account',
      'settings.uiLanguage',
      'settings.entryLanguage',
      'settings.entryLanguageHint',
      'settings.timeZone',
      'settings.saveFailed',
      'error.invalid_time_zone',
    ]) {
      expect(keys).toContain(key)
    }
  })
})
