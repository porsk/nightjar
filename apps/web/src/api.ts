import {
  entryResponseSchema,
  errorResponseSchema,
  meResponseSchema,
  setupStatusSchema,
  type CreateEntry,
  type Entry,
  type Me,
  type SettingsPatch,
  type SetupRequest,
  type UpdateEntry,
} from '@nightjar/shared'
import { queryOptions } from '@tanstack/react-query'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.status = status
    this.code = code
  }
}

async function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: object) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body
      ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  })
  const text = await response.text()
  const json: unknown = text ? JSON.parse(text) : undefined
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(json)
    throw new ApiError(response.status, parsed.success ? parsed.data.error.code : 'unknown')
  }
  return json
}

const parse = <T>(schema: { parse: (value: unknown) => T }, value: unknown): T =>
  schema.parse(value)

export const setupStatusQuery = queryOptions({
  queryKey: ['setup'],
  queryFn: async () => parse(setupStatusSchema, await request('GET', '/api/v1/setup')),
  staleTime: Infinity,
})

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async (): Promise<Me> => parse(meResponseSchema, await request('GET', '/api/v1/me')),
  retry: false,
  staleTime: Infinity,
})

export const createAccount = async (input: SetupRequest): Promise<Me> =>
  parse(meResponseSchema, await request('POST', '/api/v1/setup', input))

export const updateSettings = async (patch: SettingsPatch): Promise<Me> =>
  parse(meResponseSchema, await request('PATCH', '/api/v1/me/settings', patch))

export const signIn = async (credentials: { email: string; password: string }) => {
  await request('POST', '/api/v1/auth/sign-in/email', credentials)
}

export const signOut = async () => {
  await request('POST', '/api/v1/auth/sign-out')
}

const entryPath = (id: string) => `/api/v1/entries/${id}`

export const entryQuery = (id: string) =>
  queryOptions({
    queryKey: ['entries', id],
    queryFn: async (): Promise<Entry> =>
      parse(entryResponseSchema, await request('GET', entryPath(id))),
    staleTime: 5000,
  })

export const createEntry = async (input: CreateEntry): Promise<Entry> =>
  parse(entryResponseSchema, await request('POST', '/api/v1/entries', input))

export const updateEntry = async (id: string, input: UpdateEntry): Promise<Entry> =>
  parse(entryResponseSchema, await request('PATCH', entryPath(id), input))

export const deleteEntry = async (id: string) => {
  await request('DELETE', entryPath(id))
}
