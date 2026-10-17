// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement as h, useState, type ReactElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, ButtonLink } from '../../src/ui/Button'
import { Chip } from '../../src/ui/Chip'
import { ConfidenceBar } from '../../src/ui/ConfidenceBar'
import { ConfirmDialog } from '../../src/ui/ConfirmDialog'
import { EmptyState } from '../../src/ui/EmptyState'
import { ICON_NAMES, Icon } from '../../src/ui/icons'
import { IconButton } from '../../src/ui/IconButton'
import { LcdPanel } from '../../src/ui/LcdPanel'
import { LevelMeter } from '../../src/ui/LevelMeter'
import { Notice } from '../../src/ui/Notice'
import { Page, PageHeader } from '../../src/ui/Page'
import { ProgressRing } from '../../src/ui/ProgressRing'
import { SearchField } from '../../src/ui/SearchField'
import { SegmentedControl } from '../../src/ui/SegmentedControl'
import { SpeciesSilhouette } from '../../src/ui/SpeciesSilhouette'
import { Spinner } from '../../src/ui/Spinner'
import { Switch } from '../../src/ui/Switch'
import { ToastProvider, ToastViewport, useToast } from '../../src/ui/Toast'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const inRouter = (node: ReactNode): ReactElement => h(MemoryRouter, null, node)

