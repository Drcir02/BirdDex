// The route table in one place (HashRouter paths). Pages link with these constants instead of typing paths by hand.

export const ROUTES = {
  dex: '/',
  species: '/species/:id',
  birds: '/birds',
  bird: '/birds/:id',
  scan: '/scan',
  scanSound: '/scan/sound',
  scanPhoto: '/scan/photo',
  scanLive: '/scan/live',
  result: '/result',
  settings: '/settings',
  about: '/about',
  welcome: '/welcome',
  fieldCheck: '/field-check',
  uiKit: '/ui-kit',
} as const

/** The path of one bird's detail screen. */
export function speciesPath(id: string): string {
  return `/species/${encodeURIComponent(id)}`
}

/** The path of one caught bird (one catch) with its BP. */
export function birdPath(catchId: string): string {
  return `/birds/${encodeURIComponent(catchId)}`
}

export type NavSection = 'birds' | 'scan' | 'dex'

/** Which bottom-navigation button a path belongs to (null for screens outside the navigation). */
export function sectionOf(pathname: string): NavSection | null {
  if (pathname === '/' || pathname === '/species' || pathname.startsWith('/species/')) return 'dex'
  if (pathname === '/birds' || pathname.startsWith('/birds/')) return 'birds'
  if (pathname === '/scan' || pathname.startsWith('/scan/') || pathname === '/result') return 'scan'
  return null
}

/** The settings screen and the About page behind it, reached with the gear at the top of the device. */
export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname === '/about'
}

/** Paths that open even before the welcome screen has been seen. */
export function isOpenOnFirstRun(pathname: string): boolean {
  return pathname === ROUTES.welcome || pathname === ROUTES.uiKit || pathname === ROUTES.fieldCheck
}
