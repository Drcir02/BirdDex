import { describe, expect, it } from 'vitest'
import { CHUNK_BYTES, checksum, humanAge, makeChunk } from '../../src/fieldcheck/checks/storage'
import { meterPosition } from '../../src/fieldcheck/checks/microphone'
import { parseDevice } from '../../src/fieldcheck/checks/environment'

describe('storage test data', () => {
  it('makes chunks of the promised size', () => {
    expect(makeChunk(0).byteLength).toBe(CHUNK_BYTES)
  })

  it('makes the same bytes for the same index and different bytes for another index', () => {
    expect(checksum(makeChunk(3))).toBe(checksum(makeChunk(3)))
    expect(checksum(makeChunk(3))).not.toBe(checksum(makeChunk(4)))
  })

  it('notices a damaged chunk', () => {
    const chunk = makeChunk(1)
    const before = checksum(chunk)
    new Uint32Array(chunk)[16] ^= 0xffff
    expect(checksum(chunk)).not.toBe(before)
  })

  it('describes ages in plain words', () => {
    expect(humanAge(10_000)).toBe('less than a minute')
    expect(humanAge(30 * 60_000)).toBe('30 min')
    expect(humanAge(5 * 3_600_000)).toBe('5 h')
    expect(humanAge(72 * 3_600_000)).toBe('3 days')
  })
})

describe('microphone meter', () => {
  it('maps silence to empty and full scale to full', () => {
    expect(meterPosition(0)).toBe(0)
    expect(meterPosition(1)).toBe(1)
    expect(meterPosition(0.001)).toBeCloseTo(0, 5)
    expect(meterPosition(0.1)).toBeCloseTo(2 / 3, 2)
  })
})

describe('parseDevice', () => {
  it('recognises an iPhone and reads the OS and Safari versions', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1'
    expect(parseDevice(ua, 'iPhone', 5)).toEqual({ isIOS: true, isAndroid: false, osVersion: '17.4.1', safariVersion: '17.4.1' })
  })

  it('recognises Android Chrome', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
    const device = parseDevice(ua, 'Linux armv81', 5)
    expect(device.isAndroid).toBe(true)
    expect(device.isIOS).toBe(false)
  })

  it('treats an iPad that pretends to be a Mac as iOS', () => {
    expect(parseDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5).isIOS).toBe(true)
  })
})
