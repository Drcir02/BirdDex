import { Link, useLocation } from 'react-router-dom'
import { t } from '../i18n'
import { Icon, type IconName } from '../ui/icons'
import { cx } from '../ui/logic'
import { ROUTES, sectionOf, type NavSection } from './routes'

interface NavItem {
  section: NavSection
  to: string
  icon: IconName
  label: () => string
}

const ITEMS: readonly NavItem[] = [
  { section: 'dex', to: ROUTES.dex, icon: 'dex', label: () => t('common.nav.dex') },
  { section: 'scan', to: ROUTES.scan, icon: 'scan', label: () => t('common.nav.scan') },
  { section: 'settings', to: ROUTES.settings, icon: 'settings', label: () => t('common.nav.settings') },
]

interface BottomNavProps {
  /** Called when the person taps the button of the screen they are already on, as phone apps do to jump back to the top. */
  onReselect?: () => void
}

/** The three big buttons at the bottom of the device: Dex, Scan, Settings. */
export function BottomNav({ onReselect }: BottomNavProps) {
  const { pathname } = useLocation()
  const active = sectionOf(pathname)
  return (
    <nav className="bd-nav" aria-label={t('common.nav.label')}>
      <ul className="bd-nav__list">
        {ITEMS.map((item) => (
          <li key={item.section} className={cx('bd-nav__item', item.section === 'scan' && 'bd-nav__item--scan')}>
            <Link
              to={item.to}
              className={cx('bd-nav__link', item.section === 'scan' && 'bd-nav__link--scan')}
              aria-current={active === item.section ? 'page' : undefined}
              data-testid={`nav-${item.section}`}
              onClick={(event) => {
                if (pathname !== item.to) return
                event.preventDefault()
                onReselect?.()
              }}
            >
              <Icon name={item.icon} size={30} />
              <span className="bd-nav__label">{item.label()}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
