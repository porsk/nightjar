import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config.ts'

const valid = { DATABASE_URL: 'postgres://nightjar:s3cret-pw@db:5432/nightjar' }

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(valid)).toMatchObject({
      PORT: 3000,
      NIGHTJAR_METRICS_PORT: 9464,
      LOG_LEVEL: 'info',
      NIGHTJAR_TRUST_PROXY: false,
    })
  })

  it('reads NIGHTJAR_TRUST_PROXY as a boolean', () => {
    expect(loadConfig({ ...valid, NIGHTJAR_TRUST_PROXY: 'true' }).NIGHTJAR_TRUST_PROXY).toBe(true)
  })

  it('reads overrides', () => {
    const config = loadConfig({
      ...valid,
      PORT: '8080',
      NIGHTJAR_METRICS_PORT: '9000',
      LOG_LEVEL: 'warn',
    })
    expect(config).toMatchObject({ PORT: 8080, NIGHTJAR_METRICS_PORT: 9000, LOG_LEVEL: 'warn' })
  })

  it('names every bad variable and never prints a secret value', () => {
    const run = () => loadConfig({ DATABASE_URL: 's3cret-pw', LOG_LEVEL: 'loud' })
    expect(run).toThrow(ConfigError)
    try {
      run()
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('DATABASE_URL')
      expect(message).toContain('LOG_LEVEL')
      expect(message).not.toContain('s3cret-pw')
    }
  })

  it('fails when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/)
  })
})
