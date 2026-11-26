import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './app.tsx'
import './i18n/index.ts'

function stubFetch(result: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(result))
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the greeting and that the server is up', async () => {
    stubFetch(() => Promise.resolve(Response.json({ status: 'ok' })))
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Hello, Nightjar!' })).toBeInTheDocument()
    expect(await screen.findByText('The server is up.')).toBeInTheDocument()
  })

  it('shows that the server is unreachable when the request fails', async () => {
    stubFetch(() => Promise.reject(new Error('offline')))
    render(<App />)
    expect(await screen.findByText('The server is unreachable.')).toBeInTheDocument()
  })
})
