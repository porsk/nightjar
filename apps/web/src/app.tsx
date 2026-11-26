import { healthResponseSchema } from '@nightjar/shared'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Health = 'checking' | 'ok' | 'failed'

export function App() {
  const { t } = useTranslation()
  const [health, setHealth] = useState<Health>('checking')

  useEffect(() => {
    fetch('/healthz')
      .then((response) => response.json())
      .then((body) => {
        setHealth(healthResponseSchema.safeParse(body).success ? 'ok' : 'failed')
      })
      .catch(() => {
        setHealth('failed')
      })
  }, [])

  return (
    <main>
      <h1>{t('hello')}</h1>
      <p>{t(`health.${health}`)}</p>
    </main>
  )
}
