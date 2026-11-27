import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { request as playwrightRequest } from '@playwright/test'
import { Client } from 'pg'
import { modelFiles, testModelId } from '../../apps/server/test/support/model-server.ts'
import { e2eServerFiles } from './server-files.ts'

export const password = 'correct horse battery'
export const adminUsername = 'owner'
export const adminName = 'Örs'

/** The setup code the server printed at start. It stays valid whenever the database is empty. */
export function setupCodeFromLog() {
  const match = /"setupCode":"([A-Z0-9]{8})"/.exec(readFileSync(e2eServerFiles.log, 'utf8'))
  if (!match?.[1]) throw new Error('no setup code in the server log')
  return match[1]
}

/** Back to a fresh install: no accounts, transcription off, the logged setup code valid again. */
export async function resetDatabase() {
  const client = new Client({ connectionString: readFileSync(e2eServerFiles.databaseUrl, 'utf8') })
  await client.connect()
  try {
    await client.query('truncate users cascade')
    await client.query(
      'update instance_settings set transcription_enabled = false, setup_code_hash = $1',
      [createHash('sha256').update(setupCodeFromLog()).digest('hex')],
    )
  } finally {
    await client.end()
  }
  rmSync(path.join(e2eServerFiles.dataDir, 'models'), { recursive: true, force: true })
  rmSync(path.join(e2eServerFiles.dataDir, 'media'), { recursive: true, force: true })
}

export async function readTranscriptionFlag() {
  const client = new Client({ connectionString: readFileSync(e2eServerFiles.databaseUrl, 'utf8') })
  await client.connect()
  try {
    const result = await client.query<{ transcription_enabled: boolean }>(
      'select transcription_enabled from instance_settings',
    )
    return result.rows[0]?.transcription_enabled
  } finally {
    await client.end()
  }
}

/** Creates the admin through the API with its own client, so no test client holds the session cookie. */
export async function createAdmin(
  headers: Record<string, string>,
  uiLanguage: 'hu' | 'en' = 'en',
  transcriptionEnabled = false,
) {
  const api = await playwrightRequest.newContext({
    baseURL: `http://localhost:${process.env['NIGHTJAR_E2E_WEB_PORT'] ?? ''}`,
    extraHTTPHeaders: headers,
  })
  try {
    const response = await api.post('/api/v1/setup', {
      data: {
        setupCode: setupCodeFromLog(),
        username: adminUsername,
        name: adminName,
        password,
        uiLanguage,
        timeZone: 'Europe/Budapest',
        transcriptionEnabled,
      },
    })
    if (!response.ok()) throw new Error(`setup failed with ${String(response.status())}`)
  } finally {
    await api.dispose()
  }
}

async function withDatabase<T>(run: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: readFileSync(e2eServerFiles.databaseUrl, 'utf8') })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

/** An entry of the first user, with audio files on disk and rows for them, like a voice entry. */
export async function seedEntry(options: {
  bodyMd: string
  entryDate: string
  recordingNames?: string[]
}) {
  return withDatabase(async (client) => {
    const user = await client.query<{ id: string }>('select id from users limit 1')
    const userId = user.rows[0]?.id
    if (!userId) throw new Error('no user to seed an entry for')
    const entry = await client.query<{ id: string }>(
      'insert into entries (user_id, entry_date, body_md) values ($1, $2, $3) returning id',
      [userId, options.entryDate, options.bodyMd],
    )
    const entryId = entry.rows[0]?.id
    if (!entryId) throw new Error('entry was not created')
    const keys: string[] = []
    for (const name of options.recordingNames ?? []) {
      const key = `media/${userId}/recordings/${name}.webm`
      mkdirSync(path.dirname(path.join(e2eServerFiles.dataDir, key)), { recursive: true })
      writeFileSync(path.join(e2eServerFiles.dataDir, key), 'audio')
      await client.query(
        `insert into recordings (user_id, entry_id, file_path, mime_type, size_bytes, duration_ms, language, status)
         values ($1, $2, $3, 'audio/webm', 5, 1000, 'en', 'done')`,
        [userId, entryId, key],
      )
      keys.push(key)
    }
    return { entryId, keys }
  })
}

export interface SeededRecording {
  status: 'pending' | 'transcribing' | 'done' | 'failed' | 'skipped'
  durationMs: number
  transcript?: string
}

/** An entry of the first user with a fixed creation time and recording rows, for timeline screens. */
export async function seedTimelineEntry(options: {
  bodyMd: string
  entryDate: string
  createdAt: string
  recordings?: SeededRecording[]
}) {
  return withDatabase(async (client) => {
    const user = await client.query<{ id: string }>('select id from users limit 1')
    const userId = user.rows[0]?.id
    if (!userId) throw new Error('no user to seed an entry for')
    const entry = await client.query<{ id: string }>(
      'insert into entries (user_id, entry_date, body_md, created_at) values ($1, $2, $3, $4) returning id',
      [userId, options.entryDate, options.bodyMd, options.createdAt],
    )
    const entryId = entry.rows[0]?.id
    if (!entryId) throw new Error('entry was not created')
    for (const recording of options.recordings ?? []) {
      const row = await client.query<{ id: string }>(
        `insert into recordings (user_id, entry_id, file_path, mime_type, size_bytes, duration_ms, language, status)
         values ($1, $2, $3, 'audio/webm', 5, $4, 'en', $5) returning id`,
        [
          userId,
          entryId,
          `media/${userId}/recordings/${crypto.randomUUID()}.webm`,
          recording.durationMs,
          recording.status,
        ],
      )
      if (recording.transcript !== undefined) {
        await client.query(
          `insert into transcripts (user_id, recording_id, model, language, text) values ($1, $2, 'fake', 'en', $3)`,
          [userId, row.rows[0]?.id, recording.transcript],
        )
      }
    }
    return entryId
  })
}

