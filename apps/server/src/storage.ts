import { rm } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

/** Files live under the data folder and are only reached through keys like `media/<user>/recordings/<id>.webm`. */
export function createStorage(dataDir: string) {
  const root = resolve(dataDir)

  const locate = (key: string) => {
    const location = resolve(root, key)
    const fromRoot = relative(root, location)
    if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
      throw new Error('storage key points outside the data folder')
    }
    return location
  }

  return {
    /** Deletes the file behind a key. A file that is already gone is fine. */
    remove: async (key: string) => {
      await rm(locate(key), { force: true })
    },
  }
}

export type Storage = ReturnType<typeof createStorage>
