import { useTranslation } from 'react-i18next'

export function HomePage() {
  const { t } = useTranslation()
  return <h1 className="title">{t('nav.today')}</h1>
}
