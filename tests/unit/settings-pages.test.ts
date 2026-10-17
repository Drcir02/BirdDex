// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createElement as h, type ReactElement } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetWelcomed, isWelcomed } from '../../src/app/welcome'
import { resetSpeciesCache } from '../../src/data/species'
import { addCatch, deleteAllCatches, exportBackup, getDb, listCatches } from '../../src/db'
import type { Species } from '../../src/domain/types'
import { LAST_BACKUP_KEY, forgetBackup } from '../../src/features/settings/backupReminder'
import { setDeferredPromptForTests, type BeforeInstallPromptEvent } from '../../src/features/settings/install'
import { reloadSettingsForTests, SETTINGS_KEY } from '../../src/state/settings'
import { resetPersistentStorageRequest } from '../../src/state/storage'
import type { ModelStoreStatus } from '../../src/ml/runtime/modelStore'
import { ToastProvider, ToastViewport } from '../../src/ui/Toast'

// What the model store says, and what "delete the models" does, are under the test's control.
let modelStatus: ModelStoreStatus | undefined
vi.mock('../../src/state/modelStatus', () => ({ useModelStatus: () => modelStatus, refreshModelStatus: async () => undefined }))
const deleteCached = vi.fn(async () => undefined)
vi.mock('../../src/ml/runtime/modelStore', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/ml/runtime/modelStore')>()), deleteCached: () => deleteCached() }))
// The share sheet and the download are the browser's business: record what the screen hands over.
const saveBackupFile = vi.fn(async (_blob: Blob, _name?: string): Promise<'shared' | 'downloaded' | 'cancelled'> => 'downloaded')
vi.mock('../../src/db/backupFile', () => ({ saveBackupFile: (blob: Blob, name?: string) => saveBackupFile(blob, name) }))

import AboutPage from '../../src/pages/AboutPage'
import OnboardingPage from '../../src/pages/OnboardingPage'
import SettingsPage from '../../src/pages/SettingsPage'

beforeAll(() => {
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('File', NodeFile)
})

function bird(id: string, patch: Partial<Species> = {}): Species {
  return {
    id,
    dexNumber: 1,
    scientificName: id,
    czechName: id,
    englishName: id,
    family: null,
    inCzechia: true,
    inEurope: true,
    rarity: 'common',
    birdnetIndex: 1,
    wingclipIndex: 1,
    wikiTitle: null,
    ...patch,
  }
}

const LIST: Species[] = [
  bird('parus-major', { czechName: 'Sýkora koňadra', scientificName: 'Parus major' }),
  bird('turdus-merula', { czechName: 'Kos černý', rarity: 'uncommon' }),
  bird('bubo-bubo', { czechName: 'Výr velký', rarity: 'epic' }),
  bird('alca-torda', { czechName: 'Alka malá', rarity: 'legendary', inCzechia: false }),
]

function Where() {
  return h('p', { 'data-testid': 'where' }, useLocation().pathname)
}

function app(path: string, page: ReactElement): ReactElement {
  return h(
    ToastProvider,
    null,
    h(
      MemoryRouter,
      { initialEntries: [path] },
      h(Where),
      h(ToastViewport),
      h(
        Routes,
        null,
        h(Route, { path: '/settings', element: page }),
        h(Route, { path: '/about', element: page }),
        h(Route, { path: '/welcome', element: page }),
        h(Route, { path: '*', element: h('p', { 'data-testid': 'elsewhere' }, 'jinde') }),
      ),
    ),
  )
}

function files(states: Array<'ready' | 'missing'>): ModelStoreStatus {
  const sizes: Array<[string, number]> = [
    ['birdnet-fp16', 25_932_528],
    ['birdnet-geo-fp16', 14_770_468],
    ['wingclip-onnx', 14_386_564],
    ['wingclip-data', 25_165_824],
    ['wingclip-text', 8_488_140],
  ]
  const list = sizes.map(([id, bytes], index) => ({ id, label: id, file: id, bytes, state: states[index] ?? 'missing', loadedBytes: states[index] === 'ready' ? bytes : 0 }))
  return { state: 'ready', files: list, totalBytes: list.reduce((sum, file) => sum + file.bytes, 0), readyBytes: 0, persistent: true }
}

beforeEach(async () => {
  window.localStorage.clear()
  resetWelcomed()
  reloadSettingsForTests()
  forgetBackup()
  resetSpeciesCache(LIST)
  modelStatus = undefined
  deleteCached.mockClear()
  saveBackupFile.mockClear()
  saveBackupFile.mockResolvedValue('downloaded')
  setDeferredPromptForTests(undefined)
  resetPersistentStorageRequest()
  await deleteAllCatches()
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'storage')
  Reflect.deleteProperty(navigator, 'mediaDevices')
  await deleteAllCatches()
})

