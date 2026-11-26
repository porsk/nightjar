import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoFile = (...parts: string[]) =>
  readFileSync(join(import.meta.dirname, '../../..', ...parts), 'utf8')

describe('007-observability: shipped files', () => {
  it('AC-10: compose publishes only port 3000, the Dockerfile exposes only 3000, the docs show the scrape config', () => {
    const compose = repoFile('docker/compose.yaml')
    const published = [...compose.matchAll(/^\s+ports:\n((?:\s+-.*\n)+)/gm)].flatMap((match) =>
      (match[1] ?? '').split('\n').filter((line) => line.trim() !== ''),
    )
    expect(published).toHaveLength(1)
    expect(published[0]).toMatch(/3000:3000/)

    const exposed = [...repoFile('docker/Dockerfile').matchAll(/^EXPOSE\s+(.*)$/gm)].map(
      (match) => match[1],
    )
    expect(exposed).toEqual(['3000'])

    const engineering = repoFile('docs/engineering.md')
    expect(engineering).toContain('scrape_configs')
    expect(engineering).toContain('nightjar:9464')
    expect(engineering).toContain('NIGHTJAR_METRICS_PORT')
  })

  it('AC-10: the Docker healthcheck keeps using /healthz', () => {
    expect(repoFile('docker/Dockerfile')).toMatch(/HEALTHCHECK[\s\S]*\/healthz/)
  })
})
