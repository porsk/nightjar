import { pino, type DestinationStream, type Logger } from 'pino'
import { describeError } from './process-handlers.ts'

const redactedPaths = [
  'apiKey',
  '*.apiKey',
  'secrets',
  '*.secrets',
  'password',
  'username',
  '*.password',
  '*.username',
  'body.name',
  '*.body.name',
  'user.name',
  '*.user.name',
  'headers.cookie',
  'headers.authorization',
  '*.headers.cookie',
  '*.headers.authorization',
  '*.*.headers.cookie',
  '*.*.headers.authorization',
]

export type { Logger }

/** Message and stack included. Only for errors that cannot carry user data, like failed migrations. */
export const serializeFullError = pino.stdSerializers.err

export function createLogger(options: { level: string; stream?: DestinationStream }): Logger {
  return pino(
    {
      level: options.level,
      base: {},
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      serializers: { err: describeError },
      redact: { paths: redactedPaths, censor: '[Redacted]' },
    },
    options.stream ?? pino.destination({ fd: 1, sync: true }),
  )
}
