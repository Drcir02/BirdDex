import { t } from '../../i18n'
import { cx } from '../../ui'
import './fun.css'

export interface NewBadgeProps {
  className?: string
}

/**
 * A stamp that pops onto the first catch of a species. It is a plain label: with reduced motion it just sits there.
 * Decorative (the screen says "Nový druh" in words elsewhere), so it is hidden from screen readers.
 */
export function NewBadge({ className }: NewBadgeProps) {
  return (
    <span className={cx('bd-fun-newbadge', className)} data-testid="new-badge" aria-hidden="true">
      {t('fun.newBadge')}
    </span>
  )
}
