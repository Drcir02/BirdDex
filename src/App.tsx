import { lazy } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { DeviceStatusProvider } from './app/deviceStatus'
import { ErrorBoundary } from './app/ErrorBoundary'
import { FirstRunGate } from './app/FirstRunGate'
import { Layout } from './app/Layout'
import { ROUTES } from './app/routes'
import NotFoundPage from './pages/NotFoundPage'
import { ToastProvider } from './ui/Toast'

// Written out here (not imported from app/devRoutes.ts) so the bundler sees a constant and leaves the developer pages out.
const DEV_ROUTES_ENABLED = import.meta.env.DEV || __DEV_ROUTES__

// Every screen is its own chunk, downloaded the first time it opens (the service worker caches them for offline use).
const DexPage = lazy(() => import('./pages/DexPage'))
const SpeciesPage = lazy(() => import('./pages/SpeciesPage'))
const ScanPage = lazy(() => import('./pages/ScanPage'))
const ScanSoundPage = lazy(() => import('./pages/ScanSoundPage'))
const ScanPhotoPage = lazy(() => import('./pages/ScanPhotoPage'))
const ScanLivePage = lazy(() => import('./pages/ScanLivePage'))
const ResultPage = lazy(() => import('./pages/ResultPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const AboutPage = lazy(() => import('./pages/AboutPage'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const UiKitPage = DEV_ROUTES_ENABLED ? lazy(() => import('./pages/UiKitPage')) : undefined
// The M0 phone test keeps its own dark look and lives outside the device shell.
const FieldCheckRoute = lazy(() => import('./app/FieldCheckRoute'))
// Developer pages exist only in the test build (src/app/devRoutes.ts): the build for the phone has neither the routes nor the code.
// Developer page for the sound engine (/#/dev/sound). Not in the navigation; the sound end-to-end tests use it.
const DevSoundPage = DEV_ROUTES_ENABLED ? lazy(() => import('./ml/sound/DevSoundPage')) : undefined
// Developer page for the photo engine and the live scanner (/#/dev/photo). Not in the navigation; the photo end-to-end tests use it.
const DevPhotoPage = DEV_ROUTES_ENABLED ? lazy(() => import('./ml/vision/DevPhotoPage')) : undefined
// Hidden page that fills the Dex with 30 demo catches (/#/dev/demo), so the screens of a full collection can be inspected.
const DemoDataPage = DEV_ROUTES_ENABLED ? lazy(() => import('./features/dex/demo/DemoDataPage')) : undefined

export default function App() {
  return (
    <ErrorBoundary variant="app">
      <HashRouter>
        <ToastProvider>
          <DeviceStatusProvider>
            <Routes>
              <Route path={ROUTES.fieldCheck} element={<FieldCheckRoute />} />
              {DevSoundPage ? <Route path="/dev/sound" element={<DevSoundPage />} /> : null}
              {DevPhotoPage ? <Route path="/dev/photo" element={<DevPhotoPage />} /> : null}
              <Route element={<FirstRunGate />}>
                <Route element={<Layout />}>
                  <Route index element={<DexPage />} />
                  <Route path={ROUTES.species} element={<SpeciesPage />} />
                  <Route path={ROUTES.scan} element={<ScanPage />} />
                  <Route path={ROUTES.scanSound} element={<ScanSoundPage />} />
                  <Route path={ROUTES.scanPhoto} element={<ScanPhotoPage />} />
                  <Route path={ROUTES.scanLive} element={<ScanLivePage />} />
                  <Route path={ROUTES.result} element={<ResultPage />} />
                  <Route path={ROUTES.settings} element={<SettingsPage />} />
                  <Route path={ROUTES.about} element={<AboutPage />} />
                  <Route path={ROUTES.welcome} element={<OnboardingPage />} />
                  {UiKitPage ? <Route path={ROUTES.uiKit} element={<UiKitPage />} /> : null}
                  {DemoDataPage ? <Route path="/dev/demo" element={<DemoDataPage />} /> : null}
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Route>
            </Routes>
          </DeviceStatusProvider>
        </ToastProvider>
      </HashRouter>
    </ErrorBoundary>
  )
}
