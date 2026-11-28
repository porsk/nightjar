import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import './i18n/index.ts'
import { formatModelSize } from './format.ts'
import { providerRows, recording, usageRows } from './test-browser.ts'
import { FakeEventSource } from './test-fakes.ts'
import { json, me, renderApp, stubApi } from './test-utils.tsx'

const turbo = 'whisper-large-v3-turbo-int8'
const large = 'whisper-large-v3-int8'
const admin = 'GET /api/v1/admin/transcription'
const modelPath = (id: string) => `/api/v1/admin/transcription/models/${id}`

const row = (id: string, state: string, extra: object = {}) => ({
  id,
  state,
  downloadBytes: id === turbo ? 564_000_000 : 1_100_000_000,
  diskBytes: id === turbo ? 1_000_000_000 : 1_800_000_000,
  downloadedBytes: 0,
  useWhenReady: false,
  error: null,
  ...extra,
})

const status = (models: object[], overrides: object = {}) => ({
  enabled: true,
  state: 'ready',
  downloadedBytes: 564_000_000,
  totalBytes: 564_000_000,
  backlogCount: 0,
  activeEngine: turbo,
  models,
  providers: providerRows(),
  usage: usageRows(),
  ...overrides,
})

const base = {
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(me),
}

const rowOf = (name: string) => {
  const found = screen
    .getAllByTestId('model-row')
    .find((element) => within(element).queryByText(name))
  if (!found) throw new Error(`no row for ${name}`)
  return within(found)
}

describe('009-transcription-models: size text', () => {
  it('AC-2: sizes are whole MB under 1 GB and one decimal GB above, with a non-breaking space', () => {
    expect(formatModelSize(564_000_000, 'hu')).toBe('564 MB')
    expect(formatModelSize(1_068_482_488, 'hu')).toBe('1,1 GB')
    expect(formatModelSize(1_068_482_488, 'en')).toBe('1.1 GB')
    expect(formatModelSize(999_400_000, 'en')).toBe('999 MB')
  })
})

