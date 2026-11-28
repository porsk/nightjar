import type { CloudProvider } from './cloud/provider.ts'
import { providerById } from './cloud/registry.ts'
import { createCloudTranscriber } from './cloud/cloud-transcriber.ts'
import type { TranscriberFactory } from './transcriber.ts'

type CloudDependencies = Omit<Parameters<typeof createCloudTranscriber>[0], 'provider'>

/** Cloud transcribers for provider ids, the given local factory for every other id. */
export function createEngineFactory(
  providers: readonly CloudProvider[],
  cloud: CloudDependencies,
  local: TranscriberFactory,
): TranscriberFactory {
  return (engineId) => {
    const provider = providerById(providers, engineId)
    return provider ? createCloudTranscriber({ ...cloud, provider }) : local(engineId)
  }
}
