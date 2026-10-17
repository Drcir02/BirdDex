// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureFailureOf, CAPTURE_CONSTRAINTS, SoundCaptureError, startCapture, type CaptureHandlers } from '../../src/ml/audio/capture'

// The browser's audio classes are replaced by small fakes, so the order of the calls can be checked: on iOS the audio
// context and the microphone request must happen inside the tap, before anything is awaited.

type Listener = (event?: unknown) => void

class FakeTrack {
  stopped = false
  private listeners = new Map<string, Listener[]>()
  settings: Record<string, unknown> = { sampleRate: 48000, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  stop = vi.fn(() => {
    this.stopped = true
  })
  getSettings = () => this.settings
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener))
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
}

class FakeStream {
  readonly track = new FakeTrack()
  getAudioTracks = () => [this.track]
  getTracks = () => [this.track]
}

class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
  gain = { value: 1 }
  port: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null }
  onaudioprocess: ((event: unknown) => void) | null = null
}

class FakeContext {
  static instances: FakeContext[] = []
  static refuseFixedRate = false
  static defaultRate = 44100
  state: string = 'running'
  sampleRate: number
  destination = {}
  audioWorklet: { addModule: ReturnType<typeof vi.fn> } | undefined = { addModule: vi.fn(async () => undefined) }
  source = new FakeNode()
  mute = new FakeNode()
  processor = new FakeNode()
  private listeners = new Map<string, Listener[]>()
  constructor(options?: { sampleRate?: number }) {
    if (options?.sampleRate && FakeContext.refuseFixedRate) throw new DOMException('rate not supported', 'NotSupportedError')
    this.sampleRate = options?.sampleRate ?? FakeContext.defaultRate
    FakeContext.instances.push(this)
  }
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  createMediaStreamSource = vi.fn(() => this.source)
  createGain = vi.fn(() => this.mute)
  createScriptProcessor = vi.fn(() => this.processor)
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((l) => l !== listener))
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }
}

class FakeWorkletNode extends FakeNode {
  static instances: FakeWorkletNode[] = []
  constructor(
    readonly context: FakeContext,
    readonly name: string,
    readonly options: unknown,
  ) {
    super()
    FakeWorkletNode.instances.push(this)
  }
}

const getUserMedia = vi.fn()
let stream: FakeStream
const handlers = (): CaptureHandlers & { blocks: Array<[Float32Array, number, number, number]>; ended: string[] } => {
  const blocks: Array<[Float32Array, number, number, number]> = []
  const ended: string[] = []
  return { blocks, ended, onBlock: (...args) => blocks.push(args), onEnded: (reason) => ended.push(reason) }
}

