import { Suspense, useEffect, useRef } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useSpecies } from '../data/useSpecies'
import { syncBirdPointsOnce } from '../features/birds/syncBirdPoints'
import { t } from '../i18n'
import { Icon } from '../ui/icons'
import { Spinner } from '../ui/Spinner'
import { ToastViewport } from '../ui/Toast'
import { BottomNav } from './BottomNav'
import { APP_NAME } from './constants'
import { useDeviceStatus } from './deviceStatus'
import { ErrorBoundary } from './ErrorBoundary'
import { Leds } from './Leds'
import { Lens } from './Lens'
import { ROUTES, isSettingsPath } from './routes'
import { UpdateBanner } from './UpdateBanner'
import { useDocumentTitle, useScrollMemory } from './useShell'
import '../styles/shell.css'

function RouteFallback() {
  return (
    <div className="bd-fallback">
      <Spinner size="lg" label={null} />
      <p role="status">{t('common.loading')}</p>
    </div>
  )
}

/**
 * The Pokedex-style device around every screen: red body, lens and lights on top, the green LCD in the middle holding
 * the routed page, and the three big navigation buttons at the bottom.
 */
export function Layout() {
  const { pathname } = useLocation()
  const { status } = useDeviceStatus()
  const scroller = useRef<HTMLDivElement>(null)
  useDocumentTitle()
  useScrollMemory(scroller)
  // BirdPoints for catches from before they existed, and for a bird whose range changed (see syncBirdPoints.ts).
  const { species } = useSpecies()
  useEffect(() => {
    if (species) void syncBirdPointsOnce(species).catch(() => undefined)
  }, [species])
  const showNav = pathname !== ROUTES.welcome
  const scrollToTop = () => {
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    scroller.current?.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' })
  }

  return (
    <div className="bd-stage">
      <div className={showNav ? 'bd-device' : 'bd-device bd-device--no-nav'} data-status={status} data-testid="device">
        <header className="bd-top">
          <Lens />
          <Leds />
          <div className="bd-top__brand">
            <span className="bd-wordmark" aria-hidden="true">
              {APP_NAME}
            </span>
            <Link
              to={ROUTES.settings}
              className="bd-top__gear"
              aria-label={t('common.nav.settings')}
              aria-current={isSettingsPath(pathname) ? 'page' : undefined}
              data-testid="nav-settings"
            >
              <Icon name="settings" size={26} />
            </Link>
          </div>
        </header>

        <main className="bd-screen">
          <div className="bd-bezel">
            <div className="bd-lcd-wrap">
              <div className="bd-lcd bd-text" ref={scroller} data-testid="screen">
                <ErrorBoundary resetKey={pathname}>
                  <Suspense fallback={<RouteFallback />}>
                    <Outlet />
                  </Suspense>
                </ErrorBoundary>
              </div>
              <UpdateBanner />
              <ToastViewport />
            </div>
            <div className="bd-bezel__foot" aria-hidden="true">
              <span className="bd-dot bd-dot--red" />
              <span className="bd-dot" />
              <span className="bd-grille bd-grille--dark">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        </main>

        {showNav ? <BottomNav onReselect={scrollToTop} /> : null}
      </div>
    </div>
  )
}
