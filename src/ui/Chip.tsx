import type { ReactNode } from 'react'
import type { Rarity } from '../domain/types'
import { Icon, type IconName } from './icons'
import { cx } from './logic'
import './Chip.css'

export type ChipTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | Rarity

export interface ChipProps {
  tone?: ChipTone
  icon?: IconName
  children: ReactNode
  className?: string
  /** Makes the chip a toggle button (a filter, for example). It is then 44 px high. */
  onClick?: () => void
  /** For toggle chips: whether the filter is on. */
  selected?: boolean
  disabled?: boolean
  'data-testid'?: string
}

/** A small label. With onClick it becomes a toggle button. */
export function Chip({ tone = 'neutral', icon, children, className, onClick, selected = false, disabled, 'data-testid': testId }: ChipProps) {
  const classes = cx('bd-chip', `bd-chip--${tone}`, selected && 'is-selected', className)
  const content = (
    <>
      {icon ? <Icon name={icon} size={16} /> : null}
      <span>{children}</span>
    </>
  )
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} aria-pressed={selected} disabled={disabled} data-testid={testId}>
        {content}
      </button>
    )
  }
  return (
    <span className={classes} data-testid={testId}>
      {content}
    </span>
  )
}
