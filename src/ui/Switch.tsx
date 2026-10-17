import type { ReactNode } from 'react'
import { cx } from './logic'
import './Switch.css'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** What the switch controls. It is part of the button, so tapping the words toggles too. */
  label: ReactNode
  /** A second, quieter line under the label. */
  description?: ReactNode
  disabled?: boolean
  className?: string
}

/** An on/off setting. */
export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={cx('bd-switch', checked && 'is-on', className)} onClick={() => onChange(!checked)}>
      <span className="bd-switch__text">
        <span className="bd-switch__label">{label}</span>
        {description ? <span className="bd-switch__description">{description}</span> : null}
      </span>
      <span className="bd-switch__track" aria-hidden="true">
        <span className="bd-switch__knob" />
      </span>
    </button>
  )
}
