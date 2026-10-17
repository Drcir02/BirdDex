import { useEffect, useState } from 'react'
import { t } from '../../i18n'
import { Button, Icon, Notice, type IconName } from '../../ui'
import { approxMegabytes } from '../scan/format'
import { promptInstall, useInstallState, type InstallOutcome } from './install'
import { queryPermission, requestPermission, type PermissionKind, type PermissionResult } from './permissions'
import './onboarding.css'

/** The size shown for "asi 90 MB" when the model list is not known (the sizes come from the model store when it is). */
export const DEFAULT_DOWNLOAD_MB = 90

function Row({ icon, title, children }: { icon: IconName; title: string; children: string }) {
  return (
    <li className="bd-onb-row">
      <span className="bd-onb-row__icon" aria-hidden="true">
        <Icon name={icon} size={30} />
      </span>
      <div>
        <h3 className="bd-onb-row__title">{title}</h3>
        <p>{children}</p>
      </div>
    </li>
  )
}

export function IdeaStep() {
  return (
    <div className="bd-onb-step" data-testid="onboarding-idea">
      <p>{t('onboarding.idea.lead')}</p>
      <ul className="bd-onb-rows">
        <Row icon="microphone" title={t('onboarding.idea.listenTitle')}>
          {t('onboarding.idea.listen')}
        </Row>
        <Row icon="camera" title={t('onboarding.idea.shootTitle')}>
          {t('onboarding.idea.shoot')}
        </Row>
        <Row icon="bird" title={t('onboarding.idea.catchTitle')}>
          {t('onboarding.idea.catch')}
        </Row>
      </ul>
    </div>
  )
}

export function DeviceStep({ downloadBytes }: { downloadBytes: number }) {
  const size = approxMegabytes(downloadBytes) || DEFAULT_DOWNLOAD_MB
  return (
    <div className="bd-onb-step" data-testid="onboarding-device">
      <div className="bd-onb-readout" aria-hidden="true">
        <Icon name="download" size={30} />
        <span className="bd-onb-readout__value">{size} MB</span>
      </div>
      <p data-testid="onboarding-download">{t('onboarding.device.download', { size })}</p>
      <p>{t('onboarding.device.local')}</p>
      <p>{t('onboarding.device.noTracking')}</p>
    </div>
  )
}

const PERMISSIONS: ReadonlyArray<{ kind: PermissionKind; icon: IconName; title: 'microphone' | 'camera' | 'location' }> = [
  { kind: 'microphone', icon: 'microphone', title: 'microphone' },
  { kind: 'camera', icon: 'camera', title: 'camera' },
  { kind: 'location', icon: 'location', title: 'location' },
]

const WHY = {
  microphone: 'onboarding.permissions.microphoneWhy',
  camera: 'onboarding.permissions.cameraWhy',
  location: 'onboarding.permissions.locationWhy',
} as const

const NAME = {
  microphone: 'onboarding.permissions.microphone',
  camera: 'onboarding.permissions.camera',
  location: 'onboarding.permissions.location',
} as const

function PermissionRow({ kind, icon }: { kind: PermissionKind; icon: IconName }) {
  const [state, setState] = useState<PermissionResult>('unknown')
  const [asking, setAsking] = useState(false)
  const [asked, setAsked] = useState(false)

  // A permission given earlier is shown as given, without asking again.
  useEffect(() => {
    let cancelled = false
    void queryPermission(kind).then((found) => {
      if (!cancelled && found !== 'unknown') setState(found)
    })
    return () => {
      cancelled = true
    }
  }, [kind])

  const ask = async () => {
    setAsking(true)
    const result = await requestPermission(kind)
    setState(result)
    setAsked(true)
    setAsking(false)
  }

  return (
    <li className="bd-onb-perm" data-testid={`permission-${kind}`} data-state={state}>
      <div className="bd-onb-perm__head">
        <span className="bd-onb-row__icon" aria-hidden="true">
          <Icon name={icon} size={26} />
        </span>
        <div className="bd-onb-perm__text">
          <h3 className="bd-onb-row__title">{t(NAME[kind])}</h3>
          <p>{t(WHY[kind])}</p>
        </div>
      </div>
      {state === 'granted' ? (
        <p className="bd-onb-perm__ok" role="status">
          <Icon name="check" size={20} /> {t('onboarding.permissions.granted')}
        </p>
      ) : state === 'denied' ? (
        <p className="bd-onb-perm__note" role="status">
          {t('onboarding.permissions.denied')}
        </p>
      ) : state === 'unavailable' || (state === 'unknown' && asked) ? (
        <p className="bd-onb-perm__note" role="status">
          {kind === 'location' && state === 'unknown' ? t('onboarding.permissions.locationUnknown') : t('onboarding.permissions.unavailable')}
        </p>
      ) : (
        <Button variant="secondary" busy={asking} onClick={() => void ask()} data-testid={`permission-${kind}-allow`}>
          {t('onboarding.permissions.allow')}
        </Button>
      )}
    </li>
  )
}

export function PermissionsStep() {
  return (
    <div className="bd-onb-step" data-testid="onboarding-permissions">
      <p>{t('onboarding.permissions.lead')}</p>
      <ul className="bd-onb-rows">
        {PERMISSIONS.map((item) => (
          <PermissionRow key={item.kind} kind={item.kind} icon={item.icon} />
        ))}
      </ul>
      <p className="bd-onb-later">{t('onboarding.permissions.laterShort')}</p>
    </div>
  )
}

export function InstallStep() {
  const { platform, canPrompt } = useInstallState()
  const [outcome, setOutcome] = useState<InstallOutcome>()

  const install = async () => {
    setOutcome(await promptInstall())
  }

  return (
    <div className="bd-onb-step" data-testid="onboarding-install" data-platform={platform}>
      <p>{t('onboarding.install.lead')}</p>
      {platform === 'installed' ? (
        <Notice tone="success">{t('onboarding.install.installed')}</Notice>
      ) : platform === 'ios' ? (
        <Notice tone="info">
          <p>{t('onboarding.install.ios')}</p>
          <p>{t('onboarding.install.iosSafari')}</p>
        </Notice>
      ) : platform === 'android' ? (
        canPrompt ? (
          <div className="bd-onb-install">
            <p>{t('onboarding.install.androidPrompt')}</p>
            <Button size="lg" icon="download" fullWidth onClick={() => void install()} data-testid="install-button">
              {t('onboarding.install.androidButton')}
            </Button>
          </div>
        ) : (
          <Notice tone="info">{t('onboarding.install.androidMenu')}</Notice>
        )
      ) : canPrompt ? (
        <Button size="lg" icon="download" fullWidth onClick={() => void install()} data-testid="install-button">
          {t('onboarding.install.androidButton')}
        </Button>
      ) : (
        <Notice tone="info">{t('onboarding.install.desktop')}</Notice>
      )}
      {outcome === 'accepted' ? <p role="status">{t('onboarding.install.accepted')}</p> : null}
      {outcome === 'dismissed' ? <p role="status">{t('onboarding.install.dismissed')}</p> : null}
    </div>
  )
}
