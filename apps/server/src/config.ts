import { z } from 'zod'

const configSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  NIGHTJAR_METRICS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
  NIGHTJAR_WEB_DIR: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

export type Config = z.infer<typeof configSchema>

export class ConfigError extends Error {}

/** Validates the environment once at startup. Messages name the variables, never their values. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env)
  if (result.success) return result.data
  const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  throw new ConfigError(`Invalid configuration:\n  ${problems.join('\n  ')}`)
}
