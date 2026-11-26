import { describe, expect, it } from 'vitest'
import { en } from './en.ts'
import { hu } from './hu.ts'

const leaves = (tree: object, prefix = ''): [string, unknown][] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? leaves(value as object, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value] as [string, unknown]],
  )

describe('i18n catalogues', () => {
  it('has every key in both hu and en, with no empty text', () => {
    expect(leaves(en).map(([key]) => key)).toEqual(leaves(hu).map(([key]) => key))
    for (const [key, text] of [...leaves(en), ...leaves(hu)]) {
      expect(text, key).toEqual(expect.stringMatching(/\S/))
    }
  })
})
