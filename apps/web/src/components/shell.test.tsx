import { screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { json, me, renderApp, stubApi } from '../test-utils.tsx'

const emptyPage = () => json({ items: [], nextCursor: null })

const entry = {
  id: 'e1',
  entryDate: '2026-11-25',
  bodyMd: 'text',
  createdAt: '2026-11-25T20:30:00.000Z',
  updatedAt: '2026-11-25T20:30:00.000Z',
}

describe('004-timeline: navigation', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    stubApi({
      'GET /api/v1/setup': () => json({ needed: false }),
      'GET /api/v1/me': () => json(me),
      'GET /api/v1/entries?limit=30': emptyPage,
      'GET /api/v1/entries?date=2026-11-26': emptyPage,
      'GET /api/v1/entries/e1': () => json(entry),
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-26T20:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const navigations = () => screen.getAllByRole('navigation', { name: 'Main navigation' })
  const tabBar = () => navigations().find((nav) => nav.classList.contains('tabs'))
  const sidebar = () => navigations().find((nav) => nav.classList.contains('side')) as HTMLElement

  it('AC-9: the tab bar and the sidebar list Today, Timeline, Search and Settings', async () => {
    renderApp('/timeline')
    await screen.findByRole('heading', { name: 'Timeline', level: 1 })
    for (const nav of [tabBar(), sidebar()]) {
      const labels = within(nav as HTMLElement)
        .getAllByRole('link')
        .map((link) => link.textContent)
      expect(labels.slice(0, 4)).toEqual(['Today', 'Timeline', 'Search', 'Settings'])
    }
  })

  it.each([
    ['/', 'Today'],
    ['/timeline', 'Timeline'],
    ['/settings', 'Settings'],
  ])('AC-9: on %s the current item is %s', async (path, label) => {
    renderApp(path)
    await screen.findAllByRole('heading')
    for (const nav of [tabBar(), sidebar()]) {
      const current = within(nav as HTMLElement)
        .getAllByRole('link')
        .filter((link) => link.hasAttribute('aria-current'))
      expect(current.map((link) => link.textContent)).toEqual([label])
    }
  })

  it('AC-9: the tab bar is gone on the writer, the entry page, the recorder and the upload screen', async () => {
    for (const path of ['/write', '/entries/e1', '/record', '/upload']) {
      const view = renderApp(path)
      await screen.findAllByRole('link', { name: /Today/ })
      expect(tabBar(), path).toBeUndefined()
      view.unmount()
    }
    renderApp('/timeline')
    await screen.findByRole('heading', { name: 'Timeline', level: 1 })
    expect(tabBar()).toBeDefined()
  })

  it('AC-9: the sidebar button "New recording" is hidden on Home and on the recorder only', async () => {
    const hidden = ['/', '/record']
    for (const path of ['/', '/record', '/timeline', '/settings', '/write', '/entries/e1']) {
      const view = renderApp(path)
      await screen.findAllByRole('link', { name: /Today/ })
      const button = within(sidebar()).queryByRole('link', { name: 'New recording' })
      if (hidden.includes(path)) expect(button, path).toBeNull()
      else expect(button, path).toBeInTheDocument()
      view.unmount()
    }
  })
})
