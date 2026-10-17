// The scan hub: three big ways to find out which bird it is, and the "bird brain" download banner above them.
import { ROUTES } from '../app/routes'
import { ModelBanner } from '../features/scan/ModelBanner'
import { ScanTile } from '../features/scan/ScanTile'
import { useModelReadiness } from '../features/scan/useModelReadiness'
import '../features/scan/scan.css'
import { t } from '../i18n'
import { Page, PageHeader } from '../ui'

export default function ScanPage() {
  // The hub only shows whether the models are on the phone (and offers the download); the scan screens start the engines.
  const readiness = useModelReadiness('all', { autoPrepare: false })
  return (
    <Page className="bd-scan">
      <PageHeader title={t('scan.title')} subtitle={t('scan.chooseMethod')} />
      <ModelBanner readiness={readiness} kind="all" variant="hub" />
      <ul className="bd-scan-tiles" aria-label={t('scan.chooseMethod')}>
        <li>
          <ScanTile to={ROUTES.scanSound} icon="microphone" title={t('scan.hub.sound.title')} hint={t('scan.hub.sound.hint')} testId="tile-sound" />
        </li>
        <li>
          <ScanTile to={ROUTES.scanPhoto} icon="photo" title={t('scan.hub.photo.title')} hint={t('scan.hub.photo.hint')} testId="tile-photo" />
        </li>
        <li>
          <ScanTile to={ROUTES.scanLive} icon="live" title={t('scan.hub.live.title')} hint={t('scan.hub.live.hint')} testId="tile-live" />
        </li>
      </ul>
      <p className="bd-scan-privacy">{t('scan.hub.privacy')}</p>
    </Page>
  )
}
