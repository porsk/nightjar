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

describe('003-voice-entries: i18n keys', () => {
  it('AC-28: the labels the spec names exist in Hungarian and English', () => {
    const texts = (catalogue: typeof en) => new Map(leaves(catalogue))
    const hungarian = texts(hu)
    const english = texts(en)
    const named: [string, string, string][] = [
      ['recorder.discard', 'Elvetés', 'Discard'],
      ['recorder.stop', 'Leállítás', 'Stop'],
      ['recorder.discardConfirm.title', 'Elveted a felvételt?', 'Discard the recording?'],
      ['recorder.discardConfirm.keep', 'Felvétel folytatása', 'Keep recording'],
      ['upload.submit', 'Feltöltés', 'Upload'],
      ['lang.auto', 'Automatikus', 'Automatic'],
      ['transcript.working', 'Átírás folyamatban…', 'Transcribing…'],
      ['transcript.edit', 'Átirat szerkesztése', 'Edit transcript'],
      ['transcript.failed', 'Az átírás nem sikerült.', 'Transcription failed.'],
      ['transcript.off', 'Nincs átírva.', 'Not transcribed.'],
      ['settings.model.downloading', 'Modell letöltése…', 'Downloading model…'],
      ['settings.backlog.now', 'Átírás most', 'Transcribe now'],
      [
        'error.unsupported_audio',
        'Ezt a fájlt nem tudjuk hangként kezelni.',
        "This file isn't a supported audio format.",
      ],
      [
        'error.file_too_large',
        'A fájl túl nagy (legfeljebb 200 MB).',
        'The file is too large (200 MB max).',
      ],
      ['entry.recordAnother', 'Újabb felvétel', 'Record another'],
      ['nav.newRecording', 'Új felvétel', 'New recording'],
    ]
    for (const [key, huText, enText] of named) {
      expect(hungarian.get(key), key).toBe(huText)
      expect(english.get(key), key).toBe(enText)
    }
  })
})
