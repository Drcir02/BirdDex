import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ROUTES, isOpenOnFirstRun } from './routes'
import { isWelcomed } from './welcome'

/** Sends a first-time visitor to the welcome screen, whatever address they opened. */
export function FirstRunGate() {
  const { pathname } = useLocation()
  if (!isWelcomed() && !isOpenOnFirstRun(pathname)) return <Navigate to={ROUTES.welcome} replace />
  return <Outlet />
}
