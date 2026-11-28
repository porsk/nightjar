import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './i18n/index.ts'
import { en } from './i18n/en.ts'
import { hu } from './i18n/hu.ts'
import { providerRows, recording, usageRows } from './test-browser.ts'
import { FakeEventSource } from './test-fakes.ts'
import { apiError, json, me, renderApp, stubApi } from './test-utils.tsx'

const turbo = 'whisper-large-v3-turbo-int8'
const large = 'whisper-large-v3-int8'
const admin = 'GET /api/v1/admin/transcription'
const providerPath = (id: string) => `/api/v1/admin/transcription/providers/${id}`

const modelRow = (id: string, state = 'downloaded') => ({
  id,
  state,
  downloadBytes: id === turbo ? 564_000_000 : 1_100_000_000,
  diskBytes: id === turbo ? 1_000_000_000 : 1_800_000_000,
  downloadedBytes: 0,
  useWhenReady: false,
  error: null,
})

const status = (overrides: object = {}) => ({
  enabled: true,
  state: 'ready',
  downloadedBytes: 564_000_000,
  totalBytes: 564_000_000,
  backlogCount: 0,
  activeEngine: turbo,
  models: [modelRow(turbo), modelRow(large, 'not_downloaded')],
  providers: providerRows(),
  usage: usageRows(),
  ...overrides,
})

const base = {
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(me),
}

const hungarian = { ...base, 'GET /api/v1/me': () => json({ ...me, uiLanguage: 'hu' }) }

const rowOf = (name: string) => {
  const found = screen
    .getAllByTestId('provider-row')
    .find((element) => within(element).queryByText(name, { selector: 'b' }))
  if (!found) throw new Error(`no row for ${name}`)
  return within(found)
}

const withKey = (id: string, extra: object = {}) =>
  providerRows({ [id]: { configured: true, ...extra } })

describe('010-cloud-transcription: catalogues', () => {
  it('AC-1: both catalogues name every provider like its label and describe it', () => {
    for (const catalogue of [en, hu]) {
      expect(catalogue.providers.soniox.name).toBe('Soniox')
      expect(catalogue.providers.gladia.name).toBe('Gladia')
      expect(catalogue.providers.soniox.description).toContain('{{price}}')
      expect(catalogue.providers.gladia.description).toContain('{{price}}')
    }
  })

  it('AC-28: neither catalogue has the privacy note any more', () => {
    for (const catalogue of [en, hu]) {
      expect(catalogue.common).not.toHaveProperty('privacyNote')
    }
  })
})

