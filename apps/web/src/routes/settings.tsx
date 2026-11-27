import { nameSchema, type EntryLanguage, type Language, type Me } from '@nightjar/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ApiError, meQuery, signOut, updateSettings } from '../api.ts'
import { Icon } from '../components/icon.tsx'
import { Segmented } from '../components/segmented.tsx'
import { TranscriptionSettings } from '../components/transcription-settings.tsx'
import { browserLanguage } from '../i18n/index.ts'
import { timeZoneOptions } from '../time-zones.ts'

type Failure = 'settings.saveFailed' | 'error.invalid_time_zone'

const uiLanguages: { value: Language; label: string }[] = [
  { value: 'hu', label: 'Magyar' },
  { value: 'en', label: 'English' },
]

function PersonalSettings({ me }: { me: Me }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<Failure>()
  const timeZones = useMemo(() => timeZoneOptions(new Date(), me.timeZone), [me.timeZone])

  const save = useMutation({
    mutationFn: updateSettings,
    onMutate: (patch) => {
      setFailure(undefined)
      const previous = queryClient.getQueryData(meQuery.queryKey)
      queryClient.setQueryData(meQuery.queryKey, { ...me, ...patch })
      return { previous }
    },
    onError: (error, _patch, context) => {
      queryClient.setQueryData(meQuery.queryKey, context?.previous)
      setFailure(
        error instanceof ApiError && error.code === 'invalid_time_zone'
          ? 'error.invalid_time_zone'
          : 'settings.saveFailed',
      )
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(meQuery.queryKey, saved)
    },
  })

  const entryLanguages: { value: EntryLanguage; label: string }[] = [
    ...uiLanguages,
    { value: 'auto', label: t('settings.auto') },
  ]

  return (
    <>
      <h2 className="sec">{t('settings.personal')}</h2>
      {failure ? (
        <div className="alert" role="alert">
          <Icon name="alert" />
          <span>{t(failure)}</span>
        </div>
      ) : null}
      <div className="group">
        <div className="srow">
          <div className="fl" id="ui-language-label">
            {t('settings.uiLanguage')}
          </div>
          <Segmented
            name="uiLanguage"
            labelledBy="ui-language-label"
            options={uiLanguages}
            value={me.uiLanguage}
            onChange={(uiLanguage) => {
              save.mutate({ uiLanguage })
            }}
          />
        </div>
        <div className="srow">
          <div className="fl" id="entry-language-label">
            {t('settings.entryLanguage')}
          </div>
          <Segmented
            name="entryLanguage"
            labelledBy="entry-language-label"
            options={entryLanguages}
            value={me.entryLanguage}
            onChange={(entryLanguage) => {
              save.mutate({ entryLanguage })
            }}
          />
          <p className="hint">{t('settings.entryLanguageHint')}</p>
        </div>
        <div className="srow">
          <label className="fl" htmlFor="timeZone">
            {t('settings.timeZone')}
          </label>
          <div className="inp sel">
            <select
              id="timeZone"
              value={me.timeZone}
              onChange={(event) => {
                save.mutate({ timeZone: event.target.value })
              }}
            >
              {timeZones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </select>
            <Icon name="down" />
          </div>
        </div>
      </div>
    </>
  )
}

function NameField({ me }: { me: Me }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState(me.name)
  const [error, setError] = useState<string>()

  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(meQuery.queryKey, saved)
      setName(saved.name)
    },
    onError: () => {
      setName(me.name)
      setError(t('settings.saveFailed'))
    },
  })

  const commit = () => {
    setError(undefined)
    const parsed = nameSchema.safeParse(name)
    if (!parsed.success) {
      setError(t('field.error.name'))
      return
    }
    if (parsed.data !== me.name) save.mutate({ name: parsed.data })
  }

  return (
    <div className="srow">
      <label className="fl" htmlFor="name">
        {t('field.name')}
      </label>
      <div className="inp" data-invalid={error ? 'true' : undefined}>
        <input
          id="name"
          autoComplete="given-name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'name-error' : undefined}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
        />
      </div>
      {error ? (
        <p className="field-error" id="name-error">
          <Icon name="alert" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

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
      {me.data ? <PersonalSettings me={me.data} /> : null}
      {me.data?.isAdmin ? <TranscriptionSettings /> : null}
      <h2 className="sec">{t('settings.account')}</h2>
      <div className="group">
        {me.data ? <NameField key={me.data.name} me={me.data} /> : null}
        <div className="srow acct">
          <span>{me.data?.username}</span>
          <button className="btn sm line" type="button" onClick={() => void logout()}>
            <Icon name="out" />
            {t('auth.logout')}
          </button>
        </div>
      </div>
    </>
  )
}
