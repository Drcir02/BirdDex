import { useState } from 'react'
import { catchesWithPost, clearPhotoCache, deleteAllCatches, useCaughtSummary } from '../../db'
import { t } from '../../i18n'
import { catchesText } from './backupFlow'
import { Button, ConfirmDialog, LcdPanel, useToast } from '../../ui'
import { forgetAllThumbnails } from '../dex/thumbnails'
import { forgetShared } from '../group/share'
import { useMembership } from '../group/state'
import { forgetBackup } from './backupReminder'
import './settings.css'

export interface EraseSectionProps {
  onErased?: () => void
}

type Step = 'idle' | 'first' | 'second'

/** "Smazat všechna data": two questions in a row, so a slip of the finger cannot lose the collection. */
export function EraseSection({ onErased }: EraseSectionProps) {
  const toast = useToast()
  const { catchCount } = useCaughtSummary()
  const inGroup = useMembership() !== undefined
  const [step, setStep] = useState<Step>('idle')
  const [busy, setBusy] = useState(false)

  const erase = async () => {
    setBusy(true)
    try {
      // The posts of the group go with the birds (they are deleted on the server as soon as there is a connection).
      for (const record of await catchesWithPost()) await forgetShared(record)
      await deleteAllCatches()
      await clearPhotoCache()
      forgetAllThumbnails()
      forgetBackup()
      onErased?.()
      toast.show(t('settings.erase.done'), { tone: 'success' })
    } catch {
      toast.show(t('settings.erase.failed'), { tone: 'error' })
    } finally {
      setBusy(false)
      setStep('idle')
    }
  }

  return (
    <LcdPanel title={t('settings.erase.title')} data-testid="erase-section">
      <div className="bd-set-section">
        <p className="bd-set-hint">{t('settings.erase.hint')}</p>
        <Button variant="danger" icon="trash" onClick={() => setStep('first')} data-testid="erase-start">
          {t('settings.erase.button')}
        </Button>
      </div>

      <ConfirmDialog
        open={step === 'first'}
        tone="danger"
        title={t('settings.erase.firstTitle')}
        message={
          <>
            <p>{t('settings.erase.firstMessage', { catches: catchesText(catchCount) })}</p>
            {inGroup ? <p data-testid="erase-group-note">{t('group.settings.eraseNote')}</p> : null}
          </>
        }
        confirmLabel={t('settings.erase.firstConfirm')}
        onConfirm={() => setStep('second')}
        onCancel={() => setStep('idle')}
      />
      <ConfirmDialog
        open={step === 'second'}
        tone="danger"
        title={t('settings.erase.secondTitle')}
        message={<p>{t('settings.erase.secondMessage')}</p>}
        confirmLabel={t('settings.erase.secondConfirm')}
        busy={busy}
        onConfirm={() => void erase()}
        onCancel={() => setStep('idle')}
      />
    </LcdPanel>
  )
}
