import { pino, type DestinationStream, type Logger } from 'pino'

const redactedPaths = [
  'password',
  'email',
  '*.password',
  '*.email',
  'headers.cookie',
  'headers.authorization',
  '*.headers.cookie',
  '*.headers.authorization',
  '*.*.headers.cookie',
  '*.*.headers.authorization',
]

export type { Logger }

export function createLogger(options: { level: string; stream?: DestinationStream }): Logger {
  return pino(
    {
      level: options.level,
      base: {},
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: redactedPaths, censor: '[Redacted]' },
    },
    options.stream ?? pino.destination(1),
  )
}
