import { useCallback, useRef, useState } from 'react'
import { backupFileName, exportBackup, importBackup, saveBackupFile, type ImportReport } from '../../db'
import { t } from '../../i18n'
import { markBackupMade } from './backupReminder'
import { canShareBackupFile, exportErrorText, importErrorText, importSummaryLines, needsSecondTap } from './backupFlow'

export type BackupPhase = 'idle' | 'building' | 'ready' | 'saving' | 'importing'

export interface BackupMessage {
  tone: 'success' | 'info' | 'error'
  title?: string
  lines: string[]
}

export interface BackupController {
  phase: BackupPhase
  /** "3 z 12" while a backup is being packed or restored. */
  progress?: { done: number; total: number }
  message?: BackupMessage
  /** Starts a backup. Call it from a tap. */
  startExport(): void
  /** The second tap, when the backup took too long for the share sheet to stay allowed. */
  saveReady(): void
  /** Restores from the chosen file. */
  restore(file: File): void
  /** True while one of the actions runs. */
  busy: boolean
}

/** Backup and restore as a small state machine for the settings screen. */
export function useBackup(onChanged?: () => void): BackupController {
  const [phase, setPhase] = useState<BackupPhase>('idle')
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>()
  const [message, setMessage] = useState<BackupMessage | undefined>()
  const ready = useRef<{ blob: Blob; fileName: string } | undefined>(undefined)
  const working = useRef(false)

  const hand = useCallback(
    async (blob: Blob, fileName: string) => {
      setPhase('saving')
      try {
        const result = await saveBackupFile(blob, fileName)
        if (result === 'cancelled') {
          // The file is still here: the person may tap again.
          ready.current = { blob, fileName }
          setPhase('ready')
          setMessage({ tone: 'info', lines: [t('settings.backup.cancelled')] })
          return
        }
        ready.current = undefined
        markBackupMade()
        onChanged?.()
        setMessage({
          tone: 'success',
          lines: [result === 'shared' ? t('settings.backup.shared') : t('settings.backup.downloaded', { file: fileName })],
        })
        setPhase('idle')
      } catch (error) {
        ready.current = undefined
        setMessage({ tone: 'error', title: t('common.errors.title'), lines: [exportErrorText(error)] })
        setPhase('idle')
      }
    },
    [onChanged],
  )

  const startExport = useCallback(() => {
    if (working.current) return
    working.current = true
    setMessage(undefined)
    setProgress(undefined)
    setPhase('building')
    const began = performance.now()
    void (async () => {
      try {
        const blob = await exportBackup({ onProgress: (done, total) => setProgress({ done, total }) })
        const fileName = backupFileName()
        setProgress(undefined)
        if (needsSecondTap(performance.now() - began, canShareBackupFile())) {
          ready.current = { blob, fileName }
          setPhase('ready')
          setMessage({ tone: 'info', lines: [t('settings.backup.ready')] })
        } else {
          await hand(blob, fileName)
        }
      } catch (error) {
        setProgress(undefined)
        setMessage({ tone: 'error', title: t('common.errors.title'), lines: [exportErrorText(error)] })
        setPhase('idle')
      } finally {
        working.current = false
      }
    })()
  }, [hand])

  const saveReady = useCallback(() => {
    const file = ready.current
    if (!file || working.current) return
    working.current = true
    setMessage(undefined)
    void hand(file.blob, file.fileName).finally(() => {
      working.current = false
    })
  }, [hand])

  const restore = useCallback(
    (file: File) => {
      if (working.current) return
      working.current = true
      ready.current = undefined
      setMessage(undefined)
      setProgress(undefined)
      setPhase('importing')
      void (async () => {
        let report: ImportReport | undefined
        try {
          report = await importBackup(file, { onProgress: (done, total) => setProgress({ done, total }) })
          setMessage({ tone: 'success', title: t('settings.backup.result.title'), lines: importSummaryLines(report) })
        } catch (error) {
          setMessage({ tone: 'error', title: t('common.errors.title'), lines: [importErrorText(error)] })
        } finally {
          setProgress(undefined)
          setPhase('idle')
          working.current = false
          onChanged?.()
        }
      })()
    },
    [onChanged],
  )

  return { phase, progress, message, startExport, saveReady, restore, busy: phase !== 'idle' && phase !== 'ready' }
}