// ---------- Settings ----------

describe('the settings screen', () => {
  it('has one h1 and the sections in order', async () => {
    render(app('/settings', h(SettingsPage)))
    expect(screen.getByRole('heading', { level: 1, name: 'Nastavení' })).toBeTruthy()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['Karta lovce', 'Citlivost chytání', 'Zvuky', 'Úložiště', 'Záloha', 'Smazat vše', 'O aplikaci'])
  })

  it('shows an inviting empty trainer card when nothing is caught', async () => {
    render(app('/settings', h(SettingsPage)))
    expect(await screen.findByTestId('trainer-empty')).toBeTruthy()
    expect(within(screen.getByTestId('trainer-empty')).getByRole('link', { name: 'Jdu na to' }).getAttribute('href')).toBe('/scan')
  })

  it('shows the trainer card numbers for the collection', async () => {
    await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9, caughtAt: new Date(2026, 8, 21, 10).getTime() })
    await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9, caughtAt: new Date(2026, 9, 1, 10).getTime() })
    await addCatch({ speciesId: 'alca-torda', method: 'live', confidence: 0.9, caughtAt: new Date(2026, 9, 2, 10).getTime() })
    render(app('/settings', h(SettingsPage)))
    expect((await screen.findByTestId('stat-species')).textContent).toBe('2')
    expect(screen.getByTestId('stat-catches').textContent).toBe('3 nálezů celkem')
    expect(screen.getByTestId('stat-czechia').textContent).toContain('1 z 3')
    expect(screen.getByTestId('stat-czechia-percent').textContent).toMatch(/^33\s%$/)
    expect(screen.getByTestId('stat-europe-percent').textContent).toMatch(/^50\s%$/)
    expect(screen.getByTestId('stat-rarest').textContent).toContain('Alka malá')
    expect(screen.getByTestId('stat-rarest').textContent).toContain('Legendární')
    expect(screen.getByTestId('stat-first').textContent).toContain('21. 9. 2026')
    expect(screen.getByTestId('stat-method-sound').textContent).toContain('1')
    expect(screen.getByTestId('stat-method-live').textContent).toContain('1')
  })

  it('saves the sensitivity, explains it, and keeps it', () => {
    render(app('/settings', h(SettingsPage)))
    expect(screen.getByRole('radio', { name: 'Normální' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('sensitivity-info').textContent).toMatch(/Hlas: od 70\s% jistoty/)
    fireEvent.click(screen.getByRole('radio', { name: 'Přísná' }))
    expect(screen.getByRole('radio', { name: 'Přísná' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('sensitivity-info').getAttribute('data-level')).toBe('strict')
    expect(screen.getByTestId('sensitivity-info').textContent).toMatch(/od 85\s% jistoty/)
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ sensitivity: 'strict' })
    fireEvent.click(screen.getByRole('radio', { name: 'Snadná' }))
    expect(screen.getByTestId('sensitivity-info').textContent).toMatch(/od 55\s% jistoty/)
  })

  it('switches the sound effects off and on', () => {
    render(app('/settings', h(SettingsPage)))
    const sound = screen.getByRole('switch', { name: /Zvukové efekty/ })
    expect(sound.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sound)
    expect(sound.getAttribute('aria-checked')).toBe('false')
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ soundEffects: false })
    expect(screen.queryByTestId('sound-preview')).toBeNull()
    fireEvent.click(sound)
    expect(sound.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByTestId('sound-preview')).toBeTruthy()
  })

  it('links to the About page and the Field check (named for testers), and shows the version', () => {
    render(app('/settings', h(SettingsPage)))
    expect(screen.getByTestId('link-about').getAttribute('href')).toBe('/about')
    const check = screen.getByTestId('link-field-check')
    expect(check.getAttribute('href')).toBe('/field-check')
    expect(check.textContent).toContain('pro testery')
    expect(screen.getByTestId('app-version').textContent).toMatch(/^Verze test · Sestaveno \d+\. 1\. 1970/)
  })

  it('shows the welcome screens again on request', () => {
    window.localStorage.setItem('birddex:welcomed', '1')
    render(app('/settings', h(SettingsPage)))
    fireEvent.click(screen.getByTestId('replay-welcome'))
    expect(screen.getByTestId('where').textContent).toBe('/welcome')
    expect(isWelcomed()).toBe(false)
  })
})

