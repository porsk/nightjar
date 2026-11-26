import { setupAccountSchema, type Language } from '@nightjar/shared'
import { useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useMemo, useState, type SubmitEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ApiError, createAccount } from '../api.ts'
import { BareLayout } from '../components/bare-layout.tsx'
import { Icon } from '../components/icon.tsx'
import { TextField } from '../components/text-field.tsx'
import { timeZoneOptions } from '../time-zones.ts'

const modelSize = '560 MB'

interface Values {
  setupCode: string
  email: string
  password: string
  passwordAgain: string
  uiLanguage: Language
  timeZone: string
  transcriptionEnabled: boolean
}

type AccountField = 'setupCode' | 'email' | 'password' | 'passwordAgain'
type Errors = Partial<Record<AccountField, string>>

const languages: { value: Language; label: string }[] = [
  { value: 'hu', label: 'Magyar' },
  { value: 'en', label: 'English' },
]

function Steps({ step }: { step: number }) {
  const { t } = useTranslation()
  return (
    <>
      <div className="stepno">{t('setup.step', { n: step })}</div>
      <div className="steps" aria-hidden="true">
        {[1, 2, 3].map((index) => (
          <i key={index} className={index <= step ? 'on' : ''} />
        ))}
      </div>
    </>
  )
}

