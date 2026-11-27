import { useTranslation } from 'react-i18next'
import { BareLayout } from './bare-layout.tsx'
import { Icon } from './icon.tsx'

/** The app's alert box for a screen that could not load. `bare` puts it on its own page, outside the shell. */
export function ErrorNotice({ message, bare }: { message?: string; bare?: boolean }) {
  const { t } = useTranslation()
  const notice = (
    <div className="alert" role="alert">
      <Icon name="alert" />
      <span>{message ?? t('error.generic')}</span>
    </div>
  )
  return bare ? <BareLayout>{notice}</BareLayout> : notice
}
