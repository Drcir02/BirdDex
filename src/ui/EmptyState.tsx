import type { ReactNode } from 'react'
import { SpeciesSilhouette } from './SpeciesSilhouette'
import { cx } from './logic'
import './EmptyState.css'

export interface EmptyStateProps {
  title: string
  message?: ReactNode
  /** The picture above the title. Default is a quiet songbird outline. */
  art?: ReactNode
  /** Usually a Button. */
  action?: ReactNode
  /** Heading level of the title. Use h1 when the empty state is the whole screen. Default h2. */
  headingLevel?: 1 | 2
  className?: string
}

/** What to show instead of an empty list: a picture, one sentence and the next step. */
export function EmptyState({ title, message, art, action, headingLevel = 2, className }: EmptyStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <div className={cx('bd-empty', className)}>
      <div className="bd-empty__art">{art ?? <SpeciesSilhouette size={96} />}</div>
      <Heading className="bd-empty__title">{title}</Heading>
      {message ? <p className="bd-empty__message">{message}</p> : null}
      {action ? <div className="bd-empty__action">{action}</div> : null}
    </div>
  )
}
