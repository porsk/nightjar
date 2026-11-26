import { readFileSync } from 'node:fs'
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

/** Back to a fresh install: no accounts, transcription off. */
export async function resetDatabase() {
  const client = new Client({ connectionString: readFileSync(e2eServerFiles.databaseUrl, 'utf8') })
  await client.connect()
  try {
    await client.query('truncate users cascade')
    await client.query('update instance_settings set transcription_enabled = false')
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
    baseURL: 'http://localhost:4173',
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

export const uniqueIp = () =>
  `10.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}.${String(1 + Math.floor(Math.random() * 250))}`
