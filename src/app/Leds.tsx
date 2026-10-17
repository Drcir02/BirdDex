import { t } from '../i18n'
import { useDeviceStatus } from './deviceStatus'

/**
 * The three small lights: red, yellow, green. Which one is lit comes from the device status through CSS
 * (idle: green, listening: red pulse, busy: yellow blink, success: green flashes, error: red).
 * The status is also written out for screen readers.
 */
export function Leds() {
  const { status } = useDeviceStatus()
  return (
    <div className="bd-leds" role="status" data-testid="leds">
      <span className="bd-sr-only">{`${t('common.device.label')}: ${t(`common.device.${status}` as const)}`}</span>
      <span className="bd-led bd-led--red" aria-hidden="true" />
      <span className="bd-led bd-led--yellow" aria-hidden="true" />
      <span className="bd-led bd-led--green" aria-hidden="true" />
    </div>
  )
}