/** Many text entries for the first user, one per minute counting back from `latest`, numbered from 1 (oldest). */
export async function seedBulkEntries(count: number, latest: string) {
  return withDatabase(async (client) => {
    const user = await client.query<{ id: string }>('select id from users limit 1')
    const userId = user.rows[0]?.id
    if (!userId) throw new Error('no user to seed entries for')
    await client.query(
      `insert into entries (user_id, entry_date, body_md, created_at)
       select $1, ($2::timestamptz - n * interval '1 hour')::date, 'Bulk entry ' || (${String(count)} - n),
              $2::timestamptz - n * interval '1 hour'
       from generate_series(0, $3 - 1) as n`,
      [userId, latest, count],
    )
  })
}

export async function readEntries() {
  return withDatabase(async (client) => {
    const result = await client.query<{ id: string; entry_date: string; body_md: string }>(
      `select id, to_char(entry_date, 'YYYY-MM-DD') as entry_date, body_md from entries order by created_at`,
    )
    return result.rows
  })
}

export async function countRecordings() {
  return withDatabase(async (client) => {
    const result = await client.query<{ total: string }>('select count(*) as total from recordings')
    return Number(result.rows[0]?.total)
  })
}

export const fileExists = (key: string) => existsSync(path.join(e2eServerFiles.dataDir, key))

/** One client address per test. The e2e server trusts one proxy hop, so a single entry is the client. */
export const uniqueIp = () =>
  `10.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}.${String(1 + Math.floor(Math.random() * 250))}`

const fixtureFolder = path.join(import.meta.dirname, '..', 'fixtures')

/** Puts files of the right size where the model is expected, so transcription counts as ready. */
export function seedModelFiles() {
  const folder = path.join(e2eServerFiles.dataDir, 'models', testModelId)
  mkdirSync(folder, { recursive: true })
  for (const [name, data] of Object.entries(modelFiles)) {
    writeFileSync(path.join(folder, name), Buffer.alloc(data.length))
  }
}

export const modelFolderExists = () =>
  existsSync(path.join(e2eServerFiles.dataDir, 'models', testModelId, 'test-encoder.onnx'))

export async function setTranscriptionFlag(enabled: boolean) {
  await withDatabase((client) =>
    client.query('update instance_settings set transcription_enabled = $1', [enabled]),
  )
}

/** Transcription on with the model already on disk, like a server that was set up earlier. */
export async function turnTranscriptionOn() {
  seedModelFiles()
  await setTranscriptionFlag(true)
}

export async function setEntryLanguage(language: 'hu' | 'en' | 'auto') {
  await withDatabase((client) => client.query('update users set entry_language = $1', [language]))
}

/** A recording of the first user with a real audio file, in the given state. */
export async function seedRecording(options: {
  entryId: string
  status: 'pending' | 'transcribing' | 'done' | 'failed' | 'skipped'
  language?: 'hu' | 'en' | 'auto'
  transcript?: { text: string; language: 'hu' | 'en'; isUserEdited?: boolean }
  clip?: 'en-sample.wav' | 'hu-sample.wav'
}) {
  return withDatabase(async (client) => {
    const user = await client.query<{ id: string }>('select id from users limit 1')
    const userId = user.rows[0]?.id
    if (!userId) throw new Error('no user to seed a recording for')
    const id = randomUUID()
    const key = `media/${userId}/recordings/${id}.wav`
    const target = path.join(e2eServerFiles.dataDir, key)
    mkdirSync(path.dirname(target), { recursive: true })
    const clip = options.clip ?? 'en-sample.wav'
    copyFileSync(path.join(fixtureFolder, clip), target)
    const size = readFileSync(target).length
    await client.query(
      `insert into recordings (id, user_id, entry_id, file_path, mime_type, size_bytes, duration_ms, language, status)
       values ($1, $2, $3, $4, 'audio/wav', $5, $6, $7, $8)`,
      [
        id,
        userId,
        options.entryId,
        key,
        size,
        Math.round(((size - 44) / 32000) * 1000),
        options.language ?? 'en',
        options.status,
      ],
    )
    if (options.transcript) {
      await client.query(
        `insert into transcripts (user_id, recording_id, model, language, text, is_user_edited)
         values ($1, $2, 'fake', $3, $4, $5)`,
        [
          userId,
          id,
          options.transcript.language,
          options.transcript.text,
          options.transcript.isUserEdited ?? false,
        ],
      )
    }
    return { id, key }
  })
}

export async function readRecordings() {
  return withDatabase(async (client) => {
    const result = await client.query<{
      id: string
      status: string
      language: string
      duration_ms: number
      entry_id: string
    }>('select id, status, language, duration_ms, entry_id from recordings order by created_at')
    return result.rows
  })
}

export async function readTranscripts() {
  return withDatabase(async (client) => {
    const result = await client.query<{ text: string; language: string; is_user_edited: boolean }>(
      'select text, language, is_user_edited from transcripts order by created_at',
    )
    return result.rows
  })
}