beforeEach(() => {
  FakeContext.instances = []
  FakeContext.refuseFixedRate = false
  FakeContext.defaultRate = 44100
  FakeWorkletNode.instances = []
  stream = new FakeStream()
  getUserMedia.mockReset()
  getUserMedia.mockImplementation(async () => stream)
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('startCapture: inside the tap', () => {
  it('creates the audio context and asks for the microphone before it awaits anything', () => {
    const promise = startCapture(handlers())
    // Still synchronous: nothing has been awaited yet.
    expect(FakeContext.instances).toHaveLength(1)
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(FakeContext.instances[0].resume).toHaveBeenCalled()
    void promise.catch(() => undefined)
  })

  it('switches off echo cancelling, noise suppression and automatic gain, and asks for one channel', () => {
    void startCapture(handlers()).catch(() => undefined)
    expect(getUserMedia).toHaveBeenCalledWith(CAPTURE_CONSTRAINTS)
    expect(CAPTURE_CONSTRAINTS).toEqual({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })
  })

  it('asks the audio context for 48 kHz, the rate BirdNET needs', async () => {
    const session = await startCapture(handlers())
    expect(FakeContext.instances[0].sampleRate).toBe(48000)
    expect(session.sampleRate).toBe(48000)
    expect(session.atTargetRate).toBe(true)
    await session.stop()
  })

  it('carries on with the default rate when the browser refuses a fixed one, and says so', async () => {
    FakeContext.refuseFixedRate = true
    const session = await startCapture(handlers())
    expect(session.sampleRate).toBe(44100)
    expect(session.atTargetRate).toBe(false)
    await session.stop()
  })
})

describe('startCapture: samples', () => {
  it('delivers the blocks of the worklet with their loudness and the sample rate', async () => {
    const h = handlers()
    const session = await startCapture(h)
    expect(session.method).toBe('worklet')
    expect(FakeContext.instances[0].audioWorklet!.addModule).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}worklets/capture-processor.js`)
    expect(FakeWorkletNode.instances).toHaveLength(1)
    expect(FakeWorkletNode.instances[0].name).toBe('capture-processor')
    const node = FakeWorkletNode.instances[0]
    expect(node.options).toMatchObject({ channelCount: 1, channelCountMode: 'explicit' })
    const block = Float32Array.of(0.1, -0.2, 0.3)
    node.port.onmessage!({ data: { samples: block, rms: 0.2, peak: 0.3 } })
    expect(h.blocks).toEqual([[block, 0.2, 0.3, 48000]])
    expect(FakeContext.instances[0].source.connect).toHaveBeenCalledWith(node)
    await session.stop()
  })

  it('uses a ScriptProcessorNode when the browser has no audio worklets', async () => {
    const h = handlers()
    // Make the next context a worklet-less one.
    vi.stubGlobal('AudioContext', class extends FakeContext {
      constructor(options?: { sampleRate?: number }) {
        super(options)
        this.audioWorklet = undefined
      }
    })
    const session = await startCapture(h)
    expect(session.method).toBe('script-processor')
    const context = FakeContext.instances[0]
    const buffer = Float32Array.of(0.5, -0.5, 0.5, -0.5)
    context.processor.onaudioprocess!({ inputBuffer: { getChannelData: () => buffer } })
    expect(h.blocks).toHaveLength(1)
    expect(h.blocks[0][1]).toBeCloseTo(0.5, 6) // rms
    expect(h.blocks[0][2]).toBeCloseTo(0.5, 6) // peak
    expect(h.blocks[0][0]).not.toBe(buffer) // a copy: the browser reuses its buffer
    await session.stop()
  })

  it('also falls back when the worklet file cannot be loaded', async () => {
    vi.stubGlobal('AudioContext', class extends FakeContext {
      constructor(options?: { sampleRate?: number }) {
        super(options)
        this.audioWorklet = { addModule: vi.fn(async () => Promise.reject(new Error('404'))) }
      }
    })
    const session = await startCapture(handlers())
    expect(session.method).toBe('script-processor')
    await session.stop()
  })

  it('reports what the browser really gave', async () => {
    stream.track.settings = { sampleRate: 44100, channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false }
    const session = await startCapture(handlers())
    expect(session.settings).toMatchObject({ sampleRate: 44100, echoCancellation: true, noiseSuppression: false })
    await session.stop()
  })
})

describe('startCapture: failures', () => {
  const rejectWith = (name: string) => getUserMedia.mockImplementation(async () => Promise.reject(new DOMException('no', name)))

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-device'],
    ['OverconstrainedError', 'no-device'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['SomethingNew', 'failed'],
  ])('turns %s into "%s" and closes the audio context again', async (name, reason) => {
    rejectWith(name)
    const error = await startCapture(handlers()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SoundCaptureError)
    expect((error as SoundCaptureError).reason).toBe(reason)
    expect(FakeContext.instances[0].close).toHaveBeenCalledTimes(1)
  })

  it('says "unsupported" when the browser has no microphone API', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    const error = await startCapture(handlers()).catch((e: unknown) => e)
    expect((error as SoundCaptureError).reason).toBe('unsupported')
    expect(FakeContext.instances).toHaveLength(0) // nothing was started
  })

  it('says "insecure" on a page that is not https, where the browser hides the microphone', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
    vi.stubGlobal('isSecureContext', false)
    const error = await startCapture(handlers()).catch((e: unknown) => e)
    expect((error as SoundCaptureError).reason).toBe('insecure')
  })

  it('says "unsupported" when there is no Web Audio', async () => {
    vi.stubGlobal('AudioContext', undefined)
    const error = await startCapture(handlers()).catch((e: unknown) => e)
    expect((error as SoundCaptureError).reason).toBe('unsupported')
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('stops the microphone when it is opened but something fails afterwards', async () => {
    vi.stubGlobal('AudioContext', class extends FakeContext {
      constructor(options?: { sampleRate?: number }) {
        super(options)
        this.audioWorklet = undefined
        this.createScriptProcessor = vi.fn(() => {
          throw new Error('no processor either')
        })
      }
    })
    const error = await startCapture(handlers()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SoundCaptureError)
    expect(stream.track.stop).toHaveBeenCalled()
    expect(FakeContext.instances[0].close).toHaveBeenCalled()
  })

  it('has no track and fails clearly when the stream is empty', async () => {
    getUserMedia.mockImplementation(async () => ({ getAudioTracks: () => [], getTracks: () => [] }))
    const error = await startCapture(handlers()).catch((e: unknown) => e)
    expect((error as SoundCaptureError).reason).toBe('no-device')
  })
})

describe('startCapture: ending', () => {
  it('stop() releases the microphone, disconnects the graph and closes the context, once', async () => {
    const session = await startCapture(handlers())
    const context = FakeContext.instances[0]
    const first = session.stop()
    const second = session.stop()
    expect(second).toBe(first)
    await first
    expect(stream.track.stop).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(context.source.disconnect).toHaveBeenCalled()
    expect(FakeWorkletNode.instances[0].disconnect).toHaveBeenCalled()
  })

  it('hands over no more blocks after stop()', async () => {
    const h = handlers()
    const session = await startCapture(h)
    const node = FakeWorkletNode.instances[0]
    await session.stop()
    expect(node.port.onmessage).toBeNull()
  })

  it('tells when the microphone stops by itself (a call, unplugged, permission withdrawn)', async () => {
    const h = handlers()
    const session = await startCapture(h)
    stream.track.emit('ended')
    expect(h.ended).toEqual(['interrupted'])
    await session.stop()
    stream.track.emit('ended')
    expect(h.ended).toEqual(['interrupted']) // not again once we have stopped ourselves
  })

  it('brings a suspended audio context back when the page comes back or the context changes state', async () => {
    const session = await startCapture(handlers())
    const context = FakeContext.instances[0]
    context.resume.mockClear()
    context.state = 'suspended'
    context.emit('statechange')
    expect(context.resume).toHaveBeenCalledTimes(1)
    context.state = 'suspended' // the fake resume() set it running; suspend it again (the phone went to sleep again)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(context.resume).toHaveBeenCalledTimes(2)
    context.state = 'running'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(context.resume).toHaveBeenCalledTimes(2) // running: nothing to do
    await session.stop()
    context.state = 'suspended'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(context.resume).toHaveBeenCalledTimes(2) // and nothing after stop()
  })
})

describe('captureFailureOf', () => {
  it('reads the name of the error', () => {
    expect(captureFailureOf(new DOMException('x', 'NotAllowedError'))).toBe('denied')
    expect(captureFailureOf({ name: 'NotFoundError' })).toBe('no-device')
    expect(captureFailureOf(new Error('plain'))).toBe('failed')
    expect(captureFailureOf(undefined)).toBe('failed')
    expect(captureFailureOf('text')).toBe('failed')
  })
})
