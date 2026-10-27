import { formatDate, t } from '../../i18n'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How long ago a moment was, in Czech: "právě teď", "před 5 min.", "před 2 hod.", "včera", "před 3 dny", then the date. */
export function agoText(ms: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ms)
  if (diff < MINUTE) return t('group.ago.now')
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE)
    return minutes === 1 ? t('group.ago.minute') : t('group.ago.minutes', { count: minutes })
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR)
    return hours === 1 ? t('group.ago.hour') : t('group.ago.hours', { count: hours })
  }
  const days = Math.floor(diff / DAY)
  if (days === 1) return t('group.ago.yesterday')
  if (days < 7) return t('group.ago.days', { count: days })
  return formatDate(ms)
}
