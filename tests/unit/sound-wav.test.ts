import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeWav, encodeWav, encodeWavBlob, floatToInt16, WAV_HEADER_BYTES } from '../../src/ml/audio/wav'

const ascii = (bytes: Uint8Array, at: number, length = 4) => String.fromCharCode(...bytes.subarray(at, at + length))

describe('floatToInt16', () => {
  it('maps -1..1 to the 16-bit range', () => {
    expect(floatToInt16(0)).toBe(0)
    expect(floatToInt16(1)).toBe(32767)
    expect(floatToInt16(-1)).toBe(-32768)
    expect(floatToInt16(0.5)).toBe(16384) // 0.5 * 32767 = 16383.5, rounded
    expect(floatToInt16(-0.5)).toBe(-16384)
  })
  it('clips louder samples instead of wrapping around', () => {
    expect(floatToInt16(1.5)).toBe(32767)
    expect(floatToInt16(-7)).toBe(-32768)
    expect(floatToInt16(Number.POSITIVE_INFINITY)).toBe(32767)
    expect(floatToInt16(Number.NEGATIVE_INFINITY)).toBe(-32768)
  })
  it('turns NaN into silence', () => {
    expect(floatToInt16(Number.NaN)).toBe(0)
  })
})

describe('encodeWav', () => {
  it('writes a canonical 44-byte header for mono 16-bit PCM', () => {
    const wav = encodeWav(Float32Array.of(0, 0.5, -0.5, 1), 48000)
    const view = new DataView(wav.buffer)
    expect(wav.length).toBe(WAV_HEADER_BYTES + 4 * 2)
    expect(ascii(wav, 0)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(wav.length - 8)
    expect(ascii(wav, 8)).toBe('WAVE')
    expect(ascii(wav, 12)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint32(28, true)).toBe(96000) // bytes per second
    expect(view.getUint16(32, true)).toBe(2) // bytes per frame
    expect(view.getUint16(34, true)).toBe(16)
    expect(ascii(wav, 36)).toBe('data')
    expect(view.getUint32(40, true)).toBe(8)
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true), view.getInt16(50, true)]).toEqual([0, 16384, -16384, 32767])
  })

  it('handles an empty recording', () => {
    const wav = encodeWav(new Float32Array(0), 48000)
    expect(wav.length).toBe(44)
    expect(decodeWav(wav).samples.length).toBe(0)
  })

  it('rejects a nonsense sample rate', () => {
    expect(() => encodeWav(new Float32Array(1), 0)).toThrow(RangeError)
    expect(() => encodeWav(new Float32Array(1), 44100.5)).toThrow(RangeError)
  })

  it('makes a Blob with the audio/wav type', async () => {
    const blob = encodeWavBlob(new Float32Array(480), 48000)
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(44 + 960)
  })
})

