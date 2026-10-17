import type { Status } from '../types'

export interface MicRun {
  status: Status
  samples?: Float32Array
  sampleRate?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const toDb = (value: number) => (value > 0 ? 20 * Math.log10(value) : -120)

/** Convert a 0..1 amplitude to a 0..1 meter position (-60 dBFS is empty, 0 dBFS is full). */
export function meterPosition(amplitude: number): number {
  return Math.min(1, Math.max(0, (toDb(amplitude) + 60) / 60))
}

/**
 * Opens the microphone the way BirdNET will need it (no echo cancelling, no noise suppression, no auto gain),
 * records for a few seconds, and reports what the phone really delivered.
 * Must be called straight from a tap: iOS only lets audio start inside a user gesture.
 */
export async function runMicrophoneCheck(
  seconds: number,
  onLevel: (rms: number, peak: number) => void,
  log: (line: string) => void,
): Promise<MicRun> {
  let stream: MediaStream | undefined
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let node: AudioWorkletNode | undefined
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      log('getUserMedia is not available in this browser.')
      return { status: 'fail' }
    }

    // Create the audio context before any await, while the tap still counts as a user gesture.
    try {
      context = new AudioContext({ sampleRate: 48000 })
    } catch {
      context = new AudioContext()
    }
    void context.resume()

    const opened = performance.now()
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    })
    log(`Microphone opened in ${Math.round(performance.now() - opened)} ms`)
    const settings = stream.getAudioTracks()[0].getSettings()
    log(
      `Track: ${settings.sampleRate ?? '?'} Hz, ${settings.channelCount ?? '?'} channel(s), ` +
        `echoCancellation=${settings.echoCancellation}, noiseSuppression=${settings.noiseSuppression}, autoGainControl=${settings.autoGainControl}`,
    )
    log(
      `Audio engine runs at ${context.sampleRate} Hz` +
        (context.sampleRate === 48000 ? ' (what BirdNET needs)' : ' (BirdNET needs 48000 Hz, so the app will resample)'),
    )
    if (context.state !== 'running') await context.resume()

    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}worklets/capture-processor.js`)
    log('AudioWorklet loaded')

    const chunks: Float32Array[] = []
    let total = 0
    source = context.createMediaStreamSource(stream)
    node = new AudioWorkletNode(context, 'capture-processor')
    node.port.onmessage = (event: MessageEvent<{ samples: Float32Array; rms: number; peak: number }>) => {
      chunks.push(event.data.samples)
      total += event.data.samples.length
      onLevel(event.data.rms, event.data.peak)
    }
    // Route through a silent gain node so every browser keeps pulling audio through the worklet.
    const silent = context.createGain()
    silent.gain.value = 0
    source.connect(node)
    node.connect(silent)
    silent.connect(context.destination)

    const started = performance.now()
    await sleep(seconds * 1000)
    const elapsed = (performance.now() - started) / 1000

    const samples = new Float32Array(total)
    let offset = 0
    for (const chunk of chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    if (total === 0) {
      log('No audio arrived from the microphone.')
      return { status: 'fail' }
    }

    let peak = 0
    let sumSquares = 0
    let clipped = 0
    for (const value of samples) {
      const a = Math.abs(value)
      if (a > peak) peak = a
      if (a >= 0.999) clipped++
      sumSquares += value * value
    }
    const rms = Math.sqrt(sumSquares / samples.length)
    const captured = total / context.sampleRate
    log(`Captured ${captured.toFixed(2)} s of audio in ${elapsed.toFixed(2)} s (ratio ${(captured / elapsed).toFixed(2)}, about 1.00 is healthy)`)
    log(`Loudness: peak ${toDb(peak).toFixed(1)} dBFS, average ${toDb(rms).toFixed(1)} dBFS, clipped samples ${clipped}`)

    let status: Status = 'pass'
    if (captured / elapsed < 0.9) {
      log('Audio has gaps (less audio arrived than time passed).')
      status = 'warn'
    }
    if (peak < 0.003) {
      log('The recording is silent. Was the microphone blocked, or was it quiet in the room? Try again and make some noise.')
      status = 'warn'
    }
    return { status, samples, sampleRate: context.sampleRate }
  } catch (error) {
    log(`Failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
    return { status: 'fail' }
  } finally {
    node?.disconnect()
    source?.disconnect()
    stream?.getTracks().forEach((track) => track.stop())
    await context?.close().catch(() => undefined)
  }
}

export async function playSamples(samples: Float32Array, sampleRate: number): Promise<void> {
  const context = new AudioContext()
  await context.resume()
  const buffer = context.createBuffer(1, samples.length, sampleRate)
  buffer.getChannelData(0).set(samples)
  const player = context.createBufferSource()
  player.buffer = buffer
  player.connect(context.destination)
  await new Promise<void>((resolve) => {
    player.onended = () => resolve()
    player.start()
  })
  await context.close()
}
