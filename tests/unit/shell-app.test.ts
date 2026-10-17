// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement as h, useState, type ReactElement, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WELCOMED_KEY } from '../../src/app/constants'
import { DeviceStatusProvider, useDeviceActivity, useDeviceStatus, type DeviceStatus } from '../../src/app/deviceStatus'
import { ErrorBoundary } from '../../src/app/ErrorBoundary'
import { FirstRunGate } from '../../src/app/FirstRunGate'
import { Layout } from '../../src/app/Layout'
import { isWelcomed, markWelcomed, resetWelcomed } from '../../src/app/welcome'
import UiKitPage from '../../src/pages/UiKitPage'
import { ToastProvider } from '../../src/ui/Toast'

beforeEach(() => {
  window.localStorage.clear()
  resetWelcomed()
  document.title = ''
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the welcome flag', () => {
  it('starts unset, is set by markWelcomed and cleared by resetWelcomed', () => {
    expect(isWelcomed()).toBe(false)
    markWelcomed()
    expect(isWelcomed()).toBe(true)
    expect(window.localStorage.getItem(WELCOMED_KEY)).toBe('1')
    resetWelcomed()
    expect(isWelcomed()).toBe(false)
    expect(window.localStorage.getItem(WELCOMED_KEY)).toBeNull()
  })

  it('is read from storage written earlier (a returning visitor)', () => {
    window.localStorage.setItem(WELCOMED_KEY, '1')
    expect(isWelcomed()).toBe(true)
  })

  it('still works when the browser refuses storage, so nobody is trapped on the welcome screen', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(() => markWelcomed()).not.toThrow()
    expect(isWelcomed()).toBe(true)
  })

  it('treats unreadable storage as "not welcomed yet" instead of crashing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    expect(isWelcomed()).toBe(false)
  })
})

describe('FirstRunGate', () => {
  const app = (path: string): ReactElement =>
    h(
      MemoryRouter,
      { initialEntries: [path] },
      h(
        Routes,
        null,
        h(
          Route,
          { element: h(FirstRunGate) },
          h(Route, { path: '/', element: h('p', null, 'Dex') }),
          h(Route, { path: '/scan', element: h('p', null, 'Skenovat') }),
          h(Route, { path: '/welcome', element: h('p', null, 'Vítej') }),
          h(Route, { path: '/ui-kit', element: h('p', null, 'Součástky') }),
        ),
      ),
    )

  it('sends a first-time visitor from any screen to the welcome screen', () => {
    render(app('/'))
    expect(screen.getByText('Vítej')).toBeTruthy()
    cleanup()
    render(app('/scan'))
    expect(screen.getByText('Vítej')).toBeTruthy()
  })

  it('lets a first-time visitor open the welcome and kit screens', () => {
    render(app('/ui-kit'))
    expect(screen.getByText('Součástky')).toBeTruthy()
  })

  it('does not interfere once the welcome screen has been seen', () => {
    markWelcomed()
    render(app('/scan'))
    expect(screen.getByText('Skenovat')).toBeTruthy()
    expect(screen.queryByText('Vítej')).toBeNull()
  })
})

describe('device status (the lights)', () => {
  const Probe = () => h('output', { 'data-testid': 'status' }, useDeviceStatus().status)
  const Claimer = ({ status }: { status: DeviceStatus | null }) => {
    useDeviceActivity(status)
    return null
  }
  const Flasher = () => {
    const { flash } = useDeviceStatus()
    return h('button', { onClick: () => flash('success') }, 'Hurá')
  }
  const status = () => screen.getByTestId('status').textContent

  it('is idle until a screen claims something and idle again afterwards', () => {
    const Toggle = () => {
      const [on, setOn] = useState(true)
      return h('div', null, h('button', { onClick: () => setOn(false) }, 'Konec'), on ? h(Claimer, { status: 'listening' }) : null)
    }
    render(h(DeviceStatusProvider, null, h(Probe), h(Toggle)))
    expect(status()).toBe('listening')
    fireEvent.click(screen.getByRole('button', { name: 'Konec' }))
    expect(status()).toBe('idle')
  })

  it('shows the newest claim when two screens claim at once', () => {
    const { rerender } = render(h(DeviceStatusProvider, null, h(Probe), h(Claimer, { status: 'listening' })))
    rerender(h(DeviceStatusProvider, null, h(Probe), h(Claimer, { status: 'listening' }), h(Claimer, { status: 'busy' })))
    expect(status()).toBe('busy')
    rerender(h(DeviceStatusProvider, null, h(Probe), h(Claimer, { status: 'listening' })))
    expect(status()).toBe('listening')
  })

  it('flashes a status for a moment and then goes back', () => {
    vi.useFakeTimers()
    render(h(DeviceStatusProvider, null, h(Probe), h(Claimer, { status: 'busy' }), h(Flasher)))
    expect(status()).toBe('busy')
    fireEvent.click(screen.getByRole('button', { name: 'Hurá' }))
    expect(status()).toBe('success')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(status()).toBe('busy')
  })

  it('ends a flash early when a screen starts something new', () => {
    vi.useFakeTimers()
    const { rerender } = render(h(DeviceStatusProvider, null, h(Probe), h(Flasher)))
    fireEvent.click(screen.getByRole('button', { name: 'Hurá' }))
    expect(status()).toBe('success')
    rerender(h(DeviceStatusProvider, null, h(Probe), h(Flasher), h(Claimer, { status: 'listening' })))
    expect(status()).toBe('listening')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(status()).toBe('listening')
  })

  it('ignores a null claim', () => {
    render(h(DeviceStatusProvider, null, h(Probe), h(Claimer, { status: null })))
    expect(status()).toBe('idle')
  })

  it('does nothing and does not crash without a provider', () => {
    render(h('div', null, h(Probe), h(Claimer, { status: 'busy' })))
    expect(status()).toBe('idle')
  })
})

