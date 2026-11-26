import { Writable } from 'node:stream'
import { expect } from 'vitest'

export function captureLogs() {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString())
      done()
    },
  })
  const text = () => chunks.join('')
  const lines = () =>
    text()
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  return { stream, text, lines }
}

export type LogCapture = ReturnType<typeof captureLogs>

/** Fails if any marker shows up anywhere in the captured log output. Also fails when nothing was logged at all. */
export function expectNoMarkersInLogs(capture: LogCapture, markers: string[]) {
  const output = capture.text()
  expect(output.length, 'nothing was logged, the check would prove nothing').toBeGreaterThan(0)
  for (const marker of markers) expect(output).not.toContain(marker)
}
