import { useRef } from 'react'
import { t } from '../i18n'
import { Icon } from './icons'
import { IconButton } from './IconButton'
import { cx } from './logic'
import './SearchField.css'

export interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  /** Names the field for screen readers, for example "Hledat v Dexu". */
  label: string
  placeholder?: string
  className?: string
}

/** A search box with a magnifier and a clear button. Plain text input underneath, so the phone keyboard shows Search. */
export function SearchField({ value, onChange, label, placeholder, className }: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className={cx('bd-search', className)} role="search">
      <Icon name="search" size={22} className="bd-search__icon" />
      <input
        ref={input}
        className="bd-search__input"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
      {value !== '' && (
        <IconButton
          variant="ghost"
          icon="close"
          size={20}
          label={t('common.clear')}
          onClick={() => {
            onChange('')
            input.current?.focus()
          }}
        />
      )}
    </div>
  )
}
