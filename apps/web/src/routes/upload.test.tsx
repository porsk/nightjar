import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { FakeXhr, entryBody, installXhrFake, recording } from '../test-browser.ts'
import { json, me, renderApp, stubApi } from '../test-utils.tsx'

const signedIn = {
  'GET /api/v1/setup': () => json({ needed: false }),
  'GET /api/v1/me': () => json(me),
  'GET /api/v1/entries/e1': () => json(entryBody),
  'GET /api/v1/entries/e1/recordings': () => json([recording()]),
}

class FakeAudio {
  preload = ''
  duration = Number.NaN
  onloadedmetadata: (() => void) | null = null
  set src(_value: string) {
    queueMicrotask(() => {
      this.duration = 124
      this.onloadedmetadata?.()
    })
  }
}

const memo = () => {
  const file = new File(['voice'], 'hangjegyzet.m4a', {
    type: 'audio/mp4',
    lastModified: Date.parse('2026-11-20T10:00:00Z'),
  })
  Object.defineProperty(file, 'size', { value: 3_200_000 })
  return file
}

const picker = () => document.querySelector<HTMLInputElement>('input[type="file"]')

describe('003-voice-entries: upload screen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-26T20:30:00Z'))
    installXhrFake()
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('AC-8: choosing a file shows its name, size and length, with the default language and the date of the file', async () => {
    stubApi(signedIn)
    const user = userEvent.setup()
    renderApp('/upload')
    expect(await screen.findByRole('heading', { name: 'Upload an audio file' })).toBeInTheDocument()
    expect(
      screen.getByText('Drop the file here, or choose it from your device.'),
    ).toBeInTheDocument()

    await user.upload(picker() as HTMLInputElement, memo())

    expect(screen.getByText('hangjegyzet.m4a')).toBeInTheDocument()
    expect(await screen.findByText('3.2 MB · 2:04')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'English' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Friday, November 20, 2026' })).toBeInTheDocument()
  })

  it('AC-8: a dropped file is accepted too', async () => {
    stubApi(signedIn)
    renderApp('/upload')
    await screen.findByRole('heading', { name: 'Upload an audio file' })

    fireEvent.drop(document.querySelector('.drop') as Element, {
      dataTransfer: { files: [memo()] },
    })

    expect(await screen.findByText('hangjegyzet.m4a')).toBeInTheDocument()
  })

  it('AC-8: uploading sends the language and day, shows progress, and Cancel aborts', async () => {
    stubApi(signedIn)
    const user = userEvent.setup()
    renderApp('/upload')
    await screen.findByRole('heading', { name: 'Upload an audio file' })
    await user.upload(picker() as HTMLInputElement, memo())
    await user.click(screen.getByRole('radio', { name: 'Magyar' }))

    await user.click(screen.getByRole('button', { name: 'Upload' }))
    expect(FakeXhr.instances).toHaveLength(1)
    const sent = FakeXhr.instances[0]
    expect(sent?.body?.get('language')).toBe('hu')
    expect(sent?.body?.get('entryDate')).toBe('2026-11-20')
    expect(sent?.body?.get('entryId')).toBeNull()

    act(() => {
      sent?.progress(64, 100)
    })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '64')
    expect(screen.getByText('Uploading: 64%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(sent?.aborted).toBe(true)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
  })

  it('AC-8: a finished upload opens the new entry', async () => {
    stubApi(signedIn)
    const user = userEvent.setup()
    renderApp('/upload')
    await screen.findByRole('heading', { name: 'Upload an audio file' })
    await user.upload(picker() as HTMLInputElement, memo())
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    await act(async () => {
      FakeXhr.instances[0]?.respond(201, recording())
      await Promise.resolve()
    })

    expect(await screen.findByTestId('recording-card')).toBeInTheDocument()
  })

  it('AC-8: from an entry the recording is added to it and no day is asked', async () => {
    stubApi(signedIn)
    const user = userEvent.setup()
    renderApp('/upload?entry=e1')
    await screen.findByRole('heading', { name: 'Upload an audio file' })
    expect(screen.getByText('The recording is added to this entry.')).toBeInTheDocument()
    await user.upload(picker() as HTMLInputElement, memo())

    expect(screen.queryByText('Which day is it about?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    expect(FakeXhr.instances[0]?.body?.get('entryId')).toBe('e1')
    expect(FakeXhr.instances[0]?.body?.get('entryDate')).toBeNull()
  })

  it('AC-9: a refused file shows what is wrong and can be tried again', async () => {
    stubApi(signedIn)
    const user = userEvent.setup()
    renderApp('/upload')
    await screen.findByRole('heading', { name: 'Upload an audio file' })
    await user.upload(picker() as HTMLInputElement, memo())
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    await act(async () => {
      FakeXhr.instances[0]?.respond(415, { error: { code: 'unsupported_audio', message: 'x' } })
      await Promise.resolve()
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This file isn't a supported audio format.",
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled()
    })
  })

  it('AC-9: a file that is too large shows the size limit', async () => {
    stubApi(signedIn)
    const user = userEvent.setup()
    renderApp('/upload')
    await screen.findByRole('heading', { name: 'Upload an audio file' })
    await user.upload(picker() as HTMLInputElement, memo())
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    await act(async () => {
      FakeXhr.instances[0]?.respond(413, { error: { code: 'file_too_large', message: 'x' } })
      await Promise.resolve()
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file is too large (200 MB max).',
    )
  })
})
