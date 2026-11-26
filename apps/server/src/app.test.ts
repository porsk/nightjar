import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('serving the web app', () => {
  it('serves files from the web directory when one is given', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'nightjar-web-'))
    writeFileSync(join(webDir, 'index.html'), '<h1>hello</h1>')
    const response = await buildApp({ webDir }).inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('<h1>hello</h1>')
  })

  it('does not serve the web app without a web directory', async () => {
    const response = await buildApp().inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(404)
  })
})
