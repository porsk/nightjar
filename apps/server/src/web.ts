import type { AddressInfo } from 'node:net'
import { buildApp, type AppDependencies } from './app.ts'

/** Entry point for HTTP requests. */
export async function startWeb(dependencies: AppDependencies, port: number) {
  const app = await buildApp(dependencies)
  await app.listen({ port, host: '0.0.0.0' })
  return { port: (app.server.address() as AddressInfo).port, close: () => app.close() }
}
