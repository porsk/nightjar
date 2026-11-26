/** Counts failed attempts per key in a fixed window. Lives in memory on purpose. */
export function createFailedAttempts(options: {
  max: number
  windowMs: number
  now?: () => number
}) {
  const now = options.now ?? Date.now
  const entries = new Map<string, { count: number; resetAt: number }>()

  const prune = () => {
    for (const [key, entry] of entries) if (entry.resetAt <= now()) entries.delete(key)
  }

  return {
    isBlocked(key: string) {
      const entry = entries.get(key)
      return entry !== undefined && entry.resetAt > now() && entry.count >= options.max
    },
    record(key: string) {
      prune()
      const entry = entries.get(key)
      if (entry) entry.count += 1
      else entries.set(key, { count: 1, resetAt: now() + options.windowMs })
    },
  }
}

export type FailedAttempts = ReturnType<typeof createFailedAttempts>
