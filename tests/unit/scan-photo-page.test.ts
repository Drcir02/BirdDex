// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement as h } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/state/modelStatus', () => ({ useModelStatus: () => undefined }))
const getCurrentLocation = vi.fn(async (_options?: { timeoutMs?: number }) => ({ lat: 50.08, lon: 14.43 }))
vi.mock('../../src/state/location', () => ({
  getCachedLocation: () => ({ lat: 50.08, lon: 14.43 }),
  getCurrentLocation: (options?: { timeoutMs?: number }) => getCurrentLocation(options),
}))

import { markPrepared, resetFakePrepared } from '../../src/features/scan/modelReadiness'
import { resetEngines } from '../../src/ml/engines'
import ScanPhotoPage from '../../src/pages/ScanPhotoPage'
import { clearPending } from '../../src/state/pending'

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem('birddex:engines', 'fake')
  window.localStorage.setItem('birddex:fakeDelay', '5')
  resetEngines()
  resetFakePrepared()
  clearPending()
  getCurrentLocation.mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderPhoto() {
  return render(h(MemoryRouter, { initialEntries: ['/scan/photo'] }, h(ScanPhotoPage)))
}

const pick = (testId: 'photo-take' | 'photo-pick', file: File) => fireEvent.change(screen.getByTestId(testId), { target: { files: [file] } })

describe('choosing a photo', () => {
  it('has a button that opens the phone camera and one that opens the gallery', () => {
    renderPhoto()
    const take = screen.getByTestId('photo-take') as HTMLInputElement
    const gallery = screen.getByTestId('photo-pick') as HTMLInputElement
    expect(take.type).toBe('file')
    expect(take.accept).toBe('image/*')
    expect(take.getAttribute('capture')).toBe('environment')
    expect(gallery.type).toBe('file')
    expect(gallery.accept).toBe('image/*')
    expect(gallery.hasAttribute('capture')).toBe(false)
    expect(screen.getByText('Vyfotit')).toBeTruthy()
    expect(screen.getByText('Vybrat z galerie')).toBeTruthy()
  })

  it('has real labels around the inputs, so both buttons are reachable by keyboard and screen reader', () => {
    renderPhoto()
    expect(screen.getByLabelText('Vyfotit')).toBe(screen.getByTestId('photo-take'))
    expect(screen.getByLabelText('Vybrat z galerie')).toBe(screen.getByTestId('photo-pick'))
  })

  it('lets the person choose a photo before the model is downloaded (only "Určit" waits for it)', () => {
    renderPhoto()
    expect((screen.getByTestId('photo-pick') as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByTestId('model-download')).toBeTruthy()
  })
})

describe('files that cannot be used', () => {
  beforeEach(() => markPrepared('photo'))

  it('explains a HEIC photo that this browser cannot open, and what to do instead', async () => {
    renderPhoto()
    pick('photo-pick', new File([new Uint8Array(2000)], 'IMG_0001.HEIC', { type: 'image/heic' }))
    expect(await screen.findByText(/Formát HEIC neumím přečíst/)).toBeTruthy()
    expect(screen.getByText(/ulož fotku jako JPEG/)).toBeTruthy()
    // The two buttons are still there to try another photo.
    expect(screen.getByTestId('photo-pick')).toBeTruthy()
  })

  it('explains a file that is not a picture', async () => {
    renderPhoto()
    pick('photo-pick', new File(['%PDF-1.4'], 'bird.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText('Tohle není obrázek. Vyber prosím fotku.')).toBeTruthy()
  })

  it('explains an empty file', async () => {
    renderPhoto()
    pick('photo-pick', new File([], 'empty.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByText(/Ten soubor je prázdný/)).toBeTruthy()
  })

  it('refuses a photo that is far too big to open safely, without trying', async () => {
    renderPhoto()
    const huge = new File(['x'], 'huge.jpg', { type: 'image/jpeg' })
    Object.defineProperty(huge, 'size', { value: 80 * 1024 * 1024 })
    pick('photo-pick', huge)
    expect(await screen.findByText(/Fotka je moc velká/)).toBeTruthy()
  })

  it('says it could not open a picture that is damaged (here: this test browser opens no pictures at all)', async () => {
    renderPhoto()
    pick('photo-take', new File([new Uint8Array(2000)], 'broken.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByText(/Fotku se nepodařilo otevřít/)).toBeTruthy()
  })

  it('shows the messages with a heading that says something went wrong, and never a blank screen', async () => {
    renderPhoto()
    pick('photo-pick', new File(['%PDF'], 'bird.pdf', { type: 'application/pdf' }))
    await screen.findByText('Něco se nepovedlo')
    expect(screen.getByRole('heading', { level: 1, name: 'Fotka' })).toBeTruthy()
  })

  it('asks for the position only for a photo that is really going to be used', async () => {
    renderPhoto()
    pick('photo-pick', new File(['%PDF'], 'bird.pdf', { type: 'application/pdf' }))
    await screen.findByText('Tohle není obrázek. Vyber prosím fotku.')
    expect(getCurrentLocation).not.toHaveBeenCalled()
    pick('photo-pick', new File([new Uint8Array(2000)], 'bird.jpg', { type: 'image/jpeg' }))
    await waitFor(() => expect(getCurrentLocation).toHaveBeenCalledWith({ timeoutMs: 0 }))
  })
})
