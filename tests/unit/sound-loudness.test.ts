import { describe, expect, it } from 'vitest'
import { LevelMeter, measureBlock, meterPosition, METER_FLOOR_DB, toDb } from '../../src/ml/audio/loudness'

describe('toDb', () => {
  it('is 0 dBFS at full scale and 6 dB lower for half the amplitude', () => {
    expect(toDb(1)).toBeCloseTo(0, 10)
    expect(toDb(0.5)).toBeCloseTo(-6.0206, 3)
    expect(toDb(0.1)).toBeCloseTo(-20, 10)
  })
  it('does not go to minus infinity for silence', () => {
    expect(toDb(0)).toBe(-120)
    expect(toDb(1e-9)).toBe(-120)
  })
})

describe('measureBlock', () => {
  it('finds RMS and peak', () => {
    const { rms, peak } = measureBlock(Float32Array.of(0.5, -0.5, 0.5, -0.5))
    expect(rms).toBeCloseTo(0.5, 6)
    expect(peak).toBe(0.5)
  })
  it('knows the RMS of a sine is its peak over the square root of two', () => {
    const sine = Float32Array.from({ length: 4800 }, (_, i) => 0.8 * Math.sin((2 * Math.PI * 100 * i) / 4800))
    const { rms, peak } = measureBlock(sine)
    expect(rms).toBeCloseTo(0.8 / Math.SQRT2, 3)
    expect(peak).toBeCloseTo(0.8, 3)
  })
  it('gives zero for nothing', () => {
    expect(measureBlock(new Float32Array(0))).toEqual({ rms: 0, peak: 0 })
    expect(measureBlock(new Float32Array(10))).toEqual({ rms: 0, peak: 0 })
  })
})

describe('meterPosition', () => {
  it('is empty at -60 dBFS and full at 0 dBFS', () => {
    expect(METER_FLOOR_DB).toBe(-60)
    expect(meterPosition(0)).toBe(0)
    expect(meterPosition(0.001)).toBeCloseTo(0, 10) // exactly -60 dBFS
    expect(meterPosition(1)).toBeCloseTo(1, 10)
  })
  it('rises with the loudness, 10 dB being a sixth of the scale', () => {
    expect(meterPosition(0.1)).toBeCloseTo(40 / 60, 10) // -20 dBFS
    expect(meterPosition(0.01)).toBeCloseTo(20 / 60, 10) // -40 dBFS
    expect(meterPosition(0.3)).toBeGreaterThan(meterPosition(0.1))
  })
  it('stays between 0 and 1', () => {
    expect(meterPosition(5)).toBe(1)
    expect(meterPosition(-1)).toBe(0)
  })
})

describe('LevelMeter', () => {
  it('rises at once', () => {
    const meter = new LevelMeter()
    expect(meter.update(0.1, 0.043)).toBeCloseTo(meterPosition(0.1), 10)
  })
  it('falls gently, not at once', () => {
    const meter = new LevelMeter(0.25)
    meter.update(0.5, 0.043)
    const loud = meter.value
    const after = meter.update(0.0001, 0.043)
    expect(after).toBeLessThan(loud)
    expect(after).toBeGreaterThan(loud * 0.7) // one 43 ms block: it has barely started to fall
  })
  it('reaches the floor if the sound stays away', () => {
    const meter = new LevelMeter(0.25)
    meter.update(0.5, 0.043)
    for (let i = 0; i < 100; i++) meter.update(0, 0.043)
    expect(meter.value).toBeLessThan(0.01)
  })
  it('falls the same amount per second whatever the block length', () => {
    const slow = new LevelMeter()
    const fast = new LevelMeter()
    slow.update(0.5, 0.1)
    fast.update(0.5, 0.1)
    slow.update(0, 0.4)
    for (let i = 0; i < 4; i++) fast.update(0, 0.1)
    expect(slow.value).toBeCloseTo(fast.value, 6)
  })
  it('can be reset', () => {
    const meter = new LevelMeter()
    meter.update(0.5, 0.043)
    meter.reset()
    expect(meter.value).toBe(0)
  })
})
