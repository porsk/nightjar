import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { request as playwrightRequest } from '@playwright/test'
import { Client } from 'pg'
import { e2eServerFiles } from './server-files.ts'

export const password = 'correct horse battery'
export const adminEmail = 'owner@example.test'

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
export async function createAdmin(headers: Record<string, string>, uiLanguage: 'hu' | 'en' = 'en') {
  const api = await playwrightRequest.newContext({
    baseURL: `http://localhost:${process.env['NIGHTJAR_E2E_WEB_PORT'] ?? ''}`,
    extraHTTPHeaders: headers,
  })
  try {
    const response = await api.post('/api/v1/setup', {
      data: {
        setupCode: setupCodeFromLog(),
        email: adminEmail,
        password,
        uiLanguage,
        timeZone: 'Europe/Budapest',
        transcriptionEnabled: false,
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