describe('Layout (the device shell)', () => {
  const shell = (path: string, extra?: ReactNode): ReactElement =>
    h(
      MemoryRouter,
      { initialEntries: [path] },
      h(
        ToastProvider,
        null,
        h(
          DeviceStatusProvider,
          null,
          h(
            Routes,
            null,
            h(
              Route,
              { element: h(Layout) },
              h(Route, { path: '/', element: h('h1', null, 'Stránka Dex') }),
              h(Route, { path: '/scan', element: h('h1', null, 'Stránka Skenovat') }),
              h(Route, { path: '/settings', element: h('h1', null, 'Stránka Nastavení') }),
              h(Route, { path: '/about', element: h('h1', null, 'Stránka O aplikaci') }),
              h(Route, { path: '/welcome', element: h('h1', null, 'Stránka Vítej') }),
              h(Route, { path: '/ui-kit', element: h('h1', null, 'Stránka kit') }),
            ),
          ),
          extra,
        ),
      ),
    )

  const nav = () => screen.getByRole('navigation', { name: 'Hlavní nabídka' })

  it('shows the routed page inside the screen', async () => {
    render(shell('/scan'))
    const screenArea = screen.getByTestId('screen')
    expect(await within(screenArea).findByRole('heading', { name: 'Stránka Skenovat' })).toBeTruthy()
  })

  it('has the three big navigation buttons with Czech labels and the right targets', () => {
    render(shell('/'))
    const links = within(nav()).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Dex', 'Skenovat', 'Nastavení'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/scan', '/settings'])
  })

  it.each([
    ['/', 'Dex'],
    ['/scan', 'Skenovat'],
    ['/settings', 'Nastavení'],
    ['/about', 'Nastavení'],
  ])('marks the current section on %s as "%s"', (path, label) => {
    render(shell(path))
    const current = within(nav())
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual([label])
  })

  it('marks nothing on screens outside the navigation', () => {
    render(shell('/ui-kit'))
    expect(within(nav()).getAllByRole('link').filter((link) => link.hasAttribute('aria-current'))).toHaveLength(0)
  })

  it('hides the navigation on the welcome screen', () => {
    render(shell('/welcome'))
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('names the browser tab after the section', () => {
    render(shell('/scan'))
    expect(document.title).toBe('Skenovat · BirdDex')
    cleanup()
    render(shell('/welcome'))
    expect(document.title).toBe('BirdDex')
  })

  it('has a lens, three lights and says what the lights mean', () => {
    render(shell('/'))
    expect(screen.getByTestId('lens')).toBeTruthy()
    const lights = screen.getByTestId('leds')
    expect(lights.querySelectorAll('.bd-led')).toHaveLength(3)
    expect(lights.textContent).toBe('Stav přístroje: Připraveno')
  })

  it('follows what a screen declares: the device status changes and the lights say so', () => {
    const Listening = () => {
      useDeviceActivity('listening')
      return null
    }
    render(shell('/', h(Listening)))
    expect(screen.getByTestId('device').getAttribute('data-status')).toBe('listening')
    expect(screen.getByTestId('leds').textContent).toBe('Stav přístroje: Poslouchám')
  })

  it('goes to the top of the screen, without navigating, when the button of the current screen is tapped again', () => {
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    render(shell('/scan'))
    fireEvent.click(screen.getByTestId('nav-scan'))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    expect(screen.getByTestId('nav-scan').getAttribute('aria-current')).toBe('page')
    scrollTo.mockClear()
    fireEvent.click(screen.getByTestId('nav-settings'))
    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByTestId('nav-settings').getAttribute('aria-current')).toBe('page')
  })

  it('jumps instead of gliding to the top for people who asked for less motion', () => {
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }))
    render(shell('/scan'))
    fireEvent.click(screen.getByTestId('nav-scan'))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    vi.unstubAllGlobals()
  })

  it('is one landmark of each kind: a header, one main, one nav', () => {
    render(shell('/'))
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
    expect(screen.getAllByRole('banner')).toHaveLength(1)
  })
})

