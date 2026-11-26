import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { App } from './app.tsx'

type Handler = () => Response | Promise<Response>

export const json = (body: unknown, status = 200) => Response.json(body, { status })

export const apiError = (status: number, code: string) =>
  json({ error: { code, message: 'x' } }, status)

export const me = {
  id: 'u1',
  email: 'owner@example.test',
  isAdmin: true,
  uiLanguage: 'en',
  entryLanguage: 'en',
  timeZone: 'Europe/Budapest',
}

/** Answers fetch calls by "METHOD /path". Returns the calls made so tests can check bodies. */
export function stubApi(handlers: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${path}`
      calls.push({ key, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
      const handler = handlers[key]
      if (!handler) throw new Error(`unexpected request ${key}`)
      return handler()
    }),
  )
  return calls
}

export function renderApp(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