describe('Button', () => {
  it('is a button of type "button" with the variant as a class, and reacts to clicks', () => {
    const onClick = vi.fn()
    render(h(Button, { variant: 'danger', onClick }, 'Smazat'))
    const button = screen.getByRole('button', { name: 'Smazat' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.className).toContain('bd-btn--danger')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('ignores taps and says it is busy while work runs', () => {
    const onClick = vi.fn()
    render(h(Button, { busy: true, onClick }, 'Ukládám'))
    const button = screen.getByRole('button', { name: /Ukládám/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('passes a ref to the button element', () => {
    let element: HTMLButtonElement | null = null
    render(
      h(
        Button,
        {
          ref: (node: HTMLButtonElement | null) => {
            element = node
          },
        },
        'Ref',
      ),
    )
    expect(element).toBeInstanceOf(HTMLButtonElement)
  })

  it('has a link twin that goes to a route', () => {
    render(inRouter(h(ButtonLink, { to: '/scan', icon: 'scan' }, 'Skenovat')))
    const link = screen.getByRole('link', { name: 'Skenovat' })
    expect(link.getAttribute('href')).toBe('/scan')
    expect(link.className).toContain('bd-btn')
  })
})

describe('IconButton', () => {
  it('uses the label as accessible name and tooltip', () => {
    render(h(IconButton, { icon: 'close', label: 'Zavřít' }))
    const button = screen.getByRole('button', { name: 'Zavřít' })
    expect(button.getAttribute('title')).toBe('Zavřít')
  })
})

describe('Chip', () => {
  it('is plain text when it has no click handler', () => {
    render(h(Chip, { tone: 'rare', children: 'Vzácný' }))
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Vzácný').closest('.bd-chip')?.className).toContain('bd-chip--rare')
  })

  it('becomes a toggle button with aria-pressed when it has a click handler', () => {
    const onClick = vi.fn()
    const { rerender } = render(h(Chip, { onClick, selected: false, children: 'Česko' }))
    const chip = screen.getByRole('button', { name: 'Česko' })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(chip)
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(h(Chip, { onClick, selected: true, children: 'Česko' }))
    expect(screen.getByRole('button', { name: 'Česko' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('LcdPanel', () => {
  it('labels the section with its title', () => {
    render(h(LcdPanel, { title: 'Detail' }, h('p', null, 'Obsah')))
    const region = screen.getByRole('region', { name: 'Detail' })
    expect(within(region).getByRole('heading', { level: 2, name: 'Detail' })).toBeTruthy()
  })

  it('can use a level-3 heading and the dark tone', () => {
    const { container } = render(h(LcdPanel, { title: 'Tmavý', titleLevel: 3, tone: 'dark' }, 'x'))
    expect(screen.getByRole('heading', { level: 3 })).toBeTruthy()
    expect(container.querySelector('.bd-lcdpanel--dark')).not.toBeNull()
  })
})

describe('ProgressRing', () => {
  it('is a progressbar with the percentage and a Czech default name', () => {
    render(h(ProgressRing, { value: 0.356, label: '36 %' }))
    const ring = screen.getByRole('progressbar', { name: 'Průběh' })
    expect(ring.getAttribute('aria-valuenow')).toBe('36')
    expect(ring.getAttribute('aria-valuemin')).toBe('0')
    expect(ring.getAttribute('aria-valuemax')).toBe('100')
    expect(screen.getByText('36 %')).toBeTruthy()
  })

  it('draws the empty part of the circle through the dash offset', () => {
    const { container } = render(h(ProgressRing, { value: 0.25 }))
    expect(container.querySelector('.bd-ring__value')?.getAttribute('stroke-dashoffset')).toBe('75')
  })

  it('shrinks its label with the ring so it stays inside', () => {
    const small = render(h(ProgressRing, { value: 1, size: 56, label: '100 %' }))
    const smallSize = parseInt((small.container.querySelector('.bd-ring__label') as HTMLElement).style.fontSize, 10)
    small.unmount()
    const large = render(h(ProgressRing, { value: 1, size: 128, label: '100 %' }))
    const largeSize = parseInt((large.container.querySelector('.bd-ring__label') as HTMLElement).style.fontSize, 10)
    expect(smallSize).toBeGreaterThanOrEqual(8)
    expect(largeSize).toBeGreaterThan(smallSize)
  })

  it('has no value while it is indeterminate', () => {
    render(h(ProgressRing, { indeterminate: true }))
    expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false)
  })
})

describe('LevelMeter', () => {
  it('lights the right number of lights and reports the level', () => {
    const { container } = render(h(LevelMeter, { level: 0.5, segments: 10 }))
    const meter = screen.getByRole('meter', { name: 'Hlasitost' })
    expect(meter.getAttribute('aria-valuenow')).toBe('0.5')
    expect(container.querySelectorAll('.bd-meter__seg')).toHaveLength(10)
    expect(container.querySelectorAll('.bd-meter__seg.is-lit')).toHaveLength(5)
  })

  it('stays dark for silence and clamps a level above 1', () => {
    const silent = render(h(LevelMeter, { level: 0 }))
    expect(silent.container.querySelectorAll('.is-lit')).toHaveLength(0)
    silent.unmount()
    const loud = render(h(LevelMeter, { level: 4, segments: 8 }))
    expect(loud.container.querySelectorAll('.is-lit')).toHaveLength(8)
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('1')
  })
})

describe('ConfidenceBar', () => {
  it('writes the percentage the Czech way and names itself for screen readers', () => {
    render(h(ConfidenceBar, { value: 0.853 }))
    const bar = screen.getByRole('meter')
    expect(bar.getAttribute('aria-valuetext')).toMatch(/^85\s%$/)
    expect(bar.getAttribute('aria-label')).toMatch(/^Jistota 85\s%$/)
    expect(bar.className).toContain('bd-conf--neutral')
  })

  it('shows whether the catch threshold is reached', () => {
    const below = render(h(ConfidenceBar, { value: 0.5, threshold: 0.7 }))
    expect(screen.getByRole('meter').className).toContain('bd-conf--below')
    expect(below.container.querySelector('.bd-conf__mark')).not.toBeNull()
    below.unmount()
    render(h(ConfidenceBar, { value: 0.8, threshold: 0.7 }))
    expect(screen.getByRole('meter').className).toContain('bd-conf--met')
  })

  it('can hide the number', () => {
    const { container } = render(h(ConfidenceBar, { value: 0.5, showValue: false }))
    expect(container.querySelector('.bd-conf__value')).toBeNull()
  })
})

describe('Spinner', () => {
  it('announces itself as a status with a Czech default text', () => {
    render(h(Spinner))
    expect(screen.getByRole('status', { name: 'Načítám…' })).toBeTruthy()
  })

  it('can be purely decorative', () => {
    const { container } = render(h(Spinner, { label: null }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('EmptyState', () => {
  it('shows the picture, title, message and action', () => {
    render(h(EmptyState, { title: 'Nic tu není', message: 'Zkus to jinak.', action: h(Button, null, 'Jdu na to') }))
    expect(screen.getByRole('heading', { level: 2, name: 'Nic tu není' })).toBeTruthy()
    expect(screen.getByText('Zkus to jinak.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Jdu na to' })).toBeTruthy()
  })

  it('can be the h1 of a whole screen', () => {
    render(h(EmptyState, { title: 'Tady nic není', headingLevel: 1 }))
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  })
})

describe('SpeciesSilhouette', () => {
  it('is decoration unless it gets a title', () => {
    const { container } = render(h(SpeciesSilhouette))
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    cleanup()
    render(h(SpeciesSilhouette, { title: 'Obrys ptáka' }))
    expect(screen.getByRole('img', { name: 'Obrys ptáka' })).toBeTruthy()
  })

  it('picks the outline from the family unless a shape is given', () => {
    const duck = render(h(SpeciesSilhouette, { family: 'Anatidae' }))
    expect(duck.container.querySelector('svg')?.getAttribute('data-shape')).toBe('duck')
    duck.unmount()
    const owl = render(h(SpeciesSilhouette, { family: 'Anatidae', shape: 'owl' }))
    expect(owl.container.querySelector('svg')?.getAttribute('data-shape')).toBe('owl')
  })

  it('can be tinted', () => {
    const { container } = render(h(SpeciesSilhouette, { color: 'rgb(1, 2, 3)', size: 40 }))
    const svg = container.querySelector('svg')
    expect(svg?.style.color).toBe('rgb(1, 2, 3)')
    expect(svg?.getAttribute('width')).toBe('40')
  })
})

describe('Icon', () => {
  it('has every icon the brief asks for', () => {
    for (const name of ['dex', 'scan', 'settings', 'microphone', 'camera', 'photo', 'live', 'check', 'close', 'play', 'pause', 'location', 'calendar', 'bird']) {
      expect(ICON_NAMES).toContain(name)
    }
  })

  it('draws something for every icon and hides it from screen readers by default', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(h(Icon, { name }))
      const svg = container.querySelector('svg')
      expect(svg, name).not.toBeNull()
      expect(svg?.getAttribute('aria-hidden'), name).toBe('true')
      expect(svg?.querySelector('path, circle, rect, line'), name).not.toBeNull()
      unmount()
    }
  })

  it('gets an accessible name when it carries meaning', () => {
    render(h(Icon, { name: 'warning', title: 'Varování' }))
    expect(screen.getByRole('img', { name: 'Varování' })).toBeTruthy()
  })
})

describe('Page and PageHeader', () => {
  it('has one h1 and a back link when asked', () => {
    render(inRouter(h(Page, null, h(PageHeader, { title: 'Nastavení', backTo: '/', subtitle: 'Vše na jednom místě' }))))
    expect(screen.getByRole('heading', { level: 1, name: 'Nastavení' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Zpět' }).getAttribute('href')).toBe('/')
    expect(screen.getByText('Vše na jednom místě')).toBeTruthy()
  })

  it('has no back link by default', () => {
    render(inRouter(h(PageHeader, { title: 'Dex' })))
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('ConfirmDialog', () => {
  const Harness = ({ tone, onConfirm, onCancel, busy }: { tone?: 'default' | 'danger'; onConfirm?: () => void; onCancel?: () => void; busy?: boolean }) => {
    const [open, setOpen] = useState(false)
    return h(
      'div',
      { id: 'root' },
      h('button', { onClick: () => setOpen(true) }, 'Otevřít'),
      h(ConfirmDialog, {
        open,
        tone,
        busy,
        title: 'Chytit sýkoru?',
        message: h('p', null, 'Uložím ji do Dexu.'),
        onConfirm: () => {
          onConfirm?.()
          setOpen(false)
        },
        onCancel: () => {
          onCancel?.()
          setOpen(false)
        },
      }),
    )
  }

  const open = () => {
    const opener = screen.getByRole('button', { name: 'Otevřít' })
    opener.focus()
    fireEvent.click(opener)
  }

  it('renders nothing while closed', () => {
    render(h(Harness))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('is an accessible modal with a title, a message and Czech default buttons', () => {
    render(h(Harness))
    open()
    const dialog = screen.getByRole('alertdialog', { name: 'Chytit sýkoru?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
    expect(within(dialog).getByText('Uložím ji do Dexu.')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Zrušit' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Potvrdit' })).toBeTruthy()
  })

  it('puts the first focus on the confirm button, or on Cancel for a dangerous question', () => {
    const first = render(h(Harness))
    open()
    expect(document.activeElement?.textContent).toBe('Potvrdit')
    first.unmount()
    render(h(Harness, { tone: 'danger' }))
    open()
    expect(document.activeElement?.textContent).toBe('Zrušit')
  })

  it('keeps Tab inside the dialog in both directions', () => {
    render(h(Harness))
    open()
    expect(document.activeElement?.textContent).toBe('Potvrdit')
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })
    expect(document.activeElement?.textContent).toBe('Zrušit')
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' })
    expect(document.activeElement?.textContent).toBe('Potvrdit')
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab', shiftKey: true })
    expect(document.activeElement?.textContent).toBe('Zrušit')
  })

  it('cancels on Escape and gives focus back to the button that opened it', () => {
    const onCancel = vi.fn()
    render(h(Harness, { onCancel }))
    open()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement?.textContent).toBe('Otevřít')
  })

  it('cancels when the dark area around the box is tapped, but not when the box is', () => {
    const onCancel = vi.fn()
    render(h(Harness, { onCancel }))
    open()
    fireEvent.click(screen.getByRole('alertdialog'))
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('.bd-dialog-scrim') as Element)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('confirms and cancels with the buttons', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(h(Harness, { onConfirm, onCancel }))
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Potvrdit' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Zrušit' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('waits while busy: Escape and the backdrop do nothing', () => {
    const onCancel = vi.fn()
    render(h(Harness, { onCancel, busy: true }))
    open()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    fireEvent.click(document.querySelector('.bd-dialog-scrim') as Element)
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('keeps the page behind it inert while open and releases it afterwards', () => {
    render(h(Harness))
    const root = document.getElementById('root') as HTMLElement & { inert: boolean }
    open()
    expect(root.inert).toBe(true)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(root.inert).toBe(false)
  })
})

describe('Toast', () => {
  const Trigger = ({ text, tone }: { text: string; tone?: 'info' | 'success' | 'error' }) => {
    const toast = useToast()
    return h('button', { onClick: () => toast.show(text, { tone }) }, `Ukaž ${text}`)
  }
  const setup = (...children: ReactElement[]) => render(h(ToastProvider, null, ...children, h(ToastViewport)))

  it('shows a message and hides it by itself after its time', () => {
    vi.useFakeTimers()
    setup(h(Trigger, { text: 'Máš ho!' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ukaž Máš ho!' }))
    expect(screen.getByText('Máš ho!')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.queryByText('Máš ho!')).toBeNull()
  })

  it('has a close button with a Czech name', () => {
    setup(h(Trigger, { text: 'Zpráva' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ukaž Zpráva' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skrýt zprávu' }))
    expect(screen.queryByText('Zpráva')).toBeNull()
  })

  it('announces errors as alerts and keeps the others in a polite live region', () => {
    setup(h(Trigger, { text: 'Mikrofon je zablokovaný.', tone: 'error' }), h(Trigger, { text: 'Hotovo', tone: 'success' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ukaž Mikrofon je zablokovaný.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ukaž Hotovo' }))
    expect(screen.getByRole('alert').textContent).toContain('Mikrofon je zablokovaný.')
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain('Hotovo')
  })

  it('refuses to work without its provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(h(Trigger, { text: 'x' }))).toThrow(/ToastProvider/)
    spy.mockRestore()
  })
})

describe('SegmentedControl', () => {
  const options = [
    { value: 'strict', label: 'Přísná' },
    { value: 'normal', label: 'Běžná' },
    { value: 'easy', label: 'Shovívavá' },
  ] as const
  type Choice = (typeof options)[number]['value']

  const Harness = ({ initial = 'normal', onChange }: { initial?: Choice; onChange?: (value: Choice) => void }) => {
    const [value, setValue] = useState<Choice>(initial)
    return h(SegmentedControl<Choice>, {
      label: 'Citlivost',
      value,
      options,
      onChange: (next) => {
        setValue(next)
        onChange?.(next)
      },
    })
  }

  it('is a named radio group with the current choice checked', () => {
    render(h(Harness))
    const group = screen.getByRole('radiogroup', { name: 'Citlivost' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((radio) => radio.textContent)).toEqual(['Přísná', 'Běžná', 'Shovívavá'])
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  })

  it('only the checked choice is in the tab order', () => {
    render(h(Harness))
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
  })

  it('changes the choice when tapped', () => {
    const onChange = vi.fn()
    render(h(Harness, { onChange }))
    fireEvent.click(screen.getByRole('radio', { name: 'Shovívavá' }))
    expect(onChange).toHaveBeenCalledWith('easy')
    expect(screen.getByRole('radio', { name: 'Shovívavá' }).getAttribute('aria-checked')).toBe('true')
  })

  it('moves the choice and the focus with the arrow keys, wrapping around', () => {
    render(h(Harness, { initial: 'easy' }))
    const easy = screen.getByRole('radio', { name: 'Shovívavá' })
    easy.focus()
    fireEvent.keyDown(easy, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Přísná' }).getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement?.textContent).toBe('Přísná')
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'Shovívavá' }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('Switch', () => {
  it('is a switch that reports its state and toggles when tapped', () => {
    const onChange = vi.fn()
    const { rerender } = render(h(Switch, { checked: false, onChange, label: 'Ukládat místo' }))
    const toggle = screen.getByRole('switch', { name: 'Ukládat místo' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
    rerender(h(Switch, { checked: true, onChange, label: 'Ukládat místo' }))
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it('toggles when the words are tapped and shows its description', () => {
    const onChange = vi.fn()
    render(h(Switch, { checked: false, onChange, label: 'Poloha', description: 'Zůstane v telefonu.' }))
    fireEvent.click(screen.getByText('Poloha'))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(screen.getByText('Zůstane v telefonu.')).toBeTruthy()
  })

  it('does nothing when disabled', () => {
    const onChange = vi.fn()
    render(h(Switch, { checked: false, onChange, label: 'Poloha', disabled: true }))
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SearchField', () => {
  const Harness = ({ onChange }: { onChange?: (value: string) => void }) => {
    const [value, setValue] = useState('')
    return h(SearchField, {
      label: 'Hledat ptáka',
      placeholder: 'Hledej ptáka…',
      value,
      onChange: (next) => {
        setValue(next)
        onChange?.(next)
      },
    })
  }

  it('is a labelled search box with a placeholder and no clear button while empty', () => {
    render(h(Harness))
    expect(screen.getByRole('search')).toBeTruthy()
    const input = screen.getByRole('searchbox', { name: 'Hledat ptáka' })
    expect(input.getAttribute('placeholder')).toBe('Hledej ptáka…')
    expect(screen.queryByRole('button', { name: 'Vymazat' })).toBeNull()
  })

  it('reports what is typed, even with Czech letters', () => {
    const onChange = vi.fn()
    render(h(Harness, { onChange }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'sýkora' } })
    expect(onChange).toHaveBeenCalledWith('sýkora')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('sýkora')
  })

  it('clears with its button and puts the cursor back in the box', () => {
    const onChange = vi.fn()
    render(h(Harness, { onChange }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'čáp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vymazat' }))
    expect(onChange).toHaveBeenLastCalledWith('')
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(screen.getByRole('searchbox'))
    expect(screen.queryByRole('button', { name: 'Vymazat' })).toBeNull()
  })
})

describe('Notice', () => {
  it('announces an error at once and gives the next step', () => {
    const onRetry = vi.fn()
    render(
      h(Notice, {
        tone: 'error',
        title: 'Mikrofon je zablokovaný',
        children: 'Povol ho v nastavení.',
        action: h(Button, { onClick: onRetry }, 'Zkusit znovu'),
      }),
    )
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Mikrofon je zablokovaný')).toBeTruthy()
    expect(within(alert).getByText('Povol ho v nastavení.')).toBeTruthy()
    fireEvent.click(within(alert).getByRole('button', { name: 'Zkusit znovu' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('is a polite status for everything that is not an error', () => {
    for (const tone of ['info', 'success', 'warning'] as const) {
      const { unmount } = render(h(Notice, { tone, children: `Zpráva ${tone}` }))
      expect(screen.getByRole('status').textContent).toContain(`Zpráva ${tone}`)
      expect(screen.queryByRole('alert')).toBeNull()
      unmount()
    }
  })

  it('works with just a title', () => {
    render(h(Notice, { title: 'Tip' }))
    expect(screen.getByText('Tip')).toBeTruthy()
  })
})
