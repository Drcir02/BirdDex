import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { Notice } from '../../ui'
import type { ScanDevice } from './errors'

export interface PermissionHelpProps {
  device: ScanDevice
  /** The next steps, usually "Zkusit znovu" and a way back. */
  actions: ReactNode
}

/**
 * The microphone or the camera is blocked. Says it calmly and shows the few taps that switch it on again, for iPhone and
 * for Android (the phone cannot show its question a second time, so the person has to open the settings of the site).
 */
export function PermissionHelp({ device, actions }: PermissionHelpProps) {
  const mic = device === 'microphone'
  return (
    <Notice tone="error" title={t(mic ? 'scan.help.micTitle' : 'scan.help.cameraTitle')} action={actions} className="bd-scan-help">
      <p>{t(mic ? 'common.errors.micDenied' : 'common.errors.cameraDenied')}</p>
      <h3 className="bd-scan-help__heading">{t('scan.help.steps')}</h3>
      <ul className="bd-scan-help__steps">
        <li>{t(mic ? 'scan.help.micIphone' : 'scan.help.cameraIphone')}</li>
        <li>{t(mic ? 'scan.help.micAndroid' : 'scan.help.cameraAndroid')}</li>
        <li>{t('scan.help.homeScreen')}</li>
      </ul>
    </Notice>
  )
}