describe('the storage section', () => {
  it('shows the used space and the protection state, and asks for protection on request', async () => {
    const persist = vi.fn(async () => true)
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ usage: 114_000_000, quota: 3_500_000_000 }), persisted: async () => false, persist },
    })
    render(app('/settings', h(SettingsPage)))
    expect((await screen.findByTestId('storage-used')).textContent).toBe('114 MB z 3,5 GB')
    expect(screen.getByTestId('storage-persistent').getAttribute('data-persistent')).toBe('no')
    fireEvent.click(screen.getByTestId('persist-request'))
    await waitFor(() => expect(screen.getByTestId('storage-persistent').getAttribute('data-persistent')).toBe('yes'))
    expect(persist).toHaveBeenCalled()
    expect(screen.getByTestId('storage-persistent').textContent).toContain('Data jsou chráněná')
  })

  it('says calmly when the browser refuses protection', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ usage: 1, quota: 10 }), persisted: async () => false, persist: async () => false } })
    render(app('/settings', h(SettingsPage)))
    fireEvent.click(await screen.findByTestId('persist-request'))
    await waitFor(() => expect(screen.getByTestId('storage-persistent').textContent).toContain('Prohlížeč to zatím nepovolil'))
  })

  it('says so when the browser cannot tell how much space is used', async () => {
    render(app('/settings', h(SettingsPage)))
    await waitFor(() => expect(screen.getByTestId('storage-usage').textContent).toContain('neumí říct'))
    expect(screen.getByTestId('storage-persistent').textContent).toContain('neumí')
    expect(screen.queryByTestId('persist-request')).toBeNull()
  })

  it('lists the downloaded models with sizes and deletes them after a question', async () => {
    modelStatus = files(['ready', 'ready', 'missing', 'missing', 'missing'])
    render(app('/settings', h(SettingsPage)))
    const rows = screen.getAllByTestId('model-row')
    expect(rows).toHaveLength(5)
    expect(rows[0].textContent).toBe('Poslech (BirdNET)25,9 MB · staženo')
    expect(rows[2].textContent).toBe('Fotky: model14,4 MB · chybí')
    expect(screen.getByTestId('models-summary').textContent).toBe('Staženo 40,7 MB z 88,7 MB.')

    fireEvent.click(screen.getByTestId('models-delete'))
    const dialog = screen.getByRole('alertdialog', { name: 'Smazat stažené modely?' })
    expect(dialog.textContent).toContain('Uvolní se 40,7 MB')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zrušit' }))
    expect(deleteCached).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('models-delete'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Smazat modely' }))
    await waitFor(() => expect(deleteCached).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByText('Modely jsou smazané. Místo je volné.')).toBeTruthy()
  })

  it('has nothing to delete when no model is downloaded, and says how much will come', () => {
    modelStatus = files([])
    render(app('/settings', h(SettingsPage)))
    expect((screen.getByTestId('models-delete') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('models-summary').textContent).toBe('Zatím nic není stažené. Stáhne se při prvním skenování (asi 90 MB).')
  })

  it('says that all is downloaded when it is', () => {
    modelStatus = files(['ready', 'ready', 'ready', 'ready', 'ready'])
    render(app('/settings', h(SettingsPage)))
    expect(screen.getByTestId('models-summary').textContent).toContain('Vše je staženo (88,7 MB). Aplikace funguje i bez internetu.')
  })

  it('does not break when the list of models cannot be loaded', () => {
    modelStatus = { state: 'unavailable', files: [], totalBytes: 0, readyBytes: 0, persistent: true }
    render(app('/settings', h(SettingsPage)))
    expect(screen.getByText(/Seznam modelů teď nejde načíst/)).toBeTruthy()
    expect(screen.queryByTestId('models-delete')).toBeNull()
  })
})

