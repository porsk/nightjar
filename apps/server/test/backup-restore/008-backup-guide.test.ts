import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repo = join(import.meta.dirname, '../../../..')
const image = process.env.BACKUP_TEST_IMAGE ?? 'porsk/nightjar:edge'
const port = process.env.BACKUP_TEST_PORT ?? '3998'
const origin = `http://localhost:${port}`
const account = { username: 'backup', name: 'Backup', password: 'backup-test-password' }
const entry = { entryDate: '2026-01-05', bodyMd: 'Backup test entry. Árvíztűrő tükörfúrógép.' }
const audio = readFileSync(join(repo, 'e2e/fixtures/en-sample.wav'))
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

const workDir = mkdtempSync(join(tmpdir(), 'nightjar-backup-'))
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: `backup-test-${String(process.pid)}`,
  POSTGRES_PASSWORD: 'backup-test',
  MSYS_NO_PATHCONV: '1',
}

function guideBlock(name: 'backup' | 'restore') {
  const guide = readFileSync(join(repo, 'docs/backup.md'), 'utf8')
  const block = new RegExp(String.raw`\`\`\`sh ${name}\n([\s\S]*?)\`\`\``).exec(guide)?.[1]
  if (!block) throw new Error(`no "${name}" block in docs/backup.md`)
  return block
}

const sh = (script: string) =>
  execFileSync('bash', ['-e', '-c', script], { cwd: workDir, env, encoding: 'utf8', stdio: 'pipe' })
const compose = (...args: string[]) =>
  execFileSync('docker', ['compose', ...args], {
    cwd: workDir,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
  })

async function api(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      origin,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })
  if (!response.ok) throw new Error(`${path} returned ${String(response.status)}`)
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  return { cookie, json: (await response.json()) as unknown }
}

async function waitReady() {
  for (let attempt = 0; attempt < 90; attempt++) {
    const ready = await fetch(`${origin}/readyz`).then(
      (response) => response.status === 200,
      () => false,
    )
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('the app did not become ready')
}

const signIn = async () =>
  (
    await api('/api/v1/auth/sign-in/username', {
      method: 'POST',
      body: { username: account.username, password: account.password },
    })
  ).cookie

async function readJournal(cookie: string) {
  const page = (await api('/api/v1/entries', { cookie })).json as { items: { id: string }[] }
  expect(page.items).toHaveLength(1)
  const id = page.items[0]?.id ?? ''
  const { bodyMd } = (await api(`/api/v1/entries/${id}`, { cookie })).json as { bodyMd: string }
  const [recording] = (await api(`/api/v1/entries/${id}/recordings`, { cookie })).json as {
    id: string
  }[]
  const response = await fetch(`${origin}/api/v1/recordings/${recording?.id ?? ''}/audio`, {
    headers: { cookie },
  })
  return { bodyMd, audioSha: sha256(Buffer.from(await response.arrayBuffer())) }
}

describe('008-backup-guide: backup and restore', () => {
  beforeAll(() => {
    copyFileSync(join(repo, 'docker/compose.yaml'), join(workDir, 'compose.yaml'))
    writeFileSync(
      join(workDir, 'compose.override.yaml'),
      `services:\n  nightjar:\n    image: ${image}\n    ports: !override\n      - '127.0.0.1:${port}:3000'\n`,
    )
  })

  afterAll(() => {
    try {
      compose('down', '-v')
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  })

  it('AC-2: the entry and its audio come back byte for byte after backup, wipe and restore', async () => {
    compose('up', '-d', '--wait', 'db')
    compose('up', '-d', 'nightjar')
    await waitReady()
    const code = /"setupCode":"([A-Z0-9]{8})"/.exec(compose('logs', 'nightjar'))?.[1]
    expect(code).toBeDefined()
    await api('/api/v1/setup', {
      method: 'POST',
      body: {
        setupCode: code,
        ...account,
        uiLanguage: 'en',
        timeZone: 'UTC',
        transcriptionEnabled: false,
      },
    })
    const cookie = await signIn()
    const created = (await api('/api/v1/entries', { method: 'POST', body: entry, cookie }))
      .json as { id: string }
    const form = new FormData()
    form.set('language', 'en')
    form.set('entryId', created.id)
    form.set('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'sample.wav')
    const upload = await fetch(`${origin}/api/v1/recordings`, {
      method: 'POST',
      headers: { origin, cookie },
      body: form,
    })
    expect(upload.status).toBe(201)
    const before = await readJournal(cookie)
    expect(before).toEqual({ bodyMd: entry.bodyMd, audioSha: sha256(audio) })

    sh(guideBlock('backup'))
    compose('down', '-v')

    sh(guideBlock('restore'))
    await waitReady()
    expect(await readJournal(await signIn())).toEqual(before)
  })
})
