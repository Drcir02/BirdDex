import { Icon, Spinner, cx } from '../../ui'

export interface RecordButtonProps {
  /** start: the microphone key. stop: the square "Done" key with a pulsing ring. */
  mode: 'start' | 'stop'
  label: string
  onClick: () => void
  disabled?: boolean
  /** Work is going on (the microphone is opening, the result is being worked out): shows a spinner and ignores taps. */
  busy?: boolean
}

/** The big round key of the sound screen. The whole key and its label are one button, so the tap target is generous. */
export function RecordButton({ mode, label, onClick, disabled, busy }: RecordButtonProps) {
  return (
    <button
      type="button"
      className={cx('bd-scan-rec', mode === 'stop' && 'is-on', busy && 'is-busy', disabled && !busy && 'is-off')}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-testid={mode === 'stop' ? 'sound-stop' : 'sound-start'}
    >
      <span className="bd-scan-rec__key" aria-hidden="true">
        {busy ? <Spinner size="lg" label={null} /> : mode === 'stop' ? <span className="bd-scan-rec__square" /> : <Icon name="microphone" size={46} />}
      </span>
      <span className="bd-scan-rec__label">{label}</span>
    </button>
  )
}