describe('the backup section', () => {
  it('cannot back up an empty collection and says why', async () => {
    render(app('/settings', h(SettingsPage)))
    await waitFor(() => expect((screen.getByTestId('backup-export') as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByTestId('backup-section').textContent).toContain('Zatím není co zálohovat')
    expect(screen.getByTestId('backup-last').textContent).toBe('Zatím žádná záloha.')
  })

  it('makes a backup, hands the zip over and remembers the day', async () => {
    await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 })
    render(app('/settings', h(SettingsPage)))
    await waitFor(() => expect((screen.getByTestId('backup-export') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('backup-export'))
    await waitFor(() => expect(saveBackupFile).toHaveBeenCalledTimes(1))
    const [blob, name] = saveBackupFile.mock.calls[0]
    expect(blob.size).toBeGreaterThan(100)
    expect(name).toMatch(/^birddex-backup-\d{4}-\d{2}-\d{2}\.zip$/)
    const message = await screen.findByTestId('backup-message')
    expect(message.getAttribute('data-tone')).toBe('success')
    expect(message.textContent).toContain('Záloha je stažená do telefonu')
    expect(window.localStorage.getItem(LAST_BACKUP_KEY)).not.toBeNull()
    expect(screen.getByTestId('backup-last').textContent).toMatch(/^Poslední záloha: \d+\. \d+\. \d{4}$/)
  })

  it('says calmly when the share sheet was closed, and keeps the file for another try', async () => {
    saveBackupFile.mockResolvedValue('cancelled')
    await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 })
    render(app('/settings', h(SettingsPage)))
    await waitFor(() => expect((screen.getByTestId('backup-export') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByTestId('backup-export'))
    expect((await screen.findByTestId('backup-message')).textContent).toContain('Ukládání bylo zrušeno')
    expect(window.localStorage.getItem(LAST_BACKUP_KEY)).toBeNull()
    // The same file can be handed over again with the "save" button.
    saveBackupFile.mockResolvedValue('shared')
    fireEvent.click(screen.getByTestId('backup-save'))
    await waitFor(() => expect(saveBackupFile).toHaveBeenCalledTimes(2))
    expect(saveBackupFile.mock.calls[1][0]).toBe(saveBackupFile.mock.calls[0][0])
    await waitFor(() => expect(screen.getByTestId('backup-message').textContent).toContain('Hotovo, záloha je uložená.'))
  })

  it('restores catches from a backup file and reports what happened', async () => {
    await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 })
    await addCatch({ speciesId: 'turdus-merula', method: 'photo', confidence: 0.8 })
    const zip = await exportBackup()
    await deleteAllCatches()
    await addCatch({ speciesId: 'bubo-bubo', method: 'live', confidence: 0.7 })

    render(app('/settings', h(SettingsPage)))
    const file = new NodeFile([await zip.arrayBuffer()], 'backup.zip', { type: 'application/zip' })
    fireEvent.change(screen.getByTestId('backup-file'), { target: { files: [file] } })
    const message = await screen.findByTestId('backup-message')
    await waitFor(() => expect(message.textContent).toContain('Přidáno 2 nálezy z 2.'))
    expect(message.getAttribute('data-tone')).toBe('success')
    expect((await listCatches()).map((record) => record.speciesId).sort()).toEqual(['bubo-bubo', 'parus-major', 'turdus-merula'])

    // The same file again changes nothing, and says so.
    fireEvent.change(screen.getByTestId('backup-file'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByTestId('backup-message').textContent).toContain('Nic se nezměnilo'))
    expect(await listCatches()).toHaveLength(3)
  })

  it('refuses a file that is not a backup with a calm message and changes nothing', async () => {
    await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 })
    render(app('/settings', h(SettingsPage)))
    fireEvent.change(screen.getByTestId('backup-file'), { target: { files: [new NodeFile(['hello'], 'notes.zip', { type: 'application/zip' })] } })
    const message = await screen.findByTestId('backup-message')
    await waitFor(() => expect(message.textContent).toContain('není záloha z aplikace BirdDex'))
    expect(message.getAttribute('data-tone')).toBe('error')
    expect(await listCatches()).toHaveLength(1)
  })
})

