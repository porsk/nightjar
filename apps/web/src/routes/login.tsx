import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type SubmitEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError, meQuery, signIn } from '../api.ts'
import { BareLayout } from '../components/bare-layout.tsx'
import { Icon } from '../components/icon.tsx'
import { TextField } from '../components/text-field.tsx'

type LoginError = 'invalid' | 'tooMany' | 'generic'

const errorKey = (error: unknown): LoginError => {
  if (!(error instanceof ApiError)) return 'generic'
  if (error.status === 429) return 'tooMany'
  return error.status === 401 ? 'invalid' : 'generic'
}

export function LoginPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const me = useQuery(meQuery)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<LoginError>()
  const [busy, setBusy] = useState(false)
  const next = (location.state as { next?: string } | null)?.next ?? '/'

  if (me.isSuccess) return <Navigate to={next} replace />

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await signIn({ email, password })
      await queryClient.query({ ...meQuery, staleTime: 0 })
      await navigate(next, { replace: true })
    } catch (caught) {
      setError(errorKey(caught))
      setBusy(false)
    }
  }

  return (
    <BareLayout>
      <h1 className="title">{t('login.title')}</h1>
      <p className="lead">{t('login.lead')}</p>
      <form onSubmit={(event) => void submit(event)} noValidate>
        {error ? (
          <div className="alert" role="alert">
            <Icon name="alert" />
            <span>{error === 'generic' ? t('error.generic') : t(`login.error.${error}`)}</span>
          </div>
        ) : null}
        <TextField
          id="email"
          label={t('field.email')}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
          }}
        />
        <TextField
          id="password"
          label={t('field.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value)
          }}
        />
        <div className="actions">
          <button className="btn block" type="submit" disabled={busy}>
            {t('login.submit')}
          </button>
        </div>
      </form>
      <p className="privacy">{t('common.privacyNote')}</p>
    </BareLayout>
  )
}
