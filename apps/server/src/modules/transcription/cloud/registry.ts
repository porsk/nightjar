import type { AudioExtension, CloudProvider } from './provider.ts'
import { createGladiaProvider } from './gladia.ts'
import { createSonioxProvider } from './soniox.ts'

/** Soniox first, then Gladia. Adding a provider is one module and one line here. */
export const cloudProviders: CloudProvider[] = [createSonioxProvider(), createGladiaProvider()]

/** The container to stream-copy to when a provider does not accept the stored one. */
export const copyTargets: Partial<Record<AudioExtension, AudioExtension>> = { webm: 'ogg' }

export const providerById = (providers: readonly CloudProvider[], id: string) =>
  providers.find((provider) => provider.id === id)

/** The container to send: the stored one when the provider takes it, else its stream-copy target. */
export function containerFor(
  provider: CloudProvider,
  stored: AudioExtension,
): AudioExtension | undefined {
  if (provider.capabilities.formats.includes(stored)) return stored
  const target = copyTargets[stored]
  return target && provider.capabilities.formats.includes(target) ? target : undefined
}
