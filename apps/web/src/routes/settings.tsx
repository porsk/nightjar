import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { meQuery, signOut } from '../api.ts'
import { Icon } from '../components/icon.tsx'
import { browserLanguage } from '../i18n/index.ts'

export function SettingsPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const me = useQuery(meQuery)

  const logout = async () => {
    await signOut()
    await i18n.changeLanguage(browserLanguage())
    queryClient.removeQueries({ queryKey: meQuery.queryKey })
    await navigate('/login', { replace: true })
  }

  return (
    <>
      <h1 className="title">{t('settings.title')}</h1>
      <h2 className="sec">{t('settings.account')}</h2>
      <div className="group">
        <div className="srow acct">
          <span>{me.data?.email}</span>
          <button className="btn sm line" type="button" onClick={() => void logout()}>
            <Icon name="out" />
            {t('auth.logout')}
          </button>
        </div>
      </div>
    </>
  )
}
