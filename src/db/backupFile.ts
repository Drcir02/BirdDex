// Getting a backup file out of the app and onto the phone's storage.

import { backupFileName } from './backup'

export type BackupSaveResult =
  /** Handed to the phone's share sheet (it has "Save to Files", and mail, messengers and so on). */
  | 'shared'
  /** Saved as a download, because sharing files is not possible here. */
  | 'downloaded'
  /** The user closed the share sheet without choosing anything. */
  | 'cancelled'

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.append(link)
  link.click()
  link.remove()
  // Give the browser time to start reading the file before the address is released.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Gives the user the backup file: through the share sheet where the browser can share files (iPhone, Android),
 * otherwise as a download. Call it straight from a tap: browsers only open the share sheet for a fresh tap, so if
 * making the backup takes a while, show a "ready" button and call this from that button. If sharing is refused
 * for another reason the file is downloaded instead.
 */
export async function saveBackupFile(blob: Blob, fileName: string = backupFileName()): Promise<BackupSaveResult> {
  const file = new File([blob], fileName, { type: 'application/zip' })
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  if (typeof nav?.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName })
      return 'shared'
    } catch (error) {
      if ((error as { name?: unknown } | null)?.name === 'AbortError') return 'cancelled'
      // Not allowed (the tap was too long ago) or not supported after all: fall back to a download.
    }
  }
  download(blob, fileName)
  return 'downloaded'
}
