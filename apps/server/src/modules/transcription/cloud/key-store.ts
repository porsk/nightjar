import { eq } from 'drizzle-orm'
import type { Database } from '../../../database.ts'
import { providerSecrets } from '../../../db/schema.ts'
import type { SecretBox } from './secrets.ts'

export type SavedKey =
  { state: 'none' } | { state: 'unreadable' } | { state: 'ready'; secrets: Record<string, string> }

/** The saved provider keys: encrypted in `provider_secrets`, decrypted only when a call needs them. */
export function createKeyStore(database: Database, box: SecretBox) {
  const { db } = database
  return {
    read: async (providerId: string): Promise<SavedKey> => {
      const [row] = await db
        .select({ ciphertext: providerSecrets.ciphertext })
        .from(providerSecrets)
        .where(eq(providerSecrets.providerId, providerId))
      if (!row) return { state: 'none' }
      try {
        return { state: 'ready', secrets: box.decrypt(providerId, row.ciphertext) }
      } catch {
        return { state: 'unreadable' }
      }
    },

    /** Replaces any saved key of the provider. */
    save: async (providerId: string, secrets: Record<string, string>) => {
      const ciphertext = box.encrypt(providerId, secrets)
      await db
        .insert(providerSecrets)
        .values({ providerId, ciphertext })
        .onConflictDoUpdate({ target: providerSecrets.providerId, set: { ciphertext } })
    },

    remove: async (providerId: string) => {
      await db.delete(providerSecrets).where(eq(providerSecrets.providerId, providerId))
    },
  }
}

export type KeyStore = ReturnType<typeof createKeyStore>
