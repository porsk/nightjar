import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import '../i18n/index.ts'
import { providerRows, usageRows } from '../test-browser.ts'
import { FakeEventSource } from '../test-fakes.ts'
import { json, me, renderApp, stubApi } from '../test-utils.tsx'

const turbo = 'whisper-large-v3-turbo-int8'
const large = 'whisper-large-v3-int8'

const modelRow = (id: string, state: string, extra: object = {}) => ({
  id,
  state,
  downloadBytes: id === turbo ? 560_000_000 : 1_100_000_000,
  diskBytes: id === turbo ? 1_000_000_000 : 1_800_000_000,
  downloadedBytes: 0,
  useWhenReady: false,
  error: null,
  ...extra,
})

const rowState = {
  ready: 'downloaded',
  downloading: 'downloading',
  failed: 'failed',
  off: 'downloaded',
}

interface StatusOverrides {
  enabled?: boolean
  state?: keyof typeof rowState
  downloadedBytes?: number
  backlogCount?: number
}

const status = (overrides: StatusOverrides = {}) => {
  const merged = {
    enabled: true,
    state: 'ready' as keyof typeof rowState,
    downloadedBytes: 560_000_000,
    totalBytes: 560_000_000,
    backlogCount: 0,
    activeEngine: turbo,
    providers: providerRows(),
    usage: usageRows(),
    ...overrides,
  }
  return {
    models: [
      modelRow(turbo, rowState[merged.state], {
        downloadedBytes: merged.state === 'downloading' ? merged.downloadedBytes : 0,
        error: merged.state === 'failed' ? 'download_failed' : null,
      }),
      modelRow(large, 'not_downloaded'),
    ],
    ...merged,
  }
}

const base = {
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(me),
}

const admin = 'GET /api/v1/admin/transcription'
const put = 'PUT /api/v1/admin/transcription'

const sendModelEvent = (event: object) => {
  act(() => {
    FakeEventSource.instances[0]?.emit('model.updated', {
      type: 'model.updated',
      activeEngine: turbo,
      models: [modelRow(turbo, 'downloading'), modelRow(large, 'not_downloaded')],
      providers: providerRows(),
      ...event,
    })
  })
}

describe('003-voice-entries: transcription in Settings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC-20: transcription starts off, with the size of the download in the hint', async () => {
    stubApi({
      ...base,
      [admin]: () => json(status({ enabled: false, state: 'off', downloadedBytes: 0 })),
    })
    renderApp('/settings')

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Transcription' })).not.toBeChecked()
    expect(
      screen.getByText(
        'Turns recordings into text on your own server. Needs a one-time download of about 560 MB.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('AC-21: turning it on shows the download with live progress and then that the model is ready', async () => {
    let current = status({ enabled: false, state: 'off', downloadedBytes: 0 })
    const calls = stubApi({
      ...base,
      [admin]: () => json(current),
      [put]: () => json(status({ state: 'downloading', downloadedBytes: 0 })),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await user.click(await screen.findByRole('switch', { name: 'Transcription' }))

    expect(calls.find(({ key }) => key === put)?.body).toEqual({ enabled: true })
    expect(await screen.findByText('Downloading model…')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Transcription' })).toBeChecked()

    sendModelEvent({
      state: 'downloading',
      downloadedBytes: 340_000_000,
      totalBytes: 560_000_000,
      models: [
        modelRow(turbo, 'downloading', { downloadedBytes: 340_000_000 }),
        modelRow(large, 'not_downloaded'),
      ],
    })
    expect(await screen.findByText('340 MB / 560 MB · 60%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Downloading model…' })).toHaveAttribute(
      'aria-valuenow',
      '60',
    )

    current = status()
    sendModelEvent({
      state: 'ready',
      downloadedBytes: 560_000_000,
      totalBytes: 560_000_000,
      models: [modelRow(turbo, 'downloaded'), modelRow(large, 'not_downloaded')],
    })
    expect(
      await screen.findByText('Model downloaded. New recordings will be transcribed.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('AC-22: when the files are already there it is ready at once', async () => {
    stubApi({
      ...base,
      [admin]: () => json(status({ enabled: false, state: 'off', downloadedBytes: 0 })),
      [put]: () => json(status()),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await user.click(await screen.findByRole('switch', { name: 'Transcription' }))

    expect(
      await screen.findByText('Model downloaded. New recordings will be transcribed.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Downloading model…')).not.toBeInTheDocument()
  })

  it('AC-23: a failed download shows an error and Try again asks for it once more', async () => {
    const calls = stubApi({
      ...base,
      [admin]: () => json(status({ state: 'failed', downloadedBytes: 0 })),
      [`POST /api/v1/admin/transcription/models/${turbo}/download`]: () =>
        json(status({ state: 'downloading', downloadedBytes: 0 })),
    })
    const user = userEvent.setup()
    renderApp('/settings')

    expect(await screen.findByRole('alert')).toHaveTextContent('The model download failed.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Downloading model…')).toBeInTheDocument()
    expect(
      calls.some(({ key }) => key === `POST /api/v1/admin/transcription/models/${turbo}/download`),
    ).toBe(true)
  })

  it('AC-24: asks about recordings that were never transcribed, Transcribe now queues them', async () => {
    let current = status({ backlogCount: 14 })
    const calls = stubApi({
      ...base,
      [admin]: () => json(current),
      'POST /api/v1/admin/transcription/backlog': () => {
        current = status({ backlogCount: 0 })
        return json({ queued: 14 })
      },
    })
    const user = userEvent.setup()
    renderApp('/settings')

    expect(
      await screen.findByText('14 recordings were never transcribed. Transcribe them now?'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Transcribe now' }))

    await waitFor(() => {
      expect(
        screen.queryByText('14 recordings were never transcribed. Transcribe them now?'),
      ).not.toBeInTheDocument()
    })
    expect(calls.some(({ key }) => key === 'POST /api/v1/admin/transcription/backlog')).toBe(true)
  })

  it('AC-24: Not now hides the question until Settings is opened again', async () => {
    stubApi({ ...base, [admin]: () => json(status({ backlogCount: 3 })) })
    const user = userEvent.setup()
    const first = renderApp('/settings')
    await user.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByText(/never transcribed/)).not.toBeInTheDocument()
    first.unmount()

    renderApp('/settings')
    expect(await screen.findByText(/3 recordings were never transcribed/)).toBeInTheDocument()
  })

  it('AC-25: turning it off asks the server to stop', async () => {
    const calls = stubApi({
      ...base,
      [admin]: () => json(status()),
      [put]: () => json(status({ enabled: false, state: 'off', downloadedBytes: 0 })),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await user.click(await screen.findByRole('switch', { name: 'Transcription' }))

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Transcription' })).not.toBeChecked()
    })
    expect(calls.find(({ key }) => key === put)?.body).toEqual({ enabled: false })
  })

  it('AC-26: a user who is not an admin does not see the admin section', async () => {
    const calls = stubApi({
      'GET /api/v1/setup': () => json({ needed: false }),
      'GET /api/v1/me': () => json({ ...me, isAdmin: false }),
    })
    renderApp('/settings')

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(calls.some(({ key }) => key === admin)).toBe(false)
  })

  it('AC-26: the admin heading is a section heading inside Settings', async () => {
    stubApi({ ...base, [admin]: () => json(status()) })
    renderApp('/settings')
    const heading = await screen.findByRole('heading', { name: 'Admin' })
    expect(within(heading.parentElement as HTMLElement).getByRole('switch')).toBeInTheDocument()
  })
})
