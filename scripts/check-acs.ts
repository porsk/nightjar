import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.join(import.meta.dirname, '..')
const specFiles = globSync('docs/specs/*.md', { cwd: root }).filter(
  (file) => !path.basename(file).startsWith('_'),
)
const testFiles = globSync('{apps,packages,e2e}/**/*.{test,spec}.{ts,tsx}', {
  cwd: root,
  exclude: (name) => name === 'node_modules',
})

const testSources = testFiles.map((file) => readFileSync(path.join(root, file), 'utf8'))

const missing: string[] = []
for (const specFile of specFiles) {
  const specId = path.basename(specFile, '.md')
  const spec = readFileSync(path.join(root, specFile), 'utf8')
  if (!/^Status:\s*(building|done)\b/m.test(spec)) continue
  const acIds = new Set(spec.match(/\*\*AC-\d+\*\*/g)?.map((m) => m.slice(2, -2)))
  const linkedSources = testSources.filter((source) =>
    new RegExp(String.raw`describe\(\s*['"\`]${specId}[:'"\`]`).test(source),
  )
  for (const acId of acIds) {
    const hasTest = linkedSources.some((source) =>
      new RegExp(String.raw`(?:it|test)\(\s*['"\`]${acId}:`).test(source),
    )
    if (!hasTest) missing.push(`${specId}: ${acId} has no test`)
  }
}

if (missing.length > 0) {
  console.error(`AC check failed:\n${missing.map((line) => `  ${line}`).join('\n')}`)
  process.exit(1)
}
console.log(`AC check passed (${String(specFiles.length)} specs)`)