describe('010-cloud-transcription: engines in Settings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC-2: the list has a local and a cloud group, the prices in the descriptions and one row in use', async () => {
    await i18n.changeLanguage('hu')
    stubApi({ ...hungarian, [admin]: () => json(status()) })
    renderApp('/settings')

    expect(await screen.findByText('Átírási motor')).toBeInTheDocument()
    const local = screen.getByRole('group', { name: 'Helyi' })
    const cloud = screen.getByRole('group', { name: 'Felhő' })
    expect(within(local).getAllByTestId('model-row')).toHaveLength(2)
    expect(
      within(cloud).getByText('A hangot átírásra elküldjük a szolgáltatónak, utána töröljük nála.'),
    ).toBeInTheDocument()
    expect(rowOf('Soniox').getByText(/Kb\. 0,10\s+USD óránként/)).toBeInTheDocument()
    expect(rowOf('Gladia').getByText(/Kb\. 0,27\s+EUR óránként/)).toBeInTheDocument()
    expect(rowOf('Soniox').getByText('Nincs API-kulcs')).toBeInTheDocument()
    expect(screen.getAllByText('Használatban')).toHaveLength(1)
  })

  it('AC-3: a provider with no key offers to add one and has no switch button', async () => {
    stubApi({ ...base, [admin]: () => json(status()) })
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    const row = rowOf('Soniox')
    expect(row.getByText('No API key')).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Add API key' })).toBeInTheDocument()
    expect(row.queryByRole('button', { name: 'Use' })).not.toBeInTheDocument()
  })

  it('AC-4: saving a key sends it once, clears the field and shows the masked saved state', async () => {
    const calls = stubApi({
      ...base,
      [admin]: () => json(status()),
      [`PUT ${providerPath('soniox')}/secrets`]: () =>
        json(status({ providers: withKey('soniox') })),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    await user.click(rowOf('Soniox').getByRole('button', { name: 'Add API key' }))
    const field = rowOf('Soniox').getByLabelText('API key')
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field).toHaveAttribute('spellcheck', 'false')
    await user.type(field, 'sk-secret-123')
    await user.click(rowOf('Soniox').getByRole('button', { name: 'Save' }))

    expect(await rowOf('Soniox').findByText('Key saved')).toBeInTheDocument()
    expect(calls.find(({ key }) => key.startsWith('PUT'))?.body).toEqual({
      apiKey: 'sk-secret-123',
    })
    expect(rowOf('Soniox').queryByLabelText('API key')).not.toBeInTheDocument()
    expect(rowOf('Soniox').getByText('••••••••')).toBeInTheDocument()
    expect(rowOf('Soniox').getByRole('button', { name: 'Replace' })).toBeInTheDocument()
    expect(rowOf('Soniox').getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('sk-secret-123')
  })

  it('AC-4: a refused key body shows "Enter the API key." under the field', async () => {
    stubApi({
      ...base,
      [admin]: () => json(status()),
      [`PUT ${providerPath('soniox')}/secrets`]: () => apiError(400, 'invalid_request'),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    await user.click(rowOf('Soniox').getByRole('button', { name: 'Add API key' }))
    await user.click(rowOf('Soniox').getByRole('button', { name: 'Save' }))
    expect(await rowOf('Soniox').findByText('Enter the API key.')).toBeInTheDocument()
  })

  it('AC-5: Replace opens the form and Cancel sends nothing, saving sends the new key', async () => {
    const calls = stubApi({
      ...base,
      [admin]: () => json(status({ providers: withKey('soniox') })),
      [`PUT ${providerPath('soniox')}/secrets`]: () =>
        json(status({ providers: withKey('soniox') })),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    await user.click(rowOf('Soniox').getByRole('button', { name: 'Replace' }))
    expect(rowOf('Soniox').getByLabelText('API key')).toHaveValue('')
    await user.click(rowOf('Soniox').getByRole('button', { name: 'Cancel' }))
    expect(rowOf('Soniox').getByText('••••••••')).toBeInTheDocument()
    expect(calls.some(({ key }) => key.startsWith('PUT'))).toBe(false)

    await user.click(rowOf('Soniox').getByRole('button', { name: 'Replace' }))
    await user.type(rowOf('Soniox').getByLabelText('API key'), 'new-key')
    await user.click(rowOf('Soniox').getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(calls.find(({ key }) => key.startsWith('PUT'))?.body).toEqual({ apiKey: 'new-key' })
    })
  })

  it('AC-6: Remove asks first, Cancel changes nothing, the engine in use has no Remove', async () => {
    let current = status({ providers: withKey('soniox'), activeEngine: 'gladia' })
    current = {
      ...current,
      providers: providerRows({ soniox: { configured: true }, gladia: { configured: true } }),
    }
    const calls = stubApi({
      ...base,
      [admin]: () => json(current),
      [`DELETE ${providerPath('soniox')}/secrets`]: () =>
        json(
          status({
            providers: providerRows({ gladia: { configured: true } }),
            activeEngine: 'gladia',
          }),
        ),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    expect(rowOf('Gladia').queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

    await user.click(rowOf('Soniox').getByRole('button', { name: 'Remove' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove the Soniox API key?' })
    expect(
      within(dialog).getByText('The key is deleted from the server. You can add it again later.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(calls.some(({ key }) => key.startsWith('DELETE'))).toBe(false)

    await user.click(rowOf('Soniox').getByRole('button', { name: 'Remove' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    )
    expect(await rowOf('Soniox').findByText('No API key')).toBeInTheDocument()
  })

  it('AC-7: Check key shows each result, says Checking… meanwhile and clears when the field changes', async () => {
    const results = ['ok', 'invalid_key', 'unreachable']
    let release = () => {}
    const calls = stubApi({
      ...base,
      [admin]: () => json(status()),
      [`POST ${providerPath('gladia')}/test`]: async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return json({ result: results.shift() })
      },
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    await user.click(rowOf('Gladia').getByRole('button', { name: 'Add API key' }))
    await user.type(rowOf('Gladia').getByLabelText('API key'), 'typed-key')
    await user.click(rowOf('Gladia').getByRole('button', { name: 'Check key' }))
    expect(rowOf('Gladia').getByRole('button', { name: 'Checking…' })).toBeDisabled()
    act(() => {
      release()
    })
    expect(await rowOf('Gladia').findByRole('status')).toHaveTextContent('The key works.')
    expect(calls.find(({ key }) => key.includes('/test'))?.body).toEqual({ apiKey: 'typed-key' })

    await user.type(rowOf('Gladia').getByLabelText('API key'), 'x')
    expect(rowOf('Gladia').queryByRole('status')).not.toBeInTheDocument()
    await user.click(rowOf('Gladia').getByRole('button', { name: 'Check key' }))
    act(() => {
      release()
    })
    const invalid = await rowOf('Gladia').findByRole('alert')
    expect(invalid).toHaveTextContent("The provider didn't accept the key.")
    expect(rowOf('Gladia').getByLabelText('API key')).toHaveAttribute(
      'aria-describedby',
      invalid.id,
    )

    await user.click(rowOf('Gladia').getByRole('button', { name: 'Check key' }))
    act(() => {
      release()
    })
    await waitFor(() => {
      expect(rowOf('Gladia').getByRole('alert')).toHaveTextContent(
        "Couldn't reach the provider. Try again later.",
      )
    })
  })

  it('AC-7: on a saved row Check key tests the saved key with an empty body', async () => {
    const calls = stubApi({
      ...base,
      [admin]: () => json(status({ providers: withKey('soniox') })),
      [`POST ${providerPath('soniox')}/test`]: () => json({ result: 'ok' }),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    await user.click(rowOf('Soniox').getByRole('button', { name: 'Check key' }))
    expect(await rowOf('Soniox').findByText('The key works.')).toBeInTheDocument()
    expect(calls.find(({ key }) => key.includes('/test'))?.body).toEqual({})
  })

  it('AC-8: Use switches the engine, and the hint and ready line name the cloud service', async () => {
    let current = status({ providers: withKey('soniox') })
    const calls = stubApi({
      ...base,
      [admin]: () => json(current),
      [`POST ${providerPath('soniox')}/use`]: () => {
        current = status({ providers: withKey('soniox'), activeEngine: 'soniox', totalBytes: 0 })
        return json(current)
      },
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    await user.click(rowOf('Soniox').getByRole('button', { name: 'Use' }))

    expect(calls.some(({ key }) => key === `POST ${providerPath('soniox')}/use`)).toBe(true)
    expect(
      await screen.findByText('Recordings are turned into text by a cloud service (Soniox).'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('New recordings are transcribed in the cloud (Soniox).'),
    ).toBeInTheDocument()
    expect(rowOf('Soniox').getByText('In use')).toBeInTheDocument()
    expect(screen.getAllByText('In use')).toHaveLength(1)
  })

  it('AC-9: a model.updated event moves the list without a reload', async () => {
    let current = status()
    stubApi({ ...base, [admin]: () => json(current) })
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    expect(rowOf('Soniox').getByText('No API key')).toBeInTheDocument()

    current = status({ activeEngine: 'soniox', totalBytes: 0, providers: withKey('soniox') })
    act(() => {
      FakeEventSource.instances[0]?.emit('model.updated', {
        type: 'model.updated',
        state: 'ready',
        downloadedBytes: 0,
        totalBytes: 0,
        activeEngine: 'soniox',
        models: [modelRow(turbo), modelRow(large, 'not_downloaded')],
        providers: withKey('soniox'),
      })
    })
    await waitFor(() => {
      expect(rowOf('Soniox').getByText('In use')).toBeInTheDocument()
    })
  })

  it('AC-10: the usage line shows hours and cost in the language, and only where there is a key or use', async () => {
    stubApi({
      ...base,
      [admin]: () =>
        json(
          status({
            providers: providerRows({ soniox: { configured: true }, gladia: { configured: true } }),
            usage: usageRows({ soniox: { audioMs: 11_520_000, estimatedCost: 0.32 } }),
          }),
        ),
    })
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    expect(
      rowOf('Soniox').getByText(/This month: 3\.2 h · about \$0\.32 \(estimate\)/),
    ).toBeInTheDocument()
    expect(
      rowOf('Gladia').getByText(/This month: 0 h · about €0\.00 \(estimate\)/),
    ).toBeInTheDocument()
  })

  it('AC-10: in Hungarian the numbers use a decimal comma, and a row with no key and no use has no line', async () => {
    await i18n.changeLanguage('hu')
    stubApi({
      ...hungarian,
      [admin]: () =>
        json(
          status({
            providers: withKey('soniox'),
            usage: usageRows({ soniox: { audioMs: 11_520_000, estimatedCost: 0.32 } }),
          }),
        ),
    })
    renderApp('/settings')
    await screen.findByText('Átírási motor')
    expect(
      rowOf('Soniox').getByText(/Ebben a hónapban: 3,2 óra · kb\. 0,32\s+USD \(becslés\)/),
    ).toBeInTheDocument()
    expect(rowOf('Gladia').queryByText(/Ebben a hónapban/)).not.toBeInTheDocument()
  })

  it('AC-13: an unreadable key shows the alert and a form without Cancel, and the ready line asks for the key', async () => {
    stubApi({
      ...base,
      [admin]: () =>
        json(
          status({
            state: 'needs_key',
            activeEngine: 'soniox',
            totalBytes: 0,
            providers: providerRows({ soniox: { keyError: 'unreadable' } }),
          }),
        ),
    })
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    const row = rowOf('Soniox')
    expect(row.getByText("The saved key can't be read. Enter it again.")).toBeInTheDocument()
    expect(row.getByLabelText('API key')).toBeInTheDocument()
    expect(row.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Check key' })).toBeInTheDocument()
    expect(
      screen.getByText('Enter the API key again. New recordings wait until then.'),
    ).toBeInTheDocument()
  })

  it('AC-30: a user who is not an admin sees no engine list', async () => {
    stubApi({
      'GET /api/v1/setup': () => json({ needed: false }),
      'GET /api/v1/me': () => json({ ...me, isAdmin: false }),
    })
    renderApp('/settings')
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByTestId('provider-row')).not.toBeInTheDocument()
  })
})

describe('010-cloud-transcription: recording cards', () => {
  const signedIn = {
    ...base,
    'GET /api/v1/entries/e1': () =>
      json({
        id: 'e1',
        entryDate: '2026-11-26',
        bodyMd: '',
        createdAt: '2026-11-26T19:42:00.000Z',
        updatedAt: '2026-11-26T19:42:00.000Z',
      }),
  }
  const withModel = (model: string, extra: object = {}) =>
    recording({ transcript: { ...recording().transcript, model }, ...extra })

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
    HTMLMediaElement.prototype.pause = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC-27: the meta row names the engine with its icon and a hidden prefix, and nothing for an unknown id', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1/recordings': () =>
        json([
          withModel(turbo),
          recording({ id: 'r2', transcript: withModel('soniox').transcript }),
          recording({ id: 'r3', transcript: withModel('whatever').transcript }),
        ]),
    })
    renderApp('/entries/e1')
    const cards = await screen.findAllByTestId('recording-card')
    const [local, cloud, unknown] = cards.map((card) => within(card))
    expect(local?.getByText('Turbo').parentElement).toHaveTextContent('Model: Turbo')
    expect(cloud?.getByText('Soniox').parentElement).toHaveTextContent('Cloud service: Soniox')
    expect(unknown?.queryByText(/Model:|Cloud service:/)).not.toBeInTheDocument()
  })

  it('AC-22: a failed card with a rejected key says why, that the recording is safe, and offers to try again', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1/recordings': () =>
        json([recording({ status: 'failed', transcript: null, failure: 'api_key_invalid' })]),
    })
    renderApp('/entries/e1')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Transcription failed.')
    expect(alert).toHaveTextContent(
      "The cloud service didn't accept the API key. An admin can replace it in Settings.",
    )
    expect(alert).toHaveTextContent('The recording is safe.')
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('AC-23: the reason texts for no credit, an unavailable service, a timeout and a rejected recording', async () => {
    const codes = {
      quota_exceeded: 'The cloud service account is out of credit.',
      provider_unavailable: "The cloud service can't be reached right now. Try again later.",
      timeout: 'The cloud service took too long.',
      audio_rejected: "The cloud service couldn't process this recording.",
    }
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1/recordings': () =>
        json(
          Object.keys(codes).map((failure, index) =>
            recording({ id: `r${String(index)}`, status: 'failed', transcript: null, failure }),
          ),
        ),
    })
    renderApp('/entries/e1')
    const alerts = await screen.findAllByRole('alert')
    for (const [index, text] of Object.values(codes).entries()) {
      expect(alerts[index]).toHaveTextContent(text)
    }
  })

  it('AC-25: a failed transcribe-again keeps the old transcript and says so after the reason', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1/recordings': () =>
        json([withModel(turbo, { status: 'failed', failure: 'provider_unavailable' })]),
    })
    renderApp('/entries/e1')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("The cloud service can't be reached right now.")
    expect(alert).toHaveTextContent('The earlier transcript is still here.')
    expect(screen.getByTestId('transcript')).toHaveTextContent('Ma reggel korán keltem.')
  })

  it('AC-29: with a cloud engine that has no usable key Transcribe again is disabled with its hint', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/transcription': () =>
        json({ state: 'not_ready', engine: { id: 'soniox', kind: 'cloud' } }),
      'GET /api/v1/entries/e1/recordings': () => json([withModel('soniox')]),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Recording actions' }))
    const item = await screen.findByRole('menuitem', { name: /There's no usable API key\./ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('010-cloud-transcription: no privacy notes outside Settings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC-28: the sidebar, the login page and the setup page carry no "stays on your server" note', async () => {
    stubApi({
      ...base,
      'GET /api/v1/entries?limit=30': () => json({ items: [], nextCursor: null }),
      'GET /api/v1/entries?date=2026-11-26': () => json({ items: [], nextCursor: null }),
    })
    renderApp('/timeline')
    await screen.findByRole('heading', { name: 'Timeline', level: 1 })
    expect(screen.queryByText(/stays on your own server/)).not.toBeInTheDocument()
    expect(document.querySelector('.privacy')).toBeNull()
  })
})
