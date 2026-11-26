import { useEffect, useId, useRef, type ReactNode } from 'react'

const focusable =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

interface DialogProps {
  role: 'dialog' | 'alertdialog'
  title: string
  onClose: () => void
  children: ReactNode
}

/** A modal sheet: it takes focus, keeps Tab inside, closes on Escape and gives focus back. */
export function Dialog({ role, title, onClose, children }: DialogProps) {
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    const first =
      dialog.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      dialog.current?.querySelector<HTMLElement>(focusable)
    first?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialog.current) return
    const items = [...dialog.current.querySelectorAll<HTMLElement>(focusable)]
    const first = items[0]
    const last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="scrim">
      <div
        ref={dialog}
        className="dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