export function SetupPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const timeZones = useMemo(() => timeZoneOptions(), [])
  const [step, setStep] = useState(1)
  const [errors, setErrors] = useState<Errors>({})
  const [submitError, setSubmitError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [values, setValues] = useState<Values>({
    setupCode: '',
    email: '',
    password: '',
    passwordAgain: '',
    uiLanguage: 'en',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    transcriptionEnabled: false,
  })

  useLayoutEffect(() => {
    void i18n.changeLanguage(values.uiLanguage)
  }, [i18n, values.uiLanguage])

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
  }

  const validateAccount = (): Errors => {
    const found: Errors = {}
    const result = setupAccountSchema.safeParse(values)
    for (const issue of result.error?.issues ?? []) {
      const field = issue.path[0]
      if (field === 'setupCode') found.setupCode = t('field.error.code')
      if (field === 'email') found.email = t('field.error.email')
      if (field === 'password') found.password = t('field.error.passwordShort')
    }
    if (!found.password && values.password !== values.passwordAgain) {
      found.passwordAgain = t('field.error.passwordMismatch')
    }
    return found
  }

  const next = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = validateAccount()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      const first = (['setupCode', 'email', 'password', 'passwordAgain'] as const).find(
        (field) => found[field],
      )
      if (first) document.getElementById(first)?.focus()
      return
    }
    setStep(2)
  }

  const finish = async () => {
    setBusy(true)
    setSubmitError(undefined)
    try {
      await createAccount({
        setupCode: values.setupCode,
        email: values.email,
        password: values.password,
        uiLanguage: values.uiLanguage,
        timeZone: values.timeZone,
        transcriptionEnabled: values.transcriptionEnabled,
      })
      queryClient.setQueryData(['setup'], { needed: false })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      await navigate('/', { replace: true })
    } catch (caught) {
      setBusy(false)
      if (caught instanceof ApiError && caught.code === 'invalid_setup_code') {
        setErrors({ setupCode: t('error.invalid_setup_code') })
        setStep(1)
      } else if (caught instanceof ApiError && caught.code === 'setup_done') {
        queryClient.setQueryData(['setup'], { needed: false })
      } else {
        setSubmitError(t('error.generic'))
      }
    }
  }

  return (
    <BareLayout>
      <Steps step={step} />
      {step === 1 ? (
        <form onSubmit={next} noValidate>
          <h1 className="title">{t('setup.account.title')}</h1>
          <p className="lead">{t('setup.account.lead')}</p>
          <TextField
            id="setupCode"
            label={t('setup.account.code')}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={values.setupCode}
            error={errors.setupCode}
            hint={<Trans i18nKey="setup.account.codeHint" components={{ code: <code /> }} />}
            onChange={(event) => {
              set('setupCode', event.target.value)
            }}
          />
          <TextField
            id="email"
            label={t('field.email')}
            type="email"
            autoComplete="username"
            value={values.email}
            error={errors.email}
            onChange={(event) => {
              set('email', event.target.value)
            }}
          />
          <TextField
            id="password"
            label={t('field.password')}
            type="password"
            autoComplete="new-password"
            value={values.password}
            error={errors.password}
            onChange={(event) => {
              set('password', event.target.value)
            }}
          />
          <TextField
            id="passwordAgain"
            label={t('setup.account.passwordAgain')}
            type="password"
            autoComplete="new-password"
            value={values.passwordAgain}
            error={errors.passwordAgain}
            onChange={(event) => {
              set('passwordAgain', event.target.value)
            }}
          />
          <div className="actions">
            <button className="btn block" type="submit">
              {t('common.next')}
            </button>
          </div>
          <p className="privacy">{t('common.privacyNote')}</p>
        </form>
      ) : null}

      {step === 2 ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setStep(3)
          }}
        >
          <h1 className="title">{t('setup.lang.title')}</h1>
          <p className="lead">{t('setup.lang.lead')}</p>
          <div className="field">
            <div className="fl" id="ui-language-label">
              {t('setup.lang.uiLanguage')}
            </div>
            <div className="seg" role="radiogroup" aria-labelledby="ui-language-label">
              {languages.map(({ value, label }) => (
                <label key={value}>
                  <input
                    className="visually-hidden"
                    type="radio"
                    name="uiLanguage"
                    value={value}
                    checked={values.uiLanguage === value}
                    onChange={() => {
                      set('uiLanguage', value)
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="timeZone">{t('setup.lang.timeZone')}</label>
            <div className="inp sel">
              <select
                id="timeZone"
                aria-describedby="timeZone-hint"
                value={values.timeZone}
                onChange={(event) => {
                  set('timeZone', event.target.value)
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
            <p className="hint" id="timeZone-hint">
              {t('setup.lang.tzHint')}
            </p>
          </div>
          <div className="actions">
            <button className="btn block" type="submit">
              {t('common.next')}
            </button>
            <button
              className="btn line block"
              type="button"
              onClick={() => {
                setStep(1)
              }}
            >
              {t('common.back')}
            </button>
          </div>
        </form>
      ) : null}

      {step === 3 ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void finish()
          }}
        >
          <h1 className="title">{t('setup.transcription.title')}</h1>
          <p className="lead">{t('setup.transcription.lead')}</p>
          <div role="radiogroup" aria-label={t('setup.transcription.title')}>
            <label className="opt">
              <input
                className="visually-hidden"
                type="radio"
                name="transcription"
                checked={!values.transcriptionEnabled}
                onChange={() => {
                  set('transcriptionEnabled', false)
                }}
              />
              <span className="r" aria-hidden="true" />
              <span>
                <b>{t('setup.transcription.later')}</b>
                <span className="t">{t('setup.transcription.laterHint')}</span>
              </span>
            </label>
            <label className="opt">
              <input
                className="visually-hidden"
                type="radio"
                name="transcription"
                checked={values.transcriptionEnabled}
                onChange={() => {
                  set('transcriptionEnabled', true)
                }}
              />
              <span className="r" aria-hidden="true" />
              <span>
                <b>{t('setup.transcription.on')}</b>
                <span className="t">{t('setup.transcription.onHint', { size: modelSize })}</span>
              </span>
            </label>
          </div>
          {submitError ? (
            <div className="alert" role="alert">
              <Icon name="alert" />
              <span>{submitError}</span>
            </div>
          ) : null}
          <div className="actions">
            <button className="btn block" type="submit" disabled={busy}>
              {values.transcriptionEnabled ? t('setup.finishAndDownload') : t('setup.finish')}
            </button>
            <button
              className="btn line block"
              type="button"
              onClick={() => {
                setStep(2)
              }}
            >
              {t('common.back')}
            </button>
          </div>
        </form>
      ) : null}
    </BareLayout>
  )
}
