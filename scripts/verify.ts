import { spawnSync } from 'node:child_process'

const steps = [
  ['format', 'pnpm format:check'],
  ['lint', 'pnpm lint'],
  ['typecheck', 'pnpm typecheck'],
  ['unit', 'pnpm test'],
  ['api', 'pnpm test:api'],
  ['acs', 'pnpm check:acs'],
  ['e2e', 'pnpm test:e2e'],
] as const

const results = steps.map(([name, command]) => {
  console.log(`\n=== ${name}: ${command}`)
  const { status } = spawnSync(command, { shell: true, stdio: 'inherit' })
  return { name, ok: status === 0 }
})

console.log('\n=== verify summary')
for (const { name, ok } of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)

const failed = results.some(({ ok }) => !ok)
if (failed)
  console.log(
    '\nArtifacts: playwright-report/ (HTML report), test-results/ (screenshots, videos, traces), coverage/ per workspace',
  )
process.exit(failed ? 1 : 0)
