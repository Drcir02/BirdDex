// Small formatting helpers of the settings screen. Pure.

import { formatNumber } from '../../i18n'

const KB = 1000
const MB = 1000 * 1000
const GB = 1000 * 1000 * 1000

/** "512 kB", "25,9 MB", "1,2 GB": file sizes as the phone quotes them (1 MB = 1 000 000 bytes), with a decimal comma. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 kB'
  const rounded = (value: number) => formatNumber(Math.round(value * 10) / 10)
  if (bytes >= GB) return `${rounded(bytes / GB)} GB`
  if (bytes >= MB) return `${bytes >= 100 * MB ? Math.round(bytes / MB) : rounded(bytes / MB)} MB`
  return `${Math.max(1, Math.round(bytes / KB))} kB`
}

/** The build time from vite's define (an ISO string) as a Czech date and time, or undefined when it cannot be read. */
export function formatBuildTime(iso: string, format: (value: Date) => string): string | undefined {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : format(date)
}
