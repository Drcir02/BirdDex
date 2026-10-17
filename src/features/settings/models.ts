// The downloaded models as the settings screen lists them: Czech names (the manifest labels are English) and totals. Pure.

import { t } from '../../i18n'
import type { ModelFileState, ModelStoreStatus } from '../../ml/runtime/modelStore'

const LABELS = {
  'birdnet-fp16': 'settings.storage.models.birdnet-fp16',
  'birdnet-geo-fp16': 'settings.storage.models.birdnet-geo-fp16',
  'wingclip-onnx': 'settings.storage.models.wingclip-onnx',
  'wingclip-data': 'settings.storage.models.wingclip-data',
  'wingclip-text': 'settings.storage.models.wingclip-text',
} as const

/** The Czech name of a model file; a file the app does not know by id gets a general name. */
export function modelLabel(id: string): string {
  return id in LABELS ? t(LABELS[id as keyof typeof LABELS]) : t('settings.storage.modelOther')
}

export function modelStateLabel(state: ModelFileState): string {
  switch (state) {
    case 'ready':
      return t('settings.storage.modelReady')
    case 'missing':
      return t('settings.storage.modelMissing')
    case 'downloading':
      return t('settings.storage.modelDownloading')
    case 'failed':
      return t('settings.storage.modelFailed')
  }
}

export interface ModelTotals {
  files: number
  readyFiles: number
  totalBytes: number
  /** Bytes of the files that are fully downloaded (a running download does not count). */
  downloadedBytes: number
}

export function modelTotals(status: Pick<ModelStoreStatus, 'files'>): ModelTotals {
  let readyFiles = 0
  let downloadedBytes = 0
  let totalBytes = 0
  for (const file of status.files) {
    totalBytes += file.bytes
    if (file.state === 'ready') {
      readyFiles += 1
      downloadedBytes += file.bytes
    }
  }
  return { files: status.files.length, readyFiles, totalBytes, downloadedBytes }
}
