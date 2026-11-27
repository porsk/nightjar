import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const newImage = process.argv[2] ?? 'porsk/nightjar:edge'
const run = `upgrade-${String(process.pid)}`
const network = run
const volumes = { data: `${run}-data`, db: `${run}-db` }
const port = process.env.UPGRADE_TEST_PORT ?? '3999'
const origin = `http://localhost:${port}`
const dbPassword = 'upgrade-test'
const account = { email: 'upgrade@example.com', password: 'upgrade-test-password' }
const fixtures = [
  {
    entryDate: '2026-01-05',
    bodyMd: 'First upgrade test entry, with a line.\n\nAnd a second paragraph.',
  },
  { entryDate: '2026-01-06', bodyMd: 'Second entry: Árvíztűrő tükörfúrógép.' },
]

const docker = (...args: string[]) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function previousImage() {
  if (process.argv[3]) return process.argv[3]
  const tag = execFileSync(
    'gh',
    ['release', 'view', '--repo', 'porsk/nightjar', '--json', 'tagName', '--jq', '.tagName'],
    { encoding: 'utf8' },
  ).trim()
  return `porsk/nightjar:${tag.slice(tag.lastIndexOf('v') + 1)}`
}

function startApp(name: string, image: string) {
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--network',
    network,
    '-p',
    `127.0.0.1:${port}:3000`,
    '-e',
    `DATABASE_URL=postgres://nightjar:${dbPassword}@${run}-db:5432/nightjar`,
    '-v',
    `${volumes.data}:/data`,
    image,
  )
}

async function waitFor(what: string, check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (await check().catch(() => false)) return
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const ready = async () => (await fetch(`${origin}/readyz`)).status === 200

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
  if (!response.ok)
    throw new Error(`${init.method ?? 'GET'} ${path} returned ${String(response.status)}`)
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  return { cookie, json: (await response.json()) as unknown }
}

const signIn = async () =>
  (await api('/api/v1/auth/sign-in/email', { method: 'POST', body: account })).cookie

type Entry = { id: string; entryDate: string; bodyMd: string; createdAt: string }
async function listEntries(cookie: string) {
  const page = (await api('/api/v1/entries', { cookie })).json as { items: { id: string }[] }
  const entries: Entry[] = []
  for (const { id } of page.items) {
    const { entryDate, bodyMd, createdAt } = (await api(`/api/v1/entries/${id}`, { cookie }))
      .json as Entry
    entries.push({ id, entryDate, bodyMd, createdAt })
  }
  return entries.sort((a, b) => a.entryDate.localeCompare(b.entryDate))
}

const containers = [`${run}-old`, `${run}-new`, `${run}-db`]

function saveLogs() {
  mkdirSync('upgrade-logs', { recursive: true })
  for (const name of containers) {
    const { stdout, stderr } = spawnSync('docker', ['logs', name], { encoding: 'utf8' })
    writeFileSync(`upgrade-logs/${name}.log`, stdout + stderr)
  }
}

function cleanup() {
  for (const name of containers) spawnSync('docker', ['rm', '-f', name])
  spawnSync('docker', ['network', 'rm', network])
  spawnSync('docker', ['volume', 'rm', volumes.data, volumes.db])
}

const oldImage = previousImage()
console.log(`upgrading ${oldImage} -> ${newImage}`)
try {
  docker('network', 'create', network)
  docker(
    'run',
    '-d',
    '--name',
    `${run}-db`,
    '--network',
    network,
    '-e',
    'POSTGRES_USER=nightjar',
    '-e',
    `POSTGRES_PASSWORD=${dbPassword}`,
    '-e',
    'POSTGRES_DB=nightjar',
    '-v',
    `${volumes.db}:/var/lib/postgresql`,
    '--health-cmd',
    'pg_isready -U nightjar',
    '--health-interval',
    '2s',
    'postgres:19',
  )
  await waitFor(
    'postgres',
    async () => docker('inspect', '-f', '{{.State.Health.Status}}', `${run}-db`) === 'healthy',
  )

  startApp(`${run}-old`, oldImage)
  await waitFor('the previous release to be ready', ready)
  const code = /"setupCode":"([A-Z0-9]{8})"/.exec(docker('logs', `${run}-old`))?.[1]
  if (!code) throw new Error('no setup code in the previous release log')
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
  const oldCookie = await signIn()
  for (const fixture of fixtures) {
    await api('/api/v1/entries', { method: 'POST', body: fixture, cookie: oldCookie })
  }
  const before = await listEntries(oldCookie)
  if (before.length !== fixtures.length) {
    throw new Error(`expected ${String(fixtures.length)} entries, got ${String(before.length)}`)
  }
  docker('rm', '-f', `${run}-old`)

  startApp(`${run}-new`, newImage)
  await waitFor('the new image to be ready (migrations)', ready)
  const after = await listEntries(await signIn())
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(
      `entries changed by the upgrade\nbefore: ${JSON.stringify(before)}\nafter: ${JSON.stringify(after)}`,
    )
  }
  console.log(`ok: ${String(after.length)} entries intact after the upgrade`)
} catch (error) {
  console.error(error)
  saveLogs()
  process.exitCode = 1
} finally {
  cleanup()
}
