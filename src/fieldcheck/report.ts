import { CHECK_ORDER, CHECK_TITLES, type CheckId, type CheckState, type Status } from './types'

const LABEL: Record<Status, string> = {
  idle: 'NOT RUN',
  running: 'RUNNING',
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
}

/** Plain-text report that the user can paste into the chat. */
export function buildReport(states: Record<CheckId, CheckState>, header: string[]): string {
  const out: string[] = [...header, '']
  for (const id of CHECK_ORDER) {
    const state = states[id]
    out.push(`[${LABEL[state.status]}] ${CHECK_TITLES[id]}`)
    for (const line of state.lines) out.push(`  - ${line}`)
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}