describe('009-transcription-models: models in Settings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC-2: with transcription on, both models show with name, description and size, and the active one is in use without buttons', async () => {
    stubApi({
      ...base,
      [admin]: () => json(status([row(turbo, 'downloaded'), row(large, 'not_downloaded')])),
    })
    renderApp('/settings')

    expect(await screen.findByText('Transcription engine')).toBeInTheDocument()
    const turboRow = rowOf('Turbo')
    expect(turboRow.getByText('Fast, a good default.')).toBeInTheDocument()
    expect(turboRow.getByText('564 MB download')).toBeInTheDocument()
    expect(turboRow.getByText('In use')).toBeInTheDocument()
    expect(turboRow.queryByRole('button')).not.toBeInTheDocument()
    const largeRow = rowOf('Large-v3')
    expect(largeRow.getByText('1.1 GB download')).toBeInTheDocument()
    expect(largeRow.getByText('Not downloaded')).toBeInTheDocument()
    expect(largeRow.getByRole('button', { name: 'Use' })).toBeEnabled()
    expect(largeRow.getByRole('button', { name: 'Download' })).toBeEnabled()
  })

  it('AC-2: with transcription off no model list shows', async () => {
    stubApi({
      ...base,
      [admin]: () =>
        json(
          status([row(turbo, 'not_downloaded'), row(large, 'not_downloaded')], {
            enabled: false,
            state: 'off',
            downloadedBytes: 0,
          }),
        ),
    })
    renderApp('/settings')

    expect(await screen.findByRole('switch', { name: 'Transcription' })).not.toBeChecked()
    expect(screen.queryByText('Transcription engine')).not.toBeInTheDocument()
    expect(screen.queryByTestId('model-row')).not.toBeInTheDocument()
  })

  it('AC-3: Download asks for the download only, and the row shows live progress and then Downloaded', async () => {
    let current = status([row(turbo, 'downloaded'), row(large, 'not_downloaded')])
    const calls = stubApi({
      ...base,
      [admin]: () => json(current),
      [`POST ${modelPath(large)}/download`]: () =>
        json(status([row(turbo, 'downloaded'), row(large, 'downloading')])),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await user.click(
      await within(await screen.findByRole('group', { name: 'Local' })).findByRole('button', {
        name: 'Download',
      }),
    )

    expect(calls.some(({ key }) => key === `POST ${modelPath(large)}/download`)).toBe(true)
    expect(await screen.findByText('Downloading model…')).toBeInTheDocument()
    expect(screen.queryByText(/switch to it once/)).not.toBeInTheDocument()

    current = status([
      row(turbo, 'downloaded'),
      row(large, 'downloading', { downloadedBytes: 550_000_000 }),
    ])
    act(() => {
      FakeEventSource.instances[0]?.emit('model.updated', {
        type: 'model.updated',
        providers: providerRows(),
        state: 'ready',
        downloadedBytes: 564_000_000,
        totalBytes: 564_000_000,
        activeEngine: turbo,
        models: [
          row(turbo, 'downloaded'),
          row(large, 'downloading', { downloadedBytes: 550_000_000 }),
        ],
      })
    })
    expect(await screen.findByText('550 MB / 1100 MB · 50%')).toBeInTheDocument()

    current = status([row(turbo, 'downloaded'), row(large, 'downloaded')])
    act(() => {
      FakeEventSource.instances[0]?.emit('model.updated', {
        type: 'model.updated',
        providers: providerRows(),
        state: 'ready',
        downloadedBytes: 564_000_000,
        totalBytes: 564_000_000,
        activeEngine: turbo,
        models: [row(turbo, 'downloaded'), row(large, 'downloaded')],
      })
    })
    await waitFor(() => {
      expect(rowOf('Large-v3').getByText('Downloaded')).toBeInTheDocument()
    })
    expect(rowOf('Turbo').getByText('In use')).toBeInTheDocument()
  })

  it('AC-4: Use on a model that is not downloaded says it will switch once it is downloaded', async () => {
    const calls = stubApi({
      ...base,
      [admin]: () => json(status([row(turbo, 'downloaded'), row(large, 'not_downloaded')])),
      [`POST ${modelPath(large)}/use`]: () =>
        json(status([row(turbo, 'downloaded'), row(large, 'downloading', { useWhenReady: true })])),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await user.click(
      await within(await screen.findByRole('group', { name: 'Local' })).findByRole('button', {
        name: 'Use',
      }),
    )

    expect(await screen.findByText("We'll switch to it once it's downloaded.")).toBeInTheDocument()
    expect(calls.some(({ key }) => key === `POST ${modelPath(large)}/use`)).toBe(true)
  })

  it('AC-5: Use on a downloaded model switches and the chip moves', async () => {
    let current = status([row(turbo, 'downloaded'), row(large, 'downloaded')])
    stubApi({
      ...base,
      [admin]: () => json(current),
      [`POST ${modelPath(large)}/use`]: () => {
        current = status([row(turbo, 'downloaded'), row(large, 'downloaded')], {
          activeEngine: large,
        })
        return json(current)
      },
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    await user.click(rowOf('Large-v3').getByRole('button', { name: 'Use' }))

    await waitFor(() => {
      expect(rowOf('Large-v3').getByText('In use')).toBeInTheDocument()
    })
    expect(rowOf('Turbo').getByText('Downloaded')).toBeInTheDocument()
  })

  it('AC-6: while one model downloads, Use and Download on the other row are disabled, but a downloaded row can still be used', async () => {
    stubApi({
      ...base,
      [admin]: () =>
        json(
          status(
            [
              row(turbo, 'downloading', { downloadedBytes: 100_000_000 }),
              row(large, 'not_downloaded'),
            ],
            {
              state: 'downloading',
              downloadedBytes: 100_000_000,
            },
          ),
        ),
    })
    renderApp('/settings')
    await screen.findByText('Transcription engine')

    const largeRow = rowOf('Large-v3')
    expect(largeRow.getByRole('button', { name: 'Use' })).toBeDisabled()
    expect(largeRow.getByRole('button', { name: 'Download' })).toBeDisabled()
    expect(rowOf('Turbo').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '17')
  })

  it('AC-7: Delete asks first, Cancel changes nothing and Delete removes the files', async () => {
    let current = status([row(turbo, 'downloaded'), row(large, 'downloaded')])
    const calls = stubApi({
      ...base,
      [admin]: () => json(current),
      [`DELETE ${modelPath(large)}`]: () => {
        current = status([row(turbo, 'downloaded'), row(large, 'not_downloaded')])
        return json(current)
      },
    })
    const user = userEvent.setup()
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    expect(rowOf('Turbo').queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()

    await user.click(rowOf('Large-v3').getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete the Large-v3 model?' })
    expect(
      within(dialog).getByText(
        'Its files (1.8 GB) are removed from the server. You can download it again later.',
      ),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(calls.some(({ key }) => key.startsWith('DELETE'))).toBe(false)

    await user.click(rowOf('Large-v3').getByRole('button', { name: 'Delete' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    )
    await waitFor(() => {
      expect(rowOf('Large-v3').getByText('Not downloaded')).toBeInTheDocument()
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('AC-9: a failed download shows the error and Try again repeats the same action', async () => {
    const calls = stubApi({
      ...base,
      [admin]: () =>
        json(
          status([
            row(turbo, 'downloaded'),
            row(large, 'failed', { useWhenReady: true, error: 'download_failed' }),
          ]),
        ),
      [`POST ${modelPath(large)}/use`]: () =>
        json(status([row(turbo, 'downloaded'), row(large, 'downloading', { useWhenReady: true })])),
    })
    const user = userEvent.setup()
    renderApp('/settings')
    expect(await screen.findByRole('alert')).toHaveTextContent('The model download failed.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Downloading model…')).toBeInTheDocument()
    expect(calls.some(({ key }) => key === `POST ${modelPath(large)}/use`)).toBe(true)
    expect(calls.some(({ key }) => key.endsWith('/download'))).toBe(false)
  })

  it('AC-10: a full disk shows its own text', async () => {
    stubApi({
      ...base,
      [admin]: () =>
        json(status([row(turbo, 'downloaded'), row(large, 'failed', { error: 'disk_full' })])),
    })
    renderApp('/settings')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "There isn't enough disk space on the server. Free up some space and try again.",
    )
  })

  it('AC-13: a model.updated event moves the list without a reload', async () => {
    let current = status([row(turbo, 'downloaded'), row(large, 'downloaded')])
    stubApi({ ...base, [admin]: () => json(current) })
    renderApp('/settings')
    await screen.findByText('Transcription engine')
    expect(rowOf('Turbo').getByText('In use')).toBeInTheDocument()

    current = status([row(turbo, 'downloaded'), row(large, 'downloaded')], { activeEngine: large })
    act(() => {
      FakeEventSource.instances[0]?.emit('model.updated', {
        type: 'model.updated',
        providers: providerRows(),
        state: 'ready',
        downloadedBytes: 564_000_000,
        totalBytes: 1_100_000_000,
        activeEngine: large,
        models: [row(turbo, 'downloaded'), row(large, 'downloaded')],
      })
    })
    await waitFor(() => {
      expect(rowOf('Large-v3').getByText('In use')).toBeInTheDocument()
    })
    expect(rowOf('Turbo').getByText('Downloaded')).toBeInTheDocument()
  })

  it('AC-25: a user who is not an admin sees no model list', async () => {
    stubApi({
      'GET /api/v1/setup': () => json({ needed: false }),
      'GET /api/v1/me': () => json({ ...me, isAdmin: false }),
    })
    renderApp('/settings')
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.queryByText('Transcription engine')).not.toBeInTheDocument()
  })
})

describe('009-transcription-models: recording card', () => {
  const play = vi.fn(() => Promise.resolve())
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
    recording({
      transcript: { ...recording().transcript, model, ...extra },
    })
  const availability = (state: string) => ({
    'GET /api/v1/transcription': () => json({ state, engine: { id: turbo, kind: 'local' } }),
  })
  const again = 'POST /api/v1/recordings/r1/retranscribe'

  beforeEach(async () => {
    await i18n.changeLanguage('en')
    HTMLMediaElement.prototype.play = play
    HTMLMediaElement.prototype.pause = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC-17: the menu opens with a click, Enter, Space or Arrow Down, focuses the item and closes with Escape or a click outside', async () => {
    stubApi({
      ...signedIn,
      ...availability('ready'),
      'GET /api/v1/entries/e1/recordings': () => json([withModel(turbo)]),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    const button = await screen.findByRole('button', { name: 'Recording actions' })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    for (const key of ['{Enter}', ' ', '{ArrowDown}']) {
      button.focus()
      await user.keyboard(key)
      const item = await screen.findByRole('menuitem', { name: 'Transcribe again' })
      expect(button).toHaveAttribute('aria-expanded', 'true')
      expect(item).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(button).toHaveFocus()
    }

    await user.click(button)
    await screen.findByRole('menu')
    await user.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('AC-18: the old text stays muted under "Transcribing again…" with no edit button, and the new label shows when it is done', async () => {
    let current = [withModel(turbo)]
    const calls = stubApi({
      ...signedIn,
      ...availability('ready'),
      'GET /api/v1/entries/e1/recordings': () => json(current),
      [again]: () =>
        json(recording({ status: 'pending', transcript: withModel(turbo).transcript })),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    expect(await screen.findByText('Turbo')).toBeInTheDocument()
    expect(screen.getByText('Model:', { exact: false })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Recording actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Transcribe again' }))

    expect(calls.find(({ key }) => key === again)?.body).toEqual({})
    expect(await screen.findByRole('status')).toHaveTextContent('Transcribing again…')
    expect(screen.getByTestId('transcript')).toHaveClass('old')
    expect(screen.getByTestId('transcript')).toHaveTextContent('Ma reggel korán keltem.')
    expect(screen.queryByRole('button', { name: 'Edit transcript' })).not.toBeInTheDocument()

    current = [withModel(large, { text: 'Új szöveg.' })]
    act(() => {
      FakeEventSource.instances[0]?.emit('recording.updated', {
        type: 'recording.updated',
        entryId: 'e1',
        recordingId: 'r1',
        status: 'done',
      })
    })
    expect(await screen.findByText('Új szöveg.')).toBeInTheDocument()
    expect(screen.getByText('Large-v3')).toBeInTheDocument()
    expect(screen.queryByText('Transcribing again…')).not.toBeInTheDocument()
  })

  it('AC-19: an edited transcript asks first, the dialog sends replaceEdited and Cancel sends nothing', async () => {
    const calls = stubApi({
      ...signedIn,
      ...availability('ready'),
      'GET /api/v1/entries/e1/recordings': () => json([withModel(turbo, { isUserEdited: true })]),
      [again]: () =>
        json(recording({ status: 'pending', transcript: withModel(turbo).transcript })),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Recording actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Transcribe again' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Replace your edits?' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(calls.some(({ key }) => key === again)).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Recording actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Transcribe again' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Transcribe again' }),
    )
    await waitFor(() => {
      expect(calls.find(({ key }) => key === again)?.body).toEqual({ replaceEdited: true })
    })
  })

  it.each([
    ['off', 'Transcription is off.'],
    ['not_ready', 'No model is downloaded yet.'],
  ])(
    'AC-20: with availability %s the item is disabled with its hint and does nothing',
    async (state, hint) => {
      const calls = stubApi({
        ...signedIn,
        ...availability(state),
        'GET /api/v1/entries/e1/recordings': () => json([withModel(turbo)]),
      })
      const user = userEvent.setup()
      renderApp('/entries/e1')
      await user.click(await screen.findByRole('button', { name: 'Recording actions' }))
      const item = await screen.findByRole('menuitem', { name: new RegExp(hint) })
      await waitFor(() => {
        expect(item).toHaveAttribute('aria-disabled', 'true')
      })
      expect(item).toHaveAccessibleDescription(hint)
      await user.click(item)
      expect(calls.some(({ key }) => key === again)).toBe(false)
    },
  )

  it('AC-20: while the recording is being transcribed the item says so', async () => {
    stubApi({
      ...signedIn,
      ...availability('ready'),
      'GET /api/v1/entries/e1/recordings': () =>
        json([recording({ status: 'transcribing', transcript: withModel(turbo).transcript })]),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Recording actions' }))
    const item = await screen.findByRole('menuitem', { name: /already being transcribed/ })
    expect(item).toHaveAttribute('aria-disabled', 'true')
  })

  it('AC-20: a 409 from the server shows its text on the card', async () => {
    stubApi({
      ...signedIn,
      ...availability('ready'),
      'GET /api/v1/entries/e1/recordings': () => json([withModel(turbo)]),
      [again]: () => json({ error: { code: 'model_not_ready', message: 'x' } }, 409),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Recording actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Transcribe again' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Transcription isn't available right now.",
    )
  })

  it('AC-20: a 409 on a failed card without a transcript shows its text, and the item waits for the availability answer', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/transcription': () => new Promise<Response>(() => undefined),
      'GET /api/v1/entries/e1/recordings': () =>
        json([recording({ status: 'failed', transcript: null })]),
      [again]: () => json({ error: { code: 'model_not_ready', message: 'x' } }, 409),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Recording actions' }))
    const item = await screen.findByRole('menuitem', { name: 'Transcribe again' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    await user.click(item)
    expect(screen.queryByText("Transcription isn't available right now.")).not.toBeInTheDocument()
  })

  it('AC-20: a 409 on a failed card without a transcript shows its text', async () => {
    stubApi({
      ...signedIn,
      ...availability('ready'),
      'GET /api/v1/entries/e1/recordings': () =>
        json([recording({ status: 'failed', transcript: null })]),
      [again]: () => json({ error: { code: 'model_not_ready', message: 'x' } }, 409),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Recording actions' }))
    const item = await screen.findByRole('menuitem', { name: 'Transcribe again' })
    await waitFor(() => {
      expect(item).not.toHaveAttribute('aria-disabled')
    })
    await user.click(item)
    expect(await screen.findByText("Transcription isn't available right now.")).toBeInTheDocument()
  })

  it('AC-21: a failed transcribe again keeps the old text, can be edited and Try again does the same as the menu', async () => {
    const calls = stubApi({
      ...signedIn,
      ...availability('ready'),
      'GET /api/v1/entries/e1/recordings': () =>
        json([
          recording({
            status: 'failed',
            transcript: withModel(turbo, { isUserEdited: true }).transcript,
          }),
        ]),
      [again]: () => json(recording({ status: 'pending' })),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')

    const failed = await screen.findByRole('alert')
    expect(failed).toHaveTextContent('Transcribing again failed.')
    expect(failed).toHaveTextContent('The earlier transcript is still here. Try again.')
    expect(screen.getByTestId('transcript')).toHaveTextContent('Ma reggel korán keltem.')
    expect(screen.getByRole('button', { name: 'Edit transcript' })).toBeInTheDocument()

    await user.click(within(failed).getByRole('button', { name: 'Try again' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Replace your edits?' })
    await user.click(within(dialog).getByRole('button', { name: 'Transcribe again' }))
    await waitFor(() => {
      expect(calls.find(({ key }) => key === again)?.body).toEqual({ replaceEdited: true })
    })
  })

  it('AC-23: the meta row names the model, nothing for an unknown id, and screen readers hear the prefix', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1/recordings': () =>
        json([
          withModel(turbo),
          recording({ id: 'r2', transcript: { ...withModel(large).transcript } }),
          recording({ id: 'r3', transcript: { ...withModel('fake').transcript } }),
        ]),
    })
    renderApp('/entries/e1')
    const cards = await screen.findAllByTestId('recording-card')
    expect(cards).toHaveLength(3)
    expect(within(cards[0] as HTMLElement).getByText('Turbo')).toBeInTheDocument()
    expect(
      within(cards[0] as HTMLElement).getByText('Model:', { exact: false }),
    ).toBeInTheDocument()
    expect(within(cards[1] as HTMLElement).getByText('Large-v3')).toBeInTheDocument()
    expect(
      within(cards[2] as HTMLElement).queryByText('Model:', { exact: false }),
    ).not.toBeInTheDocument()
    expect(within(cards[2] as HTMLElement).queryByText('Turbo')).not.toBeInTheDocument()
  })
})
