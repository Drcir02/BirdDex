import type { HTMLAttributes, ReactNode } from 'react'
import { t } from '../i18n'
import { IconLink } from './IconButton'
import { cx } from './logic'
import './Page.css'

export interface PageProps extends HTMLAttributes<HTMLDivElement> {
  /** Remove the padding, for screens that fill the whole LCD (a camera view, for example). */
  bleed?: boolean
}

/** The content of a screen: a padded column that grows to fill the LCD. */
export function Page({ bleed = false, className, children, ...rest }: PageProps) {
  return (
    <div className={cx('bd-page', bleed && 'bd-page--bleed', className)} {...rest}>
      {children}
    </div>
  )
}

export interface PageHeaderProps {
  /** The one h1 of the screen. */
  title: ReactNode
  /** A line under the title. */
  subtitle?: ReactNode
  /** Adds a back button that goes to this route. */
  backTo?: string
  /** Buttons on the right of the title. */
  actions?: ReactNode
}

export function PageHeader({ title, subtitle, backTo, actions }: PageHeaderProps) {
  return (
    <header className="bd-pageheader">
      {backTo ? <IconLink to={backTo} icon="back" label={t('common.back')} /> : null}
      <div className="bd-pageheader__text">
        <h1 className="bd-pageheader__title">{title}</h1>
        {subtitle ? <p className="bd-pageheader__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="bd-pageheader__actions">{actions}</div> : null}
    </header>
  )
}
