import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { monthTitle, weekdayNames } from '../dates.ts'
import { Dialog } from './dialog.tsx'
import { Icon } from './icon.tsx'

interface DateDialogProps {
  value: string
  today: string
  onConfirm: (day: string) => void
  onCancel: () => void
}

const pad = (value: number) => String(value).padStart(2, '0')

function shiftMonth(month: string, amount: number) {
  const [year = 0, number = 1] = month.split('-').map(Number)
  const moved = new Date(Date.UTC(year, number - 1 + amount, 1))
  return `${String(moved.getUTCFullYear())}-${pad(moved.getUTCMonth() + 1)}`
}

const daysIn = (month: string) => {
  const [year = 0, number = 1] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).getUTCDate()
}

/** Weekday of the first of the month, counting Monday as 1. */
const firstColumn = (month: string) => ((new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7) + 1

export function DateDialog({ value, today, onConfirm, onCancel }: DateDialogProps) {
  const { t, i18n } = useTranslation()
  const [selected, setSelected] = useState(value)
  const [month, setMonth] = useState(value.slice(0, 7))
  const language = i18n.language

  return (
    <Dialog role="dialog" title={t('dateDialog.title')} onClose={onCancel}>
      <p>{t('dateDialog.text')}</p>
      <div className="cal">
        <div className="mh">
          <button
            type="button"
            className="icbtn"
            aria-label={t('dateDialog.prevMonth')}
            onClick={() => {
              setMonth(shiftMonth(month, -1))
            }}
          >
            <Icon name="back" />
          </button>
          <span aria-live="polite">{monthTitle(month, language)}</span>
          <button
            type="button"
            className="icbtn"
            aria-label={t('dateDialog.nextMonth')}
            disabled={shiftMonth(month, 1) > today.slice(0, 7)}
            onClick={() => {
              setMonth(shiftMonth(month, 1))
            }}
          >
            <Icon name="next" />
          </button>
        </div>
        <div className="grid">
          {weekdayNames(language).map((name) => (
            <div key={name} className="dow" aria-hidden="true">
              {name}
            </div>
          ))}
          {Array.from({ length: daysIn(month) }, (_, index) => {
            const number = index + 1
            const day = `${month}-${pad(number)}`
            return (
              <button
                key={day}
                type="button"
                className={`dd${day === today ? ' tdy' : ''}`}
                style={number === 1 ? { gridColumnStart: firstColumn(month) } : undefined}
                aria-pressed={day === selected}
                disabled={day > today}
                onClick={() => {
                  setSelected(day)
                }}
              >
                {number}
              </button>
            )
          })}
        </div>
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn block"
          onClick={() => {
            onConfirm(selected)
          }}
        >
          {t('writer.done')}
        </button>
        <button type="button" className="btn line block" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </Dialog>
  )
}
