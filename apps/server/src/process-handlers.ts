import type { Logger } from './logger.ts'

type ProcessEvents = Pick<NodeJS.Process, 'on' | 'once'>

/** The only error details that are safe to log: no message, no stack, no query parameters. */
export function describeError(error: unknown): { name: string; code?: string } {
  if (!(error instanceof Error)) return { name: 'NonError' }
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? { name: error.name, code } : { name: error.name }
}

interface HandlerOptions {
  logger: Logger
  exit: (code: number) => void
}

export function installCrashHandlers(proc: ProcessEvents, { logger, exit }: HandlerOptions) {
  const crash = (message: string) => (error: unknown) => {
    logger.fatal(describeError(error), message)
    exit(1)
  }
  proc.on('uncaughtException', crash('uncaught exception'))
  proc.on('unhandledRejection', crash('unhandled rejection'))
}

/** Closes servers and the database pool on SIGTERM or SIGINT, then exits 0. */
export function installShutdownHandlers(
  proc: ProcessEvents,
  { logger, exit, close }: HandlerOptions & { close: () => Promise<void> },
) {
  const shutdown = () => {
    logger.info('shutting down')
    close().then(
      () => {
        exit(0)
      },
      (error: unknown) => {
        logger.error(describeError(error), 'shutdown failed')
        exit(1)
      },
    )
  }
  proc.once('SIGTERM', shutdown)
  proc.once('SIGINT', shutdown)
}
