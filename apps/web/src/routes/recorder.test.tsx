import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import {
  FakeMediaRecorder,
  FakeXhr,
  entryBody,
  installRecorderFakes,
  installXhrFake,
  microphone,
  recording,
} from '../test-browser.ts'
import { json, me, renderApp, stubApi } from '../test-utils.tsx'

const signedIn = {
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(me),
}

const entryPage = {
  'GET /api/v1/entries/e1': () => json(entryBody),
  'GET /api/v1/entries/e1/recordings': () => json([recording()]),
}

const elapsed = () => screen.getByRole('timer', { name: 'Elapsed time' })
const barHeights = () =>
  [...screen.getByTestId('meter').children].map((bar) => (bar as HTMLElement).style.height)

describe('003-voice-entries: recorder', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.useFakeTimers({ toFake: ['performance', 'Date'] })
    vi.setSystemTime(new Date('2026-11-26T20:30:00Z'))
    installXhrFake()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    microphone.level = 0
  })

  const advance = (milliseconds: number) => vi.advanceTimersByTime(milliseconds)

  it('AC-1: opening the recorder starts recording, the timer counts up and the meter follows the microphone', async () => {
    installRecorderFakes()
    stubApi(signedIn)
    renderApp('/record')

    expect(await screen.findByText('Recording')).toBeInTheDocument()
    await waitFor(() => {
      expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')
    })
    expect(elapsed()).toHaveTextContent('00:00')
    const quiet = barHeights().at(-1)

    advance(5000)
    await waitFor(() => {
      expect(elapsed()).toHaveTextContent('00:05')
    })

    for (const analyser of microphone.analysers) analyser.level = 60
    await waitFor(() => {
      expect(barHeights().at(-1)).not.toBe(quiet)
    })
  })

  it('AC-2: pausing stops the timer and shows the paused state, resuming goes on', async () => {
    installRecorderFakes()
    stubApi(signedIn)
    const user = userEvent.setup({ advanceTimers: advance })
    renderApp('/record')
    await screen.findByText('Recording')
    await waitFor(() => {
      expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')
    })

    advance(3000)
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(FakeMediaRecorder.instances[0]?.state).toBe('paused')
    expect(elapsed()).toHaveTextContent('00:03')

    advance(10_000)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(elapsed()).toHaveTextContent('00:03')

    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByText('Recording')).toBeInTheDocument()
    advance(2000)
    await waitFor(() => {
      expect(elapsed()).toHaveTextContent('00:05')
    })
  })

  it('AC-3: stopping uploads the audio for a new entry of today and opens the entry page', async () => {
    installRecorderFakes()
    stubApi({ ...signedIn, ...entryPage })
    const user = userEvent.setup({ advanceTimers: advance })
    renderApp('/record')
    await screen.findByText('Recording')
    await waitFor(() => {
      expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')
    })

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1)
    })
    const sent = FakeXhr.instances[0]
    expect(sent?.method).toBe('POST')
    expect(sent?.url).toBe('/api/v1/recordings')
    expect(sent?.body?.get('language')).toBe('en')
    expect(sent?.body?.get('entryDate')).toBe('2026-11-26')
    expect(sent?.body?.get('entryId')).toBeNull()
    expect(sent?.body?.get('file')).toBeInstanceOf(Blob)

    await act(async () => {
      sent?.respond(201, recording())
      await Promise.resolve()
    })
    expect(
      await screen.findByRole('heading', { name: 'Thursday, November 26, 2026' }),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('recording-card')).toBeInTheDocument()
  })

  it('AC-3: a recording started from an entry is added to that entry', async () => {
    installRecorderFakes()
    stubApi({ ...signedIn, ...entryPage })
    const user = userEvent.setup({ advanceTimers: advance })
    renderApp('/record?entry=e1')
    await screen.findByText('Recording')
    await waitFor(() => {
      expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')
    })

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1)
    })
    expect(FakeXhr.instances[0]?.body?.get('entryId')).toBe('e1')
    expect(FakeXhr.instances[0]?.body?.get('entryDate')).toBeNull()
  })

  it('AC-4: discarding asks first, keeping goes on recording and confirming uploads nothing and goes back', async () => {
    const fakes = installRecorderFakes()
    stubApi(signedIn)
    const user = userEvent.setup({ advanceTimers: advance })
    renderApp(['/', '/record'])
    await screen.findByText('Recording')
    await waitFor(() => {
      expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')
    })

    await user.click(screen.getByRole('button', { name: 'Discard' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Discard the recording?' })
    expect(within(dialog).getByText("The audio won't be saved.")).toBeInTheDocument()
    expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')

    await user.click(within(dialog).getByRole('button', { name: 'Keep recording' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')

    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard' }),
    )
    expect(await screen.findByRole('heading', { name: /on your mind/ })).toBeInTheDocument()
    expect(FakeXhr.instances).toHaveLength(0)
    expect(fakes.track.stop).toHaveBeenCalled()
    expect(FakeMediaRecorder.instances[0]?.state).toBe('inactive')
  })

  for (const error of ['NotAllowedError', 'NotFoundError']) {
    it(`AC-5: ${error} shows how to allow the microphone and a way back, and records nothing`, async () => {
      installRecorderFakes({ error })
      stubApi(signedIn)
      const user = userEvent.setup({ advanceTimers: advance })
      renderApp(['/', '/record'])

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "The microphone isn't available. Allow it in your browser settings and try again.",
      )
      expect(FakeMediaRecorder.instances).toHaveLength(0)
      expect(screen.queryByRole('timer')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Back' }))
      expect(await screen.findByRole('heading', { name: /on your mind/ })).toBeInTheDocument()
    })
  }

  it('AC-6: a failed upload keeps the audio and a retry uploads the same recording', async () => {
    installRecorderFakes()
    stubApi({ ...signedIn, ...entryPage })
    const user = userEvent.setup({ advanceTimers: advance })
    renderApp('/record')
    await screen.findByText('Recording')
    await waitFor(() => {
      expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')
    })
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1)
    })
    const firstFile = FakeXhr.instances[0]?.body?.get('file') as Blob

    await act(async () => {
      FakeXhr.instances[0]?.respond(503, { error: { code: 'internal_error', message: 'x' } })
      await Promise.resolve()
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't save the recording. The audio is still here, try again.",
    )

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(2)
    })
    const secondFile = FakeXhr.instances[1]?.body?.get('file') as Blob
    expect(secondFile.size).toBe(firstFile.size)
    await act(async () => {
      FakeXhr.instances[1]?.respond(201, recording())
      await Promise.resolve()
    })
    expect(await screen.findByTestId('recording-card')).toBeInTheDocument()
  })

  it('AC-6: a network error is treated the same way', async () => {
    installRecorderFakes()
    stubApi(signedIn)
    const user = userEvent.setup({ advanceTimers: advance })
    renderApp('/record')
    await screen.findByText('Recording')
    await waitFor(() => {
      expect(FakeMediaRecorder.instances[0]?.state).toBe('recording')
    })
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => {
      expect(FakeXhr.instances).toHaveLength(1)
    })
    await act(async () => {
      FakeXhr.instances[0]?.fail()
      await Promise.resolve()
    })
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('AC-7: the screen stays awake while recording and is released on stop and on discard', async () => {
    const fakes = installRecorderFakes()
    stubApi(signedIn)
    const user = userEvent.setup({ advanceTimers: advance })
    renderApp(['/', '/record'])
    await screen.findByText('Recording')
    await waitFor(() => {
      expect(fakes.wakeLock.request).toHaveBeenCalledWith('screen')
    })
    expect(fakes.wakeLock.release).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard' }),
    )
    await waitFor(() => {
      expect(fakes.wakeLock.release).toHaveBeenCalledTimes(1)
    })
  })

  it('AC-7: stopping releases the wake lock too', async () => {
    const fakes = installRecorderFakes()
    stubApi(signedIn)
    const user = userEvent.setup({ advanceTimers: advance })
    renderApp('/record')
    await screen.findByText('Recording')
    await waitFor(() => {
      expect(fakes.wakeLock.request).toHaveBeenCalled()
    })
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => {
      expect(fakes.wakeLock.release).toHaveBeenCalledTimes(1)
    })
  })
})
