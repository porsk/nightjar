import { createReadStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const recordingKey = (userId: string, recordingId: string, extension: string) =>
  `media/${userId}/recordings/${recordingId}.${extension}`

export const modelKey = (modelId: string) => `models/${modelId}`

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

    /** A path for work in progress, inside the data folder so it can be moved into place afterwards. */
    tempFile: async (extension: string) => {
      const folder = join(root, 'tmp')
      await mkdir(folder, { recursive: true })
      const path = join(folder, `${randomUUID()}.${extension}`)
      return { path, remove: () => rm(path, { force: true }) }
    },

    /** An empty folder for work in progress that makes several files. */
    tempFolder: async () => {
      const path = join(root, 'tmp', randomUUID())
      await mkdir(path, { recursive: true })
      return { path, remove: () => rm(path, { recursive: true, force: true }) }
    },

    /** Moves a finished temp file to its key. */
    adopt: async (tempPath: string, key: string) => {
      const target = locate(key)
      await mkdir(dirname(target), { recursive: true })
      await rename(tempPath, target)
    },

    size: async (key: string) => {
      try {
        return (await stat(locate(key))).size
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },

    /** Reads bytes `start` to `end` (both included), or the whole file. */
    read: (key: string, range?: { start: number; end: number }) =>
      createReadStream(locate(key), range),

    /** For programs that need a real path, like ffmpeg. */
    localPath: locate,

    /** Deletes a folder with everything in it. A folder that is already gone is fine. */
    removeFolder: async (key: string) => {
      await rm(locate(key), { recursive: true, force: true })
    },

    makeFolder: async (key: string) => {
      await mkdir(locate(key), { recursive: true })
    },
  }
}

export type Storage = ReturnType<typeof createStorage>
