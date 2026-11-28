import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '../../../logger.ts'

const keyPattern = /^[0-9a-fA-F]{64}$/
const info = 'nightjar provider secrets v1'
const version = 'v1'
export const secretFileName = 'secret.key'

/** The instance secret is missing or malformed. The message names the source, never the content. */
export class InstanceSecretError extends Error {
  readonly source: 'env' | 'file'

  constructor(source: 'env' | 'file', message: string) {
    super(message)
    this.name = 'InstanceSecretError'
    this.source = source
  }
}

export const isInstanceSecret = (value: string) => keyPattern.test(value)

/**
 * The instance secret: `NIGHTJAR_SECRET_KEY` when set, else `secret.key` in the data folder, which is
 * made on first start. Logs where it came from, never the value.
 */
export async function resolveInstanceSecret({
  env,
  dataDir,
  logger,
}: {
  env: string | undefined
  dataDir: string
  logger: Logger
}): Promise<Buffer> {
  if (env !== undefined) {
    if (!isInstanceSecret(env)) {
      throw new InstanceSecretError('env', 'NIGHTJAR_SECRET_KEY must be 64 hex characters')
    }
    logger.info({ source: 'env' }, 'instance secret from env')
    return Buffer.from(env, 'hex')
  }
  const path = join(dataDir, secretFileName)
  const read = async () => (await readFile(path, 'utf8')).replace(/\r?\n$/, '')
  let content = await read().catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  })
  if (content === undefined) {
    const made = randomBytes(32).toString('hex')
    await mkdir(dataDir, { recursive: true })
    try {
      await writeFile(path, `${made}\n`, { flag: 'wx', mode: 0o600 })
      await chmod(path, 0o600)
      logger.info({ source: 'file' }, 'instance secret created file')
      return Buffer.from(made, 'hex')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      content = await read()
    }
  }
  if (!isInstanceSecret(content)) {
    throw new InstanceSecretError('file', 'the secret.key file must hold 64 hex characters')
  }
  logger.info({ source: 'file' }, 'instance secret from file')
  return Buffer.from(content, 'hex')
}

const toBase64 = (data: Buffer) => data.toString('base64url')

/** Encrypts the secret fields of a provider. Anything that does not decrypt makes `decrypt` throw. */
export function createSecretBox(instanceSecret: Buffer) {
  const key = Buffer.from(hkdfSync('sha256', instanceSecret, Buffer.alloc(0), info, 32))
  return {
    encrypt: (providerId: string, fields: Record<string, string>): string => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from(providerId))
      const data = Buffer.concat([cipher.update(JSON.stringify(fields), 'utf8'), cipher.final()])
      return [version, toBase64(iv), toBase64(cipher.getAuthTag()), toBase64(data)].join('.')
    },

    decrypt: (providerId: string, stored: string): Record<string, string> => {
      const [tag, iv, authTag, data, ...extra] = stored.split('.')
      if (tag !== version || !iv || !authTag || !data || extra.length > 0) {
        throw new Error('the stored secret has an unknown form')
      }
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
      decipher.setAAD(Buffer.from(providerId))
      decipher.setAuthTag(Buffer.from(authTag, 'base64url'))
      const plain = Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8')
      return JSON.parse(plain) as Record<string, string>
    },
  }
}

export type SecretBox = ReturnType<typeof createSecretBox>
