import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../../ui'

export interface ScanTileProps {
  to: string
  icon: IconName
  title: string
  hint: string
  testId?: string
}

/** One of the three big buttons of the hub: a dark icon window, the way of identifying, and a line about it. */
export function ScanTile({ to, icon, title, hint, testId }: ScanTileProps) {
  return (
    <Link to={to} className="bd-scan-tile" data-testid={testId}>
      <span className="bd-scan-tile__badge" aria-hidden="true">
        <Icon name={icon} size={34} />
      </span>
      <span className="bd-scan-tile__text">
        <span className="bd-scan-tile__title">{title}</span>
        <span className="bd-scan-tile__hint">{hint}</span>
      </span>
      <Icon name="chevron" size={24} className="bd-scan-tile__chevron" />
    </Link>
  )
}
