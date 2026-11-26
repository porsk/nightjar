import type { Logger } from './logger.ts'

/** Entry point for background jobs. Runs in the same process as the web server for now. */
export function startWorker({ logger }: { logger: Logger }) {
  logger.info('worker started')
  return { stop: () => Promise.resolve() }
}
