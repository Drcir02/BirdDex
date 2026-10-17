import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { Icon, type IconName } from './icons'
import { cx } from './logic'
import { Spinner } from './Spinner'
import './Button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'md' | 'lg'

interface LookProps {
  variant?: ButtonVariant
  /** md is 44 px high (the touch minimum), lg is 56 px for the main action of a screen. */
  size?: ButtonSize
  icon?: IconName
  fullWidth?: boolean
}

function look({ variant = 'primary', size = 'md', fullWidth }: LookProps, extra?: string): string {
  return cx('bd-btn', `bd-btn--${variant}`, size === 'lg' && 'bd-btn--lg', fullWidth && 'bd-btn--full', extra)
}

function Content({ icon, size = 'md', busy, children }: { icon?: IconName; size?: ButtonSize; busy?: boolean; children?: ReactNode }): ReactNode {
  return (
    <>
      {busy ? <Spinner size="sm" label={null} /> : icon ? <Icon name={icon} size={size === 'lg' ? 28 : 22} /> : null}
      {children !== undefined && children !== null && <span className="bd-btn__label">{children}</span>}
    </>
  )
}

export interface ButtonProps extends ComponentPropsWithRef<'button'>, LookProps {
  /** Shows a spinner and ignores taps until the work is done. */
  busy?: boolean
}

export function Button({ variant, size, icon, fullWidth, busy, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={look({ variant, size, fullWidth }, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      <Content icon={icon} size={size} busy={busy}>
        {children}
      </Content>
    </button>
  )
}

export interface ButtonLinkProps extends Omit<LinkProps, 'className'>, LookProps {
  className?: string
}

/** A link that looks like a button, for moving between screens. */
export function ButtonLink({ variant, size, icon, fullWidth, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={look({ variant, size, fullWidth }, className)} {...rest}>
      <Content icon={icon} size={size}>
        {children}
      </Content>
    </Link>
  )
}