describe('ErrorBoundary', () => {
  const Bomb = ({ message = 'Kaboom' }: { message?: string }): ReactNode => {
    throw new Error(message)
  }

  const silence = () => vi.spyOn(console, 'error').mockImplementation(() => undefined)

  it('shows a calm Czech screen with a reload button instead of a blank page', () => {
    silence()
    render(h(ErrorBoundary, null, h(Bomb)))
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Ale ne, něco se pokazilo' })).toBeTruthy()
    expect(screen.getByText(/Nic se neztratilo/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Načíst znovu' })).toBeTruthy()
  })

  it('keeps the technical message in a collapsed details block', () => {
    silence()
    const { container } = render(h(ErrorBoundary, null, h(Bomb, { message: 'Něco uvnitř' })))
    const details = container.querySelector('details')
    expect(details?.hasAttribute('open')).toBe(false)
    expect(details?.textContent).toContain('Error: Něco uvnitř')
  })

  it('explains a screen that could not be downloaded in its own words', () => {
    silence()
    render(h(ErrorBoundary, null, h(Bomb, { message: 'Failed to fetch dynamically imported module: /assets/DexPage.js' })))
    expect(screen.getByText(/Nepodařilo se načíst část aplikace/)).toBeTruthy()
  })

  it('logs the error so it can be found in the console', () => {
    const spy = silence()
    render(h(ErrorBoundary, null, h(Bomb)))
    expect(spy).toHaveBeenCalled()
  })

  it('tries again when the reset key changes, for example after leaving the broken screen', () => {
    silence()
    const Page = ({ broken }: { broken: boolean }) => (broken ? h(Bomb) : h('p', null, 'Zdravá stránka'))
    const { rerender } = render(h(ErrorBoundary, { resetKey: '/a', children: h(Page, { broken: true }) }))
    expect(screen.getByRole('alert')).toBeTruthy()
    rerender(h(ErrorBoundary, { resetKey: '/b', children: h(Page, { broken: false }) }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Zdravá stránka')).toBeTruthy()
  })

  it('offers a way back to the start that clears the error', () => {
    silence()
    let broken = true
    const Page = () => (broken ? h(Bomb) : h('p', null, 'Zdravá stránka'))
    window.location.hash = '#/nekde'
    render(h(ErrorBoundary, null, h(Page)))
    broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Zpět na začátek' }))
    expect(window.location.hash).toBe('#/')
    expect(screen.getByText('Zdravá stránka')).toBeTruthy()
  })
})

describe('the component kit page', () => {
  const kit = () =>
    render(h(MemoryRouter, null, h(ToastProvider, null, h(DeviceStatusProvider, null, h(UiKitPage)), h('div', { id: 'root' }))))

  it('renders every section with one h1', () => {
    kit()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    for (const name of ['Písmo', 'Tlačítka', 'Štítky', 'Ovládací prvky', 'Zprávy na stránce', 'LCD panely', 'Průběh a hlasitost', 'Jistota', 'Dialogy a zprávy', 'Čekání', 'Prázdná stránka', 'Obrysy', 'Ikony', 'Kontrolky']) {
      expect(screen.getByRole('heading', { name }), name).toBeTruthy()
    }
  })

  it('shows the Czech pangram with all the letters that need a caron', () => {
    kit()
    expect(screen.getAllByText('Příliš žluťoučký kůň úpěl ďábelské ódy.').length).toBeGreaterThan(0)
  })

  it('opens and closes the dialog from its button', () => {
    kit()
    fireEvent.click(screen.getByRole('button', { name: 'Otevřít dialog' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('turns a filter chip on when it is tapped', () => {
    kit()
    const chip = screen.getByRole('button', { name: 'Evropa' })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('true')
  })

  it('moves the level meter with its slider', () => {
    kit()
    const slider = screen.getByRole('slider', { name: 'Hlasitost mikrofonu' })
    fireEvent.change(slider, { target: { value: '1' } })
    expect(screen.getAllByRole('meter', { name: 'Hlasitost mikrofonu' })[0]?.getAttribute('aria-valuenow')).toBe('1')
  })
})
