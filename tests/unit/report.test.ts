import { describe, expect, it } from 'vitest'
import { buildReport } from '../../src/fieldcheck/report'
import { CHECK_ORDER, idleState, type CheckId, type CheckState } from '../../src/fieldcheck/types'

const blank = () => Object.fromEntries(CHECK_ORDER.map((id) => [id, idleState()])) as Record<CheckId, CheckState>

describe('buildReport', () => {
  it('lists every check in order with its status and lines', () => {
    const states = blank()
    states.environment = { status: 'pass', lines: ['Device: iOS'] }
    states.camera = { status: 'fail', lines: ['No video frames'] }

    const report = buildReport(states, ['header line'])
    const lines = report.split('\n')

    expect(lines[0]).toBe('header line')
    expect(report).toContain('[PASS] Device and browser\n  - Device: iOS')
    expect(report).toContain('[FAIL] Camera\n  - No video frames')
    expect(report).toContain('[NOT RUN] Model speed')
    expect(report.indexOf('Device and browser')).toBeLessThan(report.indexOf('Camera'))
    expect(report.endsWith('\n')).toBe(true)
  })
})
