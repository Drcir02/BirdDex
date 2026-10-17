import type { ChangeEvent } from 'react'
import { Icon, cx, type IconName } from '../../ui'

export interface PickButtonProps {
  icon: IconName
  label: string
  /** Opens the phone's camera app instead of the photo library (phones only; computers show the file dialog). */
  camera?: boolean
  variant?: 'primary' | 'secondary'
  size?: 'md' | 'lg'
  disabled?: boolean
  onFile: (file: File | undefined) => void
  testId?: string
}

/**
 * A button that opens the phone's file picker. It is a <label> around a real file input, which is the most dependable
 * way to open the picker on iPhones and Android phones, and it looks like every other button of the app.
 */
export function PickButton({ icon, label, camera = false, variant = 'secondary', size = 'lg', disabled = false, onFile, testId }: PickButtonProps) {
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Clear the input, so choosing the same photo twice in a row still counts as a choice.
    event.target.value = ''
    onFile(file)
  }
  return (
    <label className={cx('bd-btn', `bd-btn--${variant}`, size === 'lg' && 'bd-btn--lg', 'bd-btn--full', 'bd-scan-file')} aria-disabled={disabled || undefined}>
      <Icon name={icon} size={size === 'lg' ? 28 : 22} />
      <span className="bd-btn__label">{label}</span>
      <input type="file" accept="image/*" {...(camera ? { capture: 'environment' as const } : {})} className="bd-sr-only" disabled={disabled} onChange={change} data-testid={testId} />
    </label>
  )
}
