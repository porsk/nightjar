import type { InputHTMLAttributes, ReactNode } from 'react'
import { Icon } from './icon.tsx'

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string
  label: string
  error?: string | undefined
  hint?: ReactNode
}

export function TextField({ id, label, error, hint, ...input }: TextFieldProps) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="inp" data-invalid={error ? 'true' : undefined}>
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          {...input}
        />
      </div>
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      ) : null}
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
