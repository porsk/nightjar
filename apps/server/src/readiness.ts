export type ReadyStatus = 'ok' | 'starting' | 'db_down'

export function createReadiness(checkDatabase: () => Promise<void>) {
  let migrated = false
  return {
    isMigrated: () => migrated,
    markMigrated: () => {
      migrated = true
    },
    async status(): Promise<ReadyStatus> {
      if (!migrated) return 'starting'
      try {
        await checkDatabase()
        return 'ok'
      } catch {
        return 'db_down'
      }
    },
  }
}

export type Readiness = ReturnType<typeof createReadiness>
