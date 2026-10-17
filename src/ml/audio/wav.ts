// 16-bit PCM WAV files: the encoder for the clips we save with a catch, and a small decoder for tests and the dev page.
//
// A WAV file is a 44-byte header followed by the samples. Mono, 16 bits, little endian: the same format the BirdNET
// test recordings use, and one that every phone can play.

export const WAV_HEADER_BYTES = 44

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/** Float sample in -1..1 to a 16-bit integer. Louder samples are clipped instead of wrapping around. */
export function floatToInt16(sample: number): number {
  if (!(sample > -1)) return sample === sample ? -32768 : 0 // -1 and below; NaN becomes silence
  if (sample >= 1) return 32767
  return sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767)
}

/** The bytes of a mono 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError(`Bad sample rate: ${sampleRate}`)
  const dataBytes = samples.length * 2
  if (dataBytes > 0xffffffff - 36) throw new RangeError('The recording is too long for a WAV file')
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // size of the fmt chunk
  view.setUint16(20, 1, true) // 1 = PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per frame
  view.setUint16(34, 16, true) // bits per sample
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(WAV_HEADER_BYTES + i * 2, floatToInt16(samples[i]), true)
  return new Uint8Array(buffer)
}

/** A mono 16-bit PCM WAV file as a Blob, ready to be saved with a catch. */
export function encodeWavBlob(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' })
}

export interface DecodedWav {
  sampleRate: number
  channels: number
  /** The first channel, as floats between -1 and 1. */
  samples: Float32Array
  seconds: number
}

/**
 * Reads a WAV file with 16-bit integer or 32-bit float samples (the kinds we produce and the test recordings use).
 * Extra chunks such as LIST are skipped. Throws an Error with a plain message for anything else.
 */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file')

  let format: { code: number; channels: number; sampleRate: number; bits: number } | undefined
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      format = {
        code: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      if (!format) throw new Error('WAV file has data before its format')
      const { code, channels, sampleRate, bits } = format
      const bytesPerSample = bits / 8
      const frameBytes = bytesPerSample * channels
      // Streams written without a final size use 0 or 0xffffffff; read to the end of the file then.
      const available = Math.min(size, bytes.length - body)
      const frames = Math.floor(available / frameBytes)
      const samples = new Float32Array(frames)
      if (code === 1 && bits === 16) {
        for (let i = 0; i < frames; i++) samples[i] = view.getInt16(body + i * frameBytes, true) / 32768
      } else if (code === 3 && bits === 32) {
        for (let i = 0; i < frames; i++) samples[i] = view.getFloat32(body + i * frameBytes, true)
      } else {
        throw new Error(`Unsupported WAV format (code ${code}, ${bits} bits)`)
      }
      return { sampleRate, channels, samples, seconds: frames / sampleRate }
    }
    offset = body + size + (size % 2) // chunks are padded to an even size
  }
  throw new Error('WAV file has no audio data')
}
