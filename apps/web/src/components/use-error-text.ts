import { useTranslation } from 'react-i18next'
import { ApiError } from '../api.ts'

/** The text for a failed request: the message for its error code when there is one, else the generic one. */
export function useErrorText() {
  const { t, i18n } = useTranslation()
  return (error: unknown) =>
    error instanceof ApiError && i18n.exists(`error.${error.code}`)
      ? t(`error.${error.code}`)
      : t('error.generic')
}
