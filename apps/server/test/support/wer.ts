const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFC')
    .replaceAll(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** Word error rate: word-level edits needed to turn the heard text into the reference, divided by the reference length. */
export function wordErrorRate(reference: string, heard: string): number {
  const expected = words(reference)
  const actual = words(heard)
  if (expected.length === 0) return actual.length === 0 ? 0 : 1
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index)
  for (const [row, word] of expected.entries()) {
    const current = [row + 1]
    for (const [column, other] of actual.entries()) {
      const substitution = (previous[column] ?? 0) + (word === other ? 0 : 1)
      current.push(
        Math.min(substitution, (previous[column + 1] ?? 0) + 1, (current[column] ?? 0) + 1),
      )
    }
    previous = current
  }
  return (previous[actual.length] ?? 0) / expected.length
}
