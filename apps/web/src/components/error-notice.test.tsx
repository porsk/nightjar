import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import '../i18n/index.ts'
import { ErrorNotice } from './error-notice.tsx'

describe('ErrorNotice', () => {
  it('shows the generic message in the app alert box', () => {
    render(<ErrorNotice />)
    expect(screen.getByRole('alert')).toHaveClass('alert')
    expect(screen.getByRole('alert')).toHaveTextContent(/\S/)
  })

  it('on its own page it sits inside the bare layout with the brand', () => {
    const { container } = render(<ErrorNotice bare />)
    expect(container.querySelector('main.bare .bare-brand')).not.toBeNull()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
