import { z } from 'zod'
import type { Storage } from '../../storage.ts'
import { modelKey } from '../../storage.ts'
import supported from './models.json' with { type: 'json' }

const downloadSchema = z.object({
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  archive: z.boolean(),
})

const modelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  downloads: z.array(downloadSchema).min(1),
  files: z.array(z.object({ name: z.string().min(1), bytes: z.number().int().positive() })).min(1),
})

export const modelListSchema = z.object({
  default: z.string(),
  models: z.array(modelSchema).min(1),
})

export type ModelList = z.infer<typeof modelListSchema>
export type ModelInfo = z.infer<typeof modelSchema>

export const supportedModels: ModelList = modelListSchema.parse(supported)

export function defaultModel(list: ModelList): ModelInfo {
  const model = list.models.find((candidate) => candidate.id === list.default)
  if (!model) throw new Error('the default model is not in the model list')
  return model
}

/** The model with this id, or the default one when the list no longer has it. */
export function modelById(list: ModelList, id: string): ModelInfo {
  return list.models.find((candidate) => candidate.id === id) ?? defaultModel(list)
}

export const diskBytes = (model: ModelInfo) =>
  model.files.reduce((sum, file) => sum + file.bytes, 0)

export const downloadBytes = (model: ModelInfo) =>
  model.downloads.reduce((sum, item) => sum + item.bytes, 0)

/** The model is usable when every file is on disk with its expected size. */
export async function isModelReady(storage: Storage, model: ModelInfo): Promise<boolean> {
  for (const file of model.files) {
    if ((await storage.size(`${modelKey(model.id)}/${file.name}`)) !== file.bytes) return false
  }
  return true
}
