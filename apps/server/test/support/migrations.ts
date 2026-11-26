import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Writes a drizzle migrations folder with one SQL file per entry, applied in order. */
export function writeMigrationsFolder(statements: string[]): string {
  const folder = mkdtempSync(join(tmpdir(), 'nightjar-migrations-'))
  mkdirSync(join(folder, 'meta'))
  const entries = statements.map((sql, idx) => {
    const tag = `${String(idx).padStart(4, '0')}_test`
    writeFileSync(join(folder, `${tag}.sql`), sql)
    return { idx, version: '7', when: 1_700_000_000_000 + idx, tag, breakpoints: true }
  })
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
  )
  return folder
}
