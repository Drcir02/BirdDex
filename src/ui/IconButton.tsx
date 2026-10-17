import type { ButtonHTMLAttributes } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { Icon, type IconName } from './icons'
import { cx } from './logic'
import './IconButton.css'

interface LookProps {
  icon: IconName
  /** What the button does. It is the accessible name and the tooltip. */
  label: string
  /** solid is a raised round key, ghost is just the icon. */
  variant?: 'solid' | 'ghost'
  size?: number
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>, LookProps {}

export function IconButton({ icon, label, variant = 'solid', size = 24, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx('bd-iconbtn', `bd-iconbtn--${variant}`, className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  )
}

export interface IconLinkProps extends Omit<LinkProps, 'children' | 'className' | 'aria-label'>, LookProps {
  className?: string
}

/** The same round key, but a link between screens. */
export function IconLink({ icon, label, variant = 'solid', size = 24, className, ...rest }: IconLinkProps) {
  return (
    <Link className={cx('bd-iconbtn', `bd-iconbtn--${variant}`, className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </Link>
  )
}
