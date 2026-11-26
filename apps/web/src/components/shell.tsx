import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation } from 'react-router'
import { Brand, Icon, type IconName } from './icon.tsx'

const items: { to: string; icon: IconName; label: 'nav.today' | 'nav.settings' }[] = [
  { to: '/', icon: 'home', label: 'nav.today' },
  { to: '/settings', icon: 'gear', label: 'nav.settings' },
]

export function Shell() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const focused = pathname === '/write' || pathname.startsWith('/entries/')
  return (
    <div className={focused ? 'app shell focused' : 'app shell'}>
      <nav className="side" aria-label={t('nav.main')}>
        <div className="brand">
          <Icon name="bird" />
          Nightjar
        </div>
        {items.map(({ to, icon, label }) => (
          <NavLink key={to} to={to} end className="nav">
            <Icon name={icon} />
            {t(label)}
          </NavLink>
        ))}
        <div className="grow" />
        <p className="privacy">{t('common.privacyNote')}</p>
      </nav>
      <main>
        <div className="col">
          <div className="page-head">
            <Brand />
          </div>
          <Outlet />
        </div>
      </main>
      <nav className="tabs" aria-label={t('nav.main')}>
        {items.map(({ to, icon, label }) => (
          <NavLink key={to} to={to} end>
            <Icon name={icon} />
            {t(label)}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