describe('the backup reminder', () => {
  const addMany = async (count: number) => {
    for (let index = 0; index < count; index += 1) await addCatch({ speciesId: 'parus-major', method: 'photo', confidence: 0.9 })
  }

  it('appears after 10 catches without a backup', async () => {
    await addMany(10)
    render(app('/settings', h(SettingsPage)))
    expect((await screen.findByTestId('backup-reminder')).textContent).toContain('10 nálezů')
  })

  it('does not appear with 9 catches', async () => {
    await addMany(9)
    render(app('/settings', h(SettingsPage)))
    await screen.findByTestId('stat-species')
    expect(screen.queryByTestId('backup-reminder')).toBeNull()
  })

  it('does not appear when a backup was made, and goes away after making one', async () => {
    await addMany(10)
    render(app('/settings', h(SettingsPage)))
    fireEvent.click(await screen.findByTestId('backup-reminder-action'))
    await waitFor(() => expect(saveBackupFile).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('backup-reminder')).toBeNull())
  })
})

describe('erasing everything', () => {
  it('asks twice, and only the second yes deletes', async () => {
    await addCatch({ speciesId: 'parus-major', method: 'sound', confidence: 0.9 })
    await addCatch({ speciesId: 'turdus-merula', method: 'photo', confidence: 0.9 })
    render(app('/settings', h(SettingsPage)))
    await screen.findByTestId('stat-species')

    fireEvent.click(screen.getByTestId('erase-start'))
    const first = screen.getByRole('alertdialog', { name: 'Smazat všechna data?' })
    expect(first.textContent).toContain('všech 2 nálezů')
    // The first button the finger lands on is the safe one.
    expect(document.activeElement?.textContent).toBe('Zrušit')
    fireEvent.click(within(first).getByRole('button', { name: 'Zrušit' }))
    expect(await listCatches()).toHaveLength(2)

    fireEvent.click(screen.getByTestId('erase-start'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Pokračovat' }))
    const second = await screen.findByRole('alertdialog', { name: 'Opravdu úplně všechno?' })
    // Cancelling the second question deletes nothing either.
    fireEvent.click(within(second).getByRole('button', { name: 'Zrušit' }))
    expect(await listCatches()).toHaveLength(2)

    fireEvent.click(screen.getByTestId('erase-start'))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Pokračovat' }))
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Opravdu úplně všechno?' })).getByRole('button', { name: 'Ano, smazat vše' }))
    await waitFor(async () => expect(await listCatches()).toHaveLength(0))
    expect(await getDb().media.count()).toBe(0)
    await waitFor(() => expect(screen.getByText('Všechna data jsou smazaná. Dex je prázdný.')).toBeTruthy())
    expect(await screen.findByTestId('trainer-empty')).toBeTruthy()
  })
})

// ---------- About ----------

describe('the About page', () => {
  it('credits everyone with their licences, in Czech', () => {
    render(app('/about', h(AboutPage)))
    expect(screen.getByRole('heading', { level: 1, name: 'O aplikaci' })).toBeTruthy()
    const birdnet = screen.getByTestId('credit-birdnet').textContent ?? ''
    expect(birdnet).toContain('BirdNET')
    expect(birdnet).toContain('Cornell Lab of Ornithology')
    expect(birdnet).toContain('Chemnitz University of Technology')
    expect(birdnet).toContain('CC BY-NC-SA 4.0')
    const wing = screen.getByTestId('credit-wingclip').textContent ?? ''
    expect(wing).toContain('WingCLIP')
    expect(wing).toContain('WingDex')
    expect(wing).toContain('CC BY-NC 4.0')
    expect(wing).toContain('MIT')
    expect(wing).toContain('BioCLIP 2')
    expect(screen.getByTestId('credit-wikimedia').textContent).toMatch(/Wikipedi.*Wikimedia Commons.*autora a licenci/s)
    expect(screen.getByTestId('credit-osm').textContent).toContain('OpenStreetMap')
    const libraries = screen.getByTestId('credit-libraries').textContent ?? ''
    for (const name of ['React', 'Vite', 'Dexie', 'LiteRT.js', 'ONNX Runtime Web', 'fflate', 'SIL Open Font License']) expect(libraries).toContain(name)
  })

  it('says that the app is a gift, not for sale, and that nothing is tracked', () => {
    render(app('/about', h(AboutPage)))
    expect(screen.getByTestId('about-gift').textContent).toMatch(/dárek.*Není na prodej.*nekomerční/s)
    expect(screen.getByTestId('about-privacy').textContent).toMatch(/žádné sledování/i)
  })

  it('has a way back to the settings and hides the dedication while its text is empty', () => {
    render(app('/about', h(AboutPage)))
    expect(screen.getByRole('link', { name: 'Zpět' }).getAttribute('href')).toBe('/settings')
    expect(screen.queryByTestId('dedication')).toBeNull()
  })
})

// ---------- Welcome screens ----------

describe('the welcome screens', () => {
  const stepOf = () => screen.getByTestId('onboarding-step').getAttribute('data-step')

  it('has four steps you can walk through forwards and backwards', () => {
    render(app('/welcome', h(OnboardingPage)))
    expect(screen.getByRole('heading', { level: 1, name: 'Vítej v BirdDex' })).toBeTruthy()
    expect(stepOf()).toBe('idea')
    expect(screen.getByTestId('onboarding-idea').textContent).toMatch(/Poslouchej.*Vyfoť.*Chyť/s)
    expect(screen.queryByTestId('onboarding-back')).toBeNull()
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(stepOf()).toBe('device')
    expect(screen.getByTestId('onboarding-download').textContent).toContain('asi 90 MB')
    expect(screen.getByTestId('onboarding-device').textContent).toMatch(/Žádné účty/)
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(stepOf()).toBe('permissions')
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(stepOf()).toBe('install')
    expect(screen.queryByTestId('onboarding-next')).toBeNull()
    fireEvent.click(screen.getByTestId('onboarding-back'))
    expect(stepOf()).toBe('permissions')
    // Every step says where it is, for screen readers.
    expect(screen.getAllByRole('listitem', { name: /^Krok \d z 4$/ })).toHaveLength(4)
    expect(screen.getByRole('listitem', { name: 'Krok 3 z 4' }).getAttribute('aria-current')).toBe('step')
  })

  it('says how big the download is, from the model list when it is known', () => {
    modelStatus = files([])
    render(app('/welcome', h(OnboardingPage)))
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(screen.getByTestId('onboarding-download').textContent).toContain('asi 90 MB')
  })

  it('moves the focus to the heading of the new step', () => {
    render(app('/welcome', h(OnboardingPage)))
    fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(document.activeElement?.textContent).toBe('Stáhne se jen jednou')
  })

  it('sets the welcome flag and opens the Dex when finished', () => {
    render(app('/welcome', h(OnboardingPage)))
    for (let index = 0; index < 3; index += 1) fireEvent.click(screen.getByTestId('onboarding-next'))
    expect(isWelcomed()).toBe(false)
    fireEvent.click(screen.getByTestId('onboarding-finish'))
    expect(isWelcomed()).toBe(true)
    expect(window.localStorage.getItem('birddex:welcomed')).toBe('1')
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('can be skipped from the first step', () => {
    render(app('/welcome', h(OnboardingPage)))
    fireEvent.click(screen.getByTestId('onboarding-skip'))
    expect(isWelcomed()).toBe(true)
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  describe('the permission primers', () => {
    const toPermissions = () => {
      render(app('/welcome', h(OnboardingPage)))
      fireEvent.click(screen.getByTestId('onboarding-next'))
      fireEvent.click(screen.getByTestId('onboarding-next'))
    }

    it('explain each permission and do NOT ask the browser until "Povolit" is tapped', () => {
      const getUserMedia = vi.fn()
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
      toPermissions()
      for (const kind of ['microphone', 'camera', 'location']) expect(screen.getByTestId(`permission-${kind}`)).toBeTruthy()
      expect(screen.getByTestId('onboarding-permissions').textContent).toContain('Povolit můžeš i později')
      expect(getUserMedia).not.toHaveBeenCalled()
    })

    it('asks for the microphone only after the tap, then switches the microphone off again and shows it as allowed', async () => {
      const stop = vi.fn()
      const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }, { stop }] }))
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
      toPermissions()
      fireEvent.click(screen.getByTestId('permission-microphone-allow'))
      await waitFor(() => expect(screen.getByTestId('permission-microphone').getAttribute('data-state')).toBe('granted'))
      expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
      expect(stop).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('permission-microphone').textContent).toContain('Povoleno')
      expect(screen.getByTestId('permission-camera').getAttribute('data-state')).toBe('unknown')
    })

    it('says calmly when the camera is blocked, and moves on', async () => {
      const getUserMedia = vi.fn(async () => {
        throw new DOMException('no', 'NotAllowedError')
      })
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
      toPermissions()
      fireEvent.click(screen.getByTestId('permission-camera-allow'))
      await waitFor(() => expect(screen.getByTestId('permission-camera').getAttribute('data-state')).toBe('denied'))
      expect(screen.getByTestId('permission-camera').textContent).toContain('Zablokováno')
      expect(screen.getByTestId('onboarding-next')).toBeTruthy()
    })

    it('says so when there is no microphone to ask about', async () => {
      toPermissions()
      fireEvent.click(screen.getByTestId('permission-microphone-allow'))
      await waitFor(() => expect(screen.getByTestId('permission-microphone').getAttribute('data-state')).toBe('unavailable'))
      expect(screen.getByTestId('permission-microphone').textContent).toContain('funguje i bez toho')
    })
  })

  describe('the install hint', () => {
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    const original = navigator.userAgent
    const withAgent = (agent: string) => Object.defineProperty(navigator, 'userAgent', { configurable: true, value: agent })
    afterEach(() => withAgent(original))

    const toInstall = () => {
      render(app('/welcome', h(OnboardingPage)))
      for (let index = 0; index < 3; index += 1) fireEvent.click(screen.getByTestId('onboarding-next'))
    }

    it('tells an iPhone to use Share and then Přidat na plochu', () => {
      withAgent(IPHONE)
      toInstall()
      const step = screen.getByTestId('onboarding-install')
      expect(step.getAttribute('data-platform')).toBe('ios')
      expect(step.textContent).toContain('Sdílet')
      expect(step.textContent).toContain('Přidat na plochu')
      expect(screen.queryByTestId('install-button')).toBeNull()
    })

    it('offers the browser menu on Android until the browser offers a real install button', () => {
      withAgent(ANDROID)
      toInstall()
      expect(screen.getByTestId('onboarding-install').getAttribute('data-platform')).toBe('android')
      expect(screen.queryByTestId('install-button')).toBeNull()
      expect(screen.getByTestId('onboarding-install').textContent).toContain('Nainstalovat aplikaci')
    })

    it('shows a real install button on Android when the browser sent beforeinstallprompt, and uses it once', async () => {
      withAgent(ANDROID)
      const prompt = vi.fn(async () => undefined)
      const event = Object.assign(new Event('beforeinstallprompt'), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) }) as BeforeInstallPromptEvent
      toInstall()
      setDeferredPromptForTests(event)
      const button = await screen.findByTestId('install-button')
      fireEvent.click(button)
      await waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(screen.getByTestId('onboarding-install').textContent).toContain('ikonka je na ploše'))
    })
  })
})
