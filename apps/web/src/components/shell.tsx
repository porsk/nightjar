import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation } from 'react-router'
import { useLiveUpdates } from '../use-live-updates.ts'
import { Brand, Icon, type IconName } from './icon.tsx'
import { TodayDate } from './today-date.tsx'

const items: {
  to: string
  icon: IconName
  label: 'nav.today' | 'nav.timeline' | 'nav.search' | 'nav.settings'
}[] = [
  { to: '/', icon: 'home', label: 'nav.today' },
  { to: '/timeline', icon: 'list', label: 'nav.timeline' },
  { to: '/search', icon: 'search', label: 'nav.search' },
  { to: '/settings', icon: 'gear', label: 'nav.settings' },
]

const focusedPaths = ['/write', '/record', '/upload']

function isCurrent(to: string, pathname: string) {
  if (to === '/timeline') return pathname === to || pathname.startsWith('/entries/')
  return pathname === to
}

export function Shell() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  useLiveUpdates()
  const focused = focusedPaths.includes(pathname) || pathname.startsWith('/entries/')
  const links = (className?: string) =>
    items.map(({ to, icon, label }) => (
      <Link
        key={to}
        to={to}
        {...(className ? { className } : {})}
        {...(isCurrent(to, pathname) ? { 'aria-current': 'page' as const } : {})}
      >
        <Icon name={icon} />
        {t(label)}
      </Link>
    ))
  return (
    <div className={focused ? 'app shell focused' : 'app shell'}>
      <nav className="side" aria-label={t('nav.main')}>
        <div className="brand">
          <Icon name="bird" />
          Nightjar
        </div>
        {links('nav')}
        <div className="grow" />
        {pathname === '/' || pathname === '/record' ? null : (
          <Link to="/record" className="newrec">
            <Icon name="mic" />
            {t('nav.newRecording')}
          </Link>
        )}
        <p className="privacy">{t('common.privacyNote')}</p>
      </nav>
      <main>
        <div className="col">
          <div className="page-head">
            <Brand />
            {pathname === '/' ? <TodayDate /> : null}
          </div>
          <Outlet />
        </div>
      </main>
      {focused ? null : (
        <nav className="tabs" aria-label={t('nav.main')}>
          {links()}
        </nav>
      )}
    </div>
  )
}
