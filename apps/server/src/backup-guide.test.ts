import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repo = join(import.meta.dirname, '../../..')
const read = (file: string) => readFileSync(join(repo, file), 'utf8')
const guide = read('docs/backup.md')
const compose = read('docker/compose.yaml')
const codeBlocks = [...guide.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1] ?? '')

describe('008-backup-guide: the guide matches the repo', () => {
  it('AC-1: the guide has the six sections and the README links to it', () => {
    const headings = [...guide.matchAll(/^## (.+)$/gm)].map((match) => match[1])
    expect(headings).toEqual(
      expect.arrayContaining([
        'What to back up',
        'Back up',
        'Restore',
        'Before upgrading',
        'Postgres major upgrade',
        'Check your backup',
      ]),
    )
    expect(read('README.md')).toContain('docs/backup.md')
  })

  it('AC-3: the db image pins a numeric Postgres major and the guide names it', () => {
    const major = /image: postgres:(\d+)\s*$/m.exec(compose)?.[1]
    expect(major).toBeDefined()
    expect(guide).toContain(`postgres:${major ?? ''}`)
  })

  it('AC-4: every service and volume the code blocks use exists in compose.yaml', () => {
    const services = [...compose.matchAll(/^ {2}([a-z-]+):\s*$/gm)].map((match) => match[1])
    const volumes = [...compose.matchAll(/^ {2}(nightjar-[a-z]+):\s*$/gm)].map((match) => match[1])
    const code = codeBlocks.join('\n')
    const usedServices = [
      ...code.matchAll(/docker compose (?:exec|run|stop|start|up)[^\n]*?\b(nightjar|db)\b/g),
    ].map((match) => match[1])
    expect(usedServices.length).toBeGreaterThan(0)
    for (const service of usedServices) expect(services).toContain(service)
    const usedVolumes = [...code.matchAll(/\bnightjar-(?:db|data)\b(?!\.)/g)].map(
      (match) => match[0],
    )
    for (const volume of usedVolumes) expect(volumes).toContain(volume)
  })
})
