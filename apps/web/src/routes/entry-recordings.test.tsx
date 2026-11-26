import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { entryBody, recording } from '../test-browser.ts'
import { FakeEventSource } from '../test-fakes.ts'
import { json, me, renderApp, stubApi } from '../test-utils.tsx'

const signedIn = {
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(me),
  'GET /api/v1/entries/e1': () => json(entryBody),
}

const working = recording({ status: 'transcribing', transcript: null })
const play = vi.fn(() => Promise.resolve())

describe('003-voice-entries: recording cards on the entry page', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    HTMLMediaElement.prototype.play = play
    HTMLMediaElement.prototype.pause = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC-12: a card that is being transcribed shows it, and the text appears when the server says it is done', async () => {
    let current = working
    stubApi({ ...signedIn, 'GET /api/v1/entries/e1/recordings': () => json([current]) })
    renderApp('/entries/e1')

    expect(await screen.findByText('Transcribing…')).toBeInTheDocument()
    expect(screen.queryByTestId('transcript')).not.toBeInTheDocument()

    current = recording()
    act(() => {
      FakeEventSource.instances[0]?.emit('recording.updated', {
        type: 'recording.updated',
        entryId: 'e1',
        recordingId: 'r1',
        status: 'done',
      })
    })

    expect(await screen.findByTestId('transcript')).toHaveTextContent('Ma reggel korán keltem.')
    expect(screen.queryByText('Transcribing…')).not.toBeInTheDocument()
  })

  it('AC-12: after the event stream reconnects everything is loaded again', async () => {
    let current = working
    stubApi({ ...signedIn, 'GET /api/v1/entries/e1/recordings': () => json([current]) })
    renderApp('/entries/e1')
    await screen.findByText('Transcribing…')
    const source = FakeEventSource.instances[0]
    act(() => {
      source?.emit('open', {})
    })

    current = recording()
    act(() => {
      source?.emit('open', {})
    })

    expect(await screen.findByTestId('transcript')).toBeInTheDocument()
  })

  it('AC-15: the card names the language of the transcript', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1/recordings': () =>
        json([
          recording(),
          recording({
            id: 'r2',
            language: 'auto',
            transcript: { ...recording().transcript, language: 'en', text: 'Second one.' },
          }),
        ]),
    })
    renderApp('/entries/e1')

    const cards = await screen.findAllByTestId('recording-card')
    expect(within(cards[0] as HTMLElement).getByText('Magyar')).toBeInTheDocument()
    expect(within(cards[1] as HTMLElement).getByText('English')).toBeInTheDocument()
    expect(within(cards[0] as HTMLElement).getByText('20:42')).toBeInTheDocument()
  })

  it('AC-16: a failed card says so, keeps the player and retrying shows it working again', async () => {
    const calls = stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1/recordings': () =>
        json([recording({ status: 'failed', transcript: null })]),
      'POST /api/v1/recordings/r1/retry': () =>
        json(recording({ status: 'pending', transcript: null })),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')

    expect(await screen.findByRole('alert')).toHaveTextContent('Transcription failed.')
    expect(
      screen.getByText('The recording is safe, the text is missing. Try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Transcribing…')).toBeInTheDocument()
    expect(calls.some(({ key }) => key === 'POST /api/v1/recordings/r1/retry')).toBe(true)
  })

  it('AC-17: editing a transcript saves the new text, Cancel restores the old one', async () => {
    const calls = stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1/recordings': () => json([recording()]),
      'PATCH /api/v1/recordings/r1/transcript': () =>
        json({
          ...recording().transcript,
          text: 'Ma reggel korán keltem és futottam.',
          isUserEdited: true,
        }),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Edit transcript' }))

    const box = screen.getByRole('textbox', { name: 'Edit transcript' })
    expect(box).toHaveValue('Ma reggel korán keltem.')
    expect(
      screen.getByText('Your edits are never overwritten by transcription.'),
    ).toBeInTheDocument()
    await user.clear(box)
    await user.type(box, 'Throwaway text')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('transcript')).toHaveTextContent('Ma reggel korán keltem.')

    await user.click(screen.getByRole('button', { name: 'Edit transcript' }))
    const again = screen.getByRole('textbox', { name: 'Edit transcript' })
    await user.clear(again)
    await user.type(again, 'Ma reggel korán keltem és futottam.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByTestId('transcript')).toHaveTextContent('és futottam')
    expect(calls.find(({ key }) => key.startsWith('PATCH'))?.body).toEqual({
      text: 'Ma reggel korán keltem és futottam.',
    })
  })

  it('AC-17: a failed save keeps the editor open and says so', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1/recordings': () => json([recording()]),
      'PATCH /api/v1/recordings/r1/transcript': () =>
        json({ error: { code: 'internal_error', message: 'x' } }, 500),
    })
    const user = userEvent.setup()
    renderApp('/entries/e1')
    await user.click(await screen.findByRole('button', { name: 'Edit transcript' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save the transcript.")
    expect(screen.getByRole('textbox', { name: 'Edit transcript' })).toBeInTheDocument()
  })

  it('AC-19: the player shows position and length, and plays and pauses the audio', async () => {
    stubApi({ ...signedIn, 'GET /api/v1/entries/e1/recordings': () => json([recording()]) })
    const user = userEvent.setup()
    const { container } = renderApp('/entries/e1')
    expect(await screen.findByText('0:00 / 1:48')).toBeInTheDocument()
    const audio = container.querySelector('audio')
    expect(audio).toHaveAttribute('src', '/api/v1/recordings/r1/audio')

    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(play).toHaveBeenCalled()
    fireEvent.play(audio as HTMLAudioElement)
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument()

    Object.defineProperty(audio, 'currentTime', { value: 46.4, configurable: true })
    fireEvent.timeUpdate(audio as HTMLAudioElement)
    await waitFor(() => {
      expect(screen.getByText('0:46 / 1:48')).toBeInTheDocument()
    })
  })

  it('AC-20: a recording without a transcript says it was not transcribed and points to Settings', async () => {
    stubApi({
      ...signedIn,
      'GET /api/v1/entries/e1/recordings': () =>
        json([recording({ status: 'skipped', transcript: null })]),
    })
    renderApp('/entries/e1')

    expect(await screen.findByText('Not transcribed.')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Transcription is off, so this recording has audio only. You can turn it on in Settings.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('AC-3: the entry offers another recording and an upload that go to the same entry', async () => {
    stubApi({ ...signedIn, 'GET /api/v1/entries/e1/recordings': () => json([]) })
    renderApp('/entries/e1')

    expect(await screen.findByRole('link', { name: 'Record another' })).toHaveAttribute(
      'href',
      '/record?entry=e1',
    )
    expect(screen.getByRole('link', { name: 'Upload an audio file' })).toHaveAttribute(
      'href',
      '/upload?entry=e1',
    )
    expect(screen.queryByText('Recordings')).not.toBeInTheDocument()
  })
})
