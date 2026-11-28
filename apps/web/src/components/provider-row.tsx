import type { EngineUsage, ProviderStatus, TranscriptionStatus } from '@nightjar/shared/recordings'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, removeProviderKey, saveProviderKey, testProviderKey } from '../api.ts'
import { formatHours, formatMoney } from '../format.ts'
import { Dialog } from './dialog.tsx'
import { Icon } from './icon.tsx'
import { TextField } from './text-field.tsx'
import { useErrorText } from './use-error-text.ts'

type TestOutcome = 'ok' | 'invalid_key' | 'unreachable'

const testLine: Record<TestOutcome, string> = {
  ok: 'settings.engines.testOk',
  invalid_key: 'settings.engines.testInvalid',
  unreachable: 'settings.engines.testUnreachable',
}

export const providerName = (
  t: (key: string) => string,
  exists: (key: string) => boolean,
  provider: ProviderStatus,
) => (exists(`providers.${provider.id}.name`) ? t(`providers.${provider.id}.name`) : provider.label)

interface ProviderRowProps {
  provider: ProviderStatus
  usage: EngineUsage | undefined
  active: boolean
  busy: boolean
  onSaved: (status: TranscriptionStatus) => void
  onUse: () => void
  onRemove: () => void
}

/** A cloud engine: its key (write-only), a key check, this month's use and the switch. */
export function ProviderRow({
  provider,
  usage,
  active,
  busy,
  onSaved,
  onUse,
  onRemove,
}: ProviderRowProps) {
  const { t, i18n } = useTranslation()
  const errorText = useErrorText()
  const language = i18n.language === 'hu' ? 'hu' : 'en'
  const unreadable = provider.keyError === 'unreadable'
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [fieldError, setFieldError] = useState<string>()
  const name = providerName(t, (key) => i18n.exists(key), provider)
  const price = formatMoney(provider.pricePerHour.amount, provider.pricePerHour.currency, language)
  const formOpen = editing || unreadable

  const test = useMutation({
    mutationFn: (typed: string | undefined) => testProviderKey(provider.id, typed),
  })
  const save = useMutation({
    mutationFn: () => saveProviderKey(provider.id, value),
    onSuccess: (next) => {
      setValue('')
      setEditing(false)
      setFieldError(undefined)
      test.reset()
      onSaved(next)
    },
    onError: (error) => {
      setFieldError(
        error instanceof ApiError && error.status === 400
          ? t('settings.engines.keyRequired')
          : errorText(error),
      )
    },
  })
  const outcome: TestOutcome | undefined = test.isError ? 'unreachable' : test.data?.result

  const runTest = () => {
    if (formOpen) {
      if (value.trim() === '') {
        setFieldError(t('settings.engines.keyRequired'))
        return
      }
      test.mutate(value)
    } else {
      test.mutate(undefined)
    }
  }

  const resultLine = outcome ? (
    <p
      className={outcome === 'ok' ? 'kres ok' : 'kres err'}
      id={`kr-${provider.id}`}
      role={outcome === 'ok' ? 'status' : 'alert'}
    >
      <Icon name={outcome === 'ok' ? 'check' : 'alert'} />
      {t(testLine[outcome])}
    </p>
  ) : null

  const testButton = (
    <button type="button" className="btn sm line" disabled={test.isPending} onClick={runTest}>
      {test.isPending ? t('settings.engines.testing') : t('settings.engines.test')}
    </button>
  )

  return (
    <div className={active ? 'mrow on' : 'mrow'} data-testid="provider-row">
      <div className="mh">
        <span className="nm">
          <Icon name="cloud" />
          <b>{name}</b>
        </span>
        {active ? (
          <span className="mstate on">
            <Icon name="check" />
            {t('settings.models.inUse')}
          </span>
        ) : (
          <span className="mstate">
            {provider.configured ? t('settings.engines.keySaved') : t('settings.engines.noKey')}
          </span>
        )}
      </div>
      <p className="mdesc">{t(`providers.${provider.id}.description`, { price })}</p>
      {unreadable ? (
        <div className="alert" role="alert">
          <Icon name="alert" />
          <span>{t('settings.engines.keyUnreadable')}</span>
        </div>
      ) : null}
      {provider.configured && !formOpen ? (
        <div className="keyline">
          <span className="kl">
            <Icon name="key" />
            {t('settings.engines.apiKey')}
            <span className="dots" aria-hidden="true">
              ••••••••
            </span>
          </span>
          <span className="kb">
            <button
              type="button"
              className="btn text"
              onClick={() => {
                test.reset()
                setEditing(true)
              }}
            >
              {t('settings.engines.replace')}
            </button>
            {active ? null : (
              <button type="button" className="btn textdanger" onClick={onRemove}>
                {t('settings.engines.remove')}
              </button>
            )}
          </span>
        </div>
      ) : null}
      {provider.configured || (usage?.audioMs ?? 0) > 0 ? (
        <p className="usage">
          {t('settings.engines.usage', {
            hours: formatHours(usage?.audioMs ?? 0, language),
            cost: formatMoney(usage?.estimatedCost ?? 0, provider.pricePerHour.currency, language),
          })}
        </p>
      ) : null}
      {formOpen ? (
        <div className="kform">
          <TextField
            id={`key-${provider.id}`}
            label={t('settings.engines.apiKey')}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            error={fieldError}
            aria-describedby={outcome ? `kr-${provider.id}` : undefined}
            onChange={(event) => {
              setValue(event.target.value)
              setFieldError(undefined)
              test.reset()
            }}
          />
          {resultLine}
          <div className="macts">
            <button
              type="button"
              className="btn sm"
              disabled={save.isPending}
              onClick={() => {
                save.mutate()
              }}
            >
              {t('settings.engines.save')}
            </button>
            {testButton}
            {unreadable ? null : (
              <button
                type="button"
                className="btn text"
                onClick={() => {
                  setEditing(false)
                  setValue('')
                  setFieldError(undefined)
                  test.reset()
                }}
              >
                {t('common.cancel')}
              </button>
            )}
          </div>
        </div>
      ) : provider.configured ? (
        <>
          {resultLine ? <div className="kres-wrap">{resultLine}</div> : null}
          <div className="macts">
            {active ? null : (
              <button type="button" className="btn sm" disabled={busy} onClick={onUse}>
                {t('settings.models.use')}
              </button>
            )}
            {testButton}
          </div>
        </>
      ) : (
        <div className="macts">
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setEditing(true)
            }}
          >
            <Icon name="key" />
            {t('settings.engines.addKey')}
          </button>
        </div>
      )}
    </div>
  )
}

export function RemoveKeyDialog({
  provider,
  onDone,
  onCancel,
}: {
  provider: ProviderStatus
  onDone: (status: TranscriptionStatus) => void
  onCancel: () => void
}) {
  const { t, i18n } = useTranslation()
  const errorText = useErrorText()
  const remove = useMutation({
    mutationFn: () => removeProviderKey(provider.id),
    onSuccess: onDone,
  })
  const name = providerName(t, (key) => i18n.exists(key), provider)
  return (
    <Dialog
      role="alertdialog"
      title={t('settings.engines.removeTitle', { name })}
      onClose={onCancel}
    >
      <p>{t('settings.engines.removeText')}</p>
      {remove.isError ? (
        <div className="alert" role="alert">
          <Icon name="alert" />
          <span>{errorText(remove.error)}</span>
        </div>
      ) : null}
      <div className="actions">
        <button
          type="button"
          className="btn danger block"
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate()
          }}
        >
          {t('settings.engines.remove')}
        </button>
        <button type="button" className="btn line block" data-autofocus onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </Dialog>
  )
}
