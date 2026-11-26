import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Icon } from '../components/icon.tsx'

export function HomePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <>
      <h1 className="title">{t('nav.today')}</h1>
      <button
        type="button"
        className="write"
        onClick={() => {
          void navigate('/write')
        }}
      >
        <Icon name="pen" />
        {t('home.write')}
      </button>
    </>
  )
}
