import { useCallback, useEffect, useState } from 'react'
import { t } from '../../i18n'
import { deleteCached } from '../../ml/runtime/modelStore'
import { refreshModelStatus, useModelStatus } from '../../state/modelStatus'
import { getStorageUsage, requestPersistentStorage, type StorageUsage } from '../../state/storage'
import { Button, ConfirmDialog, LcdPanel, Notice, Spinner, useToast } from '../../ui'
import { approxMegabytes } from '../scan/format'
import { formatBytes } from './format'
import { modelLabel, modelStateLabel, modelTotals } from './models'
import './settings.css'

type PersistResult = 'granted' | 'denied' | undefined

function canRequestPersistence(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function'
}

export function StorageSection() {
  const toast = useToast()
  const status = useModelStatus()
  const [usage, setUsage] = useState<StorageUsage | undefined>()
  const [usageKnown, setUsageKnown] = useState(false)
  const [persistResult, setPersistResult] = useState<PersistResult>()
  const [asking, setAsking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadUsage = useCallback(async () => {
    const found = await getStorageUsage()
    setUsage(found)
    setUsageKnown(true)
  }, [])

  useEffect(() => {
    void loadUsage()
  }, [loadUsage])

  const ask = async () => {
    setAsking(true)
    const granted = await requestPersistentStorage()
    setPersistResult(granted ? 'granted' : 'denied')
    await loadUsage()
    setAsking(false)
  }

  const removeModels = async () => {
    setDeleting(true)
    try {
      await deleteCached()
      await refreshModelStatus()
      toast.show(t('settings.storage.deleted'), { tone: 'success' })
    } catch {
      toast.show(t('settings.storage.deleteFailed'), { tone: 'error' })
    } finally {
      setDeleting(false)
      setConfirming(false)
      void loadUsage()
    }
  }

  const totals = status ? modelTotals(status) : undefined
  const persistent = usage?.persistent === true || persistResult === 'granted'

  return (
    <LcdPanel title={t('settings.storage.title')} data-testid="storage-section">
      <div className="bd-set-section">
        {/* Space used */}
        <div className="bd-set-usage" data-testid="storage-usage">
          {usage ? (
            <>
              <p>
                {t('settings.storage.used')}: <strong data-testid="storage-used">{t('settings.storage.usedValue', { used: formatBytes(usage.usedBytes), quota: formatBytes(usage.quotaBytes) })}</strong>
              </p>
              <div className="bd-set-usage__bar" aria-hidden="true">
                <div className="bd-set-usage__fill" style={{ ['--w' as string]: `${Math.min(100, (usage.usedBytes / Math.max(1, usage.quotaBytes)) * 100)}%` }} />
              </div>
            </>
          ) : usageKnown ? (
            <p className="bd-set-hint">{t('settings.storage.unknown')}</p>
          ) : (
            <p className="bd-set-hint" role="status">
              <Spinner size="sm" label={null} /> {t('common.loading')}
            </p>
          )}
        </div>

        {/* Protection against clean-ups */}
        <div className="bd-set-section" data-testid="storage-persistent" data-persistent={persistent ? 'yes' : 'no'}>
          <p>{persistent ? t('settings.storage.persistentYes') : canRequestPersistence() ? t('settings.storage.persistentNo') : t('settings.storage.persistentUnsupported')}</p>
          {persistResult === 'denied' && !persistent ? <p className="bd-set-hint">{t('settings.storage.persistentDenied')}</p> : null}
          {persistResult === 'granted' ? <p className="bd-set-hint">{t('settings.storage.persistentGranted')}</p> : null}
          {!persistent && canRequestPersistence() ? (
            <Button variant="secondary" icon="check" busy={asking} onClick={() => void ask()} data-testid="persist-request">
              {t('settings.storage.persistentRequest')}
            </Button>
          ) : null}
        </div>

        {/* Downloaded models */}
        <div className="bd-set-section" data-testid="models-section">
          <h3 className="bd-set-subtitle">{t('settings.storage.modelsTitle')}</h3>
          {!status ? (
            <p className="bd-set-hint" role="status">
              <Spinner size="sm" label={null} /> {t('settings.storage.modelsLoading')}
            </p>
          ) : status.state === 'unavailable' ? (
            <Notice tone="warning">{t('settings.storage.modelsUnavailable')}</Notice>
          ) : (
            <>
              <ul className="bd-set-models" data-testid="models-list">
                {status.files.map((file) => (
                  <li key={file.id} data-testid="model-row" data-file={file.id} data-state={file.state}>
                    <span className="bd-set-models__name">{modelLabel(file.id)}</span>
                    <span className="bd-set-models__size" data-state={file.state}>
                      {formatBytes(file.bytes)} · {modelStateLabel(file.state)}
                    </span>
                  </li>
                ))}
              </ul>
              {totals ? (
                <p className="bd-set-hint" data-testid="models-summary">
                  {totals.readyFiles === 0
                    ? t('settings.storage.modelsNone', { size: `${approxMegabytes(totals.totalBytes)} MB` })
                    : totals.readyFiles === totals.files
                      ? t('settings.storage.modelsAll', { total: formatBytes(totals.totalBytes) })
                      : t('settings.storage.modelsSome', { downloaded: formatBytes(totals.downloadedBytes), total: formatBytes(totals.totalBytes) })}
                </p>
              ) : null}
              <Button
                variant="danger"
                icon="trash"
                disabled={!totals || totals.readyFiles === 0 || status.state === 'downloading'}
                onClick={() => setConfirming(true)}
                data-testid="models-delete"
              >
                {t('settings.storage.deleteModels')}
              </Button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={t('settings.storage.deleteTitle')}
        message={<p>{t('settings.storage.deleteMessage', { size: formatBytes(totals?.downloadedBytes ?? 0) })}</p>}
        confirmLabel={t('settings.storage.deleteConfirm')}
        busy={deleting}
        onConfirm={() => void removeModels()}
        onCancel={() => setConfirming(false)}
      />
    </LcdPanel>
  )
}
