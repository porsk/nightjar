import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n/index.ts'
import { DateDialog } from './date-dialog.tsx'

function open(value = '2026-11-25') {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<DateDialog value={value} today="2026-11-26" onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel, user: userEvent.setup() }
}

describe('002-text-entries: date dialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('AC-5: shows the month of the date and disables days after today', () => {
    open()
    expect(screen.getByRole('dialog', { name: 'Which day is it about?' })).toBeInTheDocument()
    expect(screen.getByText('November 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '26' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '27' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '30' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '25' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('AC-5: cannot move to a month after the current one', () => {
    open()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })

  it('AC-5: picking a day and pressing Done confirms that day', async () => {
    const { onConfirm, user } = open()
    await user.click(screen.getByRole('button', { name: '20' }))
    expect(screen.getByRole('button', { name: '20' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('2026-11-20')
  })

  it('AC-5: going to the previous month shows its days, all pickable', async () => {
    const { onConfirm, user } = open()
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByText('October 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '31' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('2026-10-31')
  })

  it('AC-5: Cancel changes nothing', async () => {
    const { onConfirm, onCancel, user } = open()
    await user.click(screen.getByRole('button', { name: '20' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('AC-5: Escape cancels', async () => {
    const { onCancel, user } = open()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('AC-5: the weeks start on Monday and in Hungarian the dialog is Hungarian', async () => {
    await i18n.changeLanguage('hu')
    open()
    expect(screen.getByRole('dialog', { name: 'Melyik napról szól?' })).toBeInTheDocument()
    expect(screen.getByText('2026. november')).toBeInTheDocument()
    const first = screen.getByRole('button', { name: '1' })
    expect(first.style.gridColumnStart).toBe('7')
  })
})
