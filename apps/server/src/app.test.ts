import { describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'

describe('GET /healthz', () => {
  it('answers with status ok', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/healthz' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})
