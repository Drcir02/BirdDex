import { lazy } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { DeviceStatusProvider } from './app/deviceStatus'
import { ErrorBoundary } from './app/ErrorBoundary'
import { FirstRunGate } from './app/FirstRunGate'
import { Layout } from './app/Layout'
import { ROUTES } from './app/routes'
import NotFoundPage from './pages/NotFoundPage'
import { ToastProvider } from './ui/Toast'

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
const UiKitPage = lazy(() => import('./pages/UiKitPage'))
// The M0 phone test keeps its own dark look and lives outside the device shell.
const FieldCheckRoute = lazy(() => import('./app/FieldCheckRoute'))
// Developer page for the sound engine (/#/dev/sound). Not in the navigation; the sound end-to-end tests use it.
const DevSoundPage = lazy(() => import('./ml/sound/DevSoundPage'))
// Developer page for the photo engine and the live scanner (/#/dev/photo). Not in the navigation; the photo end-to-end tests use it.
const DevPhotoPage = lazy(() => import('./ml/vision/DevPhotoPage'))
// Hidden page that fills the Dex with 30 demo catches (/#/dev/demo), so the screens of a full collection can be inspected.
const DemoDataPage = lazy(() => import('./features/dex/demo/DemoDataPage'))

export default function App() {
  return (
    <ErrorBoundary variant="app">
      <HashRouter>
        <ToastProvider>
          <DeviceStatusProvider>
            <Routes>
              <Route path={ROUTES.fieldCheck} element={<FieldCheckRoute />} />
              <Route path="/dev/sound" element={<DevSoundPage />} />
              <Route path="/dev/photo" element={<DevPhotoPage />} />
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
                  <Route path={ROUTES.uiKit} element={<UiKitPage />} />
                  <Route path="/dev/demo" element={<DemoDataPage />} />
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