describe('decodeWav', () => {
  it('reads back what encodeWav wrote, to 16-bit precision', () => {
    const original = Float32Array.from({ length: 4800 }, (_, i) => 0.8 * Math.sin((2 * Math.PI * 440 * i) / 48000))
    const decoded = decodeWav(encodeWav(original, 48000))
    expect(decoded.sampleRate).toBe(48000)
    expect(decoded.channels).toBe(1)
    expect(decoded.seconds).toBeCloseTo(0.1, 6)
    for (let i = 0; i < original.length; i++) expect(Math.abs(decoded.samples[i] - original[i])).toBeLessThan(2 / 32768) // within two steps of the 16-bit scale
  })

  it('reads the BirdNET test recordings (3 s and 24 s, 48 kHz, mono)', () => {
    const demo = decodeWav(new Uint8Array(readFileSync('tests/fixtures/audio/birdnet-demo-sample.wav')))
    expect(demo.sampleRate).toBe(48000)
    expect(demo.channels).toBe(1)
    expect(demo.samples.length).toBe(144000)
    const soundscape = decodeWav(new Uint8Array(readFileSync('tests/fixtures/audio/soundscape-24s.wav')))
    expect(soundscape.samples.length).toBe(24 * 48000)
    expect(soundscape.seconds).toBe(24)
  })

  it('skips chunks it does not need (LIST) and respects odd sizes', () => {
    const plain = encodeWav(Float32Array.of(0.25, -0.25), 44100)
    // Insert a LIST chunk with an odd size (3 bytes + 1 byte of padding) between fmt and data.
    const extra = Uint8Array.from([0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0])
    const joined = new Uint8Array(plain.length + extra.length)
    joined.set(plain.subarray(0, 36))
    joined.set(extra, 36)
    joined.set(plain.subarray(36), 36 + extra.length)
    const decoded = decodeWav(joined)
    expect(decoded.sampleRate).toBe(44100)
    expect(decoded.samples.length).toBe(2)
    expect(decoded.samples[0]).toBeCloseTo(0.25, 3)
  })

  it('reads 32-bit float files', () => {
    const buffer = new ArrayBuffer(44 + 8)
    const view = new DataView(buffer)
    const put = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
    put(0, 'RIFF')
    view.setUint32(4, 36 + 8, true)
    put(8, 'WAVE')
    put(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 3, true) // IEEE float
    view.setUint16(22, 1, true)
    view.setUint32(24, 16000, true)
    view.setUint32(28, 64000, true)
    view.setUint16(32, 4, true)
    view.setUint16(34, 32, true)
    put(36, 'data')
    view.setUint32(40, 8, true)
    view.setFloat32(44, 0.5, true)
    view.setFloat32(48, -0.75, true)
    const decoded = decodeWav(new Uint8Array(buffer))
    expect(Array.from(decoded.samples)).toEqual([0.5, -0.75])
    expect(decoded.sampleRate).toBe(16000)
  })

  it('takes the first channel of a stereo file', () => {
    const buffer = new ArrayBuffer(44 + 8)
    const view = new DataView(buffer)
    const put = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
    put(0, 'RIFF')
    view.setUint32(4, 44, true)
    put(8, 'WAVE')
    put(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 2, true)
    view.setUint32(24, 48000, true)
    view.setUint32(28, 192000, true)
    view.setUint16(32, 4, true)
    view.setUint16(34, 16, true)
    put(36, 'data')
    view.setUint32(40, 8, true)
    ;[1000, -1000, 2000, -2000].forEach((v, i) => view.setInt16(44 + i * 2, v, true))
    const decoded = decodeWav(new Uint8Array(buffer))
    expect(decoded.channels).toBe(2)
    expect(decoded.samples.length).toBe(2)
    expect(decoded.samples[0]).toBeCloseTo(1000 / 32768, 6)
    expect(decoded.samples[1]).toBeCloseTo(2000 / 32768, 6)
  })

  it('says what is wrong with files it cannot read', () => {
    expect(() => decodeWav(new Uint8Array(0))).toThrow('Not a WAV file')
    expect(() => decodeWav(new TextEncoder().encode('RIFFxxxxAVI LIST'))).toThrow('Not a WAV file')
    const truncated = encodeWav(Float32Array.of(0.1, 0.2), 48000).subarray(0, 40)
    expect(() => decodeWav(truncated)).toThrow('no audio data')
    const wav = encodeWav(Float32Array.of(0.1), 48000)
    new DataView(wav.buffer).setUint16(34, 24, true) // pretend it has 24-bit samples
    expect(() => decodeWav(wav)).toThrow('Unsupported WAV format')
  })

  it('reads to the end of a file whose data size was never filled in', () => {
    const wav = encodeWav(Float32Array.of(0.1, 0.2, 0.3), 48000)
    new DataView(wav.buffer).setUint32(40, 0xffffffff, true)
    expect(decodeWav(wav).samples.length).toBe(3)
  })
})
