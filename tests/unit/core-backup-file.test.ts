// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveBackupFile } from '../../src/db/backupFile'

const blob = () => new Blob([new Uint8Array([0x50, 0x4b, 3, 4])], { type: 'application/zip' })

let clicked: { href: string; download: string }[]
let revoked: string[]

beforeEach(() => {
  clicked = []
  revoked = []
  vi.useFakeTimers()
  URL.createObjectURL = vi.fn(() => 'blob:fake/backup')
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url)
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute('href') ?? '', download: this.download })
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const stubNavigator = (share?: (data: ShareData) => Promise<void>, canShare: (data: ShareData) => boolean = () => true) =>
  vi.stubGlobal('navigator', { ...(share ? { share, canShare } : {}) })

describe('saveBackupFile', () => {
  it('hands the file to the share sheet where the phone can share files', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined)
    stubNavigator(share)
    expect(await saveBackupFile(blob(), 'birddex-backup-2026-10-17.zip')).toBe('shared')
    const data = share.mock.calls[0][0] as unknown as { files: File[]; title: string }
    expect(data.files).toHaveLength(1)
    expect(data.files[0]).toBeInstanceOf(File)
    expect(data.files[0].name).toBe('birddex-backup-2026-10-17.zip')
    expect(data.files[0].type).toBe('application/zip')
    expect(data.files[0].size).toBe(4)
    expect(clicked).toEqual([])
  })

  it('names the file after the date by default', async () => {
    const share = vi.fn(async (_data: ShareData) => undefined)
    stubNavigator(share)
    await saveBackupFile(blob())
    expect((share.mock.calls[0][0] as unknown as { files: File[] }).files[0].name).toMatch(/^birddex-backup-\d{4}-\d{2}-\d{2}\.zip$/)
  })

  it('says "cancelled" when the user closes the share sheet, and does not download', async () => {
    stubNavigator(async () => {
      throw new DOMException('closed', 'AbortError')
    })
    expect(await saveBackupFile(blob())).toBe('cancelled')
    expect(clicked).toEqual([])
  })

  it('downloads the file when sharing is refused for another reason', async () => {
    stubNavigator(async () => {
      throw new DOMException('the tap was too long ago', 'NotAllowedError')
    })
    expect(await saveBackupFile(blob(), 'backup.zip')).toBe('downloaded')
    expect(clicked).toEqual([{ href: 'blob:fake/backup', download: 'backup.zip' }])
  })

  it('downloads the file when the browser cannot share files', async () => {
    stubNavigator()
    expect(await saveBackupFile(blob(), 'backup.zip')).toBe('downloaded')
    expect(clicked).toEqual([{ href: 'blob:fake/backup', download: 'backup.zip' }])

    stubNavigator(vi.fn(async (_data: ShareData) => undefined), () => false)
    expect(await saveBackupFile(blob(), 'again.zip')).toBe('downloaded')
    expect(clicked.at(-1)).toEqual({ href: 'blob:fake/backup', download: 'again.zip' })
  })

  it('releases the download address later, and leaves no link in the page', async () => {
    stubNavigator()
    await saveBackupFile(blob())
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoked).toEqual([])
    await vi.advanceTimersByTimeAsync(61_000)
    expect(revoked).toEqual(['blob:fake/backup'])
  })
})
