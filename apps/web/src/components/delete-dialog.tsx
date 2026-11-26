import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from './dialog.tsx'
import { Icon } from './icon.tsx'

interface DeleteDialogProps {
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export function DeleteDialog({ onConfirm, onCancel }: DeleteDialogProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const confirm = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await onConfirm()
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <Dialog role="alertdialog" title={t('deleteDialog.title')} onClose={onCancel}>
      <p>{t('deleteDialog.text')}</p>
      {failed ? (
        <div className="alert" role="alert">
          <Icon name="alert" />
          <span>{t('error.generic')}</span>
        </div>
      ) : null}
      <div className="actions">
        <button
          type="button"
          className="btn danger block"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {t('entry.delete')}
        </button>
        <button type="button" className="btn line block" data-autofocus onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </Dialog>
  )
}
