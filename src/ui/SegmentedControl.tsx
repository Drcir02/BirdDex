import { useRef, type KeyboardEvent } from 'react'
import { cx, nextOptionIndex } from './logic'
import './SegmentedControl.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

export interface SegmentedControlProps<T extends string> {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  /** Names the whole group for screen readers, for example "Citlivost". */
  label: string
  className?: string
}

/** A row of exclusive choices (a radio group drawn as one switch). Arrow keys move the choice. */
export function SegmentedControl<T extends string>({ value, options, onChange, label, className }: SegmentedControlProps<T>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const selected = Math.max(0, options.findIndex((option) => option.value === value))

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = nextOptionIndex(options.length, index, event.key)
    if (target === null) return
    event.preventDefault()
    const option = options[target]
    if (!option) return
    onChange(option.value)
    buttons.current[target]?.focus()
  }

  return (
    <div className={cx('bd-seg', className)} role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => {
            buttons.current[index] = node
          }}
          type="button"
          role="radio"
          aria-checked={index === selected}
          tabIndex={index === selected ? 0 : -1}
          className={cx('bd-seg__item', index === selected && 'is-selected')}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
