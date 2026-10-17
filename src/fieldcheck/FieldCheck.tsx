import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { captureFrame, describeImageFile, startCamera, stopCamera, type CapturedImage } from './checks/camera'
import { isStandalone, runEnvironmentCheck } from './checks/environment'
import { runLocationCheck } from './checks/location'
import { meterPosition, playSamples, runMicrophoneCheck } from './checks/microphone'
import { cpuBaselineMs, loadBenchmarks, runModelBenchmarks } from './checks/models'
import { runOfflineCheck } from './checks/offline'
import { inspectStorage, requestPersistence, runStorageWrite, verifyStorage } from './checks/storage'
import { buildReport } from './report'
import { CHECK_ORDER, CHECK_TITLES, idleState, type CheckId, type CheckState, type Status } from './types'

type States = Record<CheckId, CheckState>

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
}

const MB = 1024 * 1024
const CHIP_TEXT: Record<Status, string> = { idle: 'not run', running: 'running', pass: 'pass', warn: 'check', fail: 'fail' }

const initialStates = (): States => Object.fromEntries(CHECK_ORDER.map((id) => [id, idleState()])) as States

function Card({ id, state, hint, children }: { id: CheckId; state: CheckState; hint?: string; children?: ReactNode }) {
  return (
    <section className={`card ${state.status}`} data-testid={`card-${id}`}>
      <header>
        <h2>{CHECK_TITLES[id]}</h2>
        <span className={`chip ${state.status}`} data-testid={`status-${id}`}>
          {CHIP_TEXT[state.status]}
        </span>
      </header>
      {hint && <p className="hint">{hint}</p>}
      {children}
      {state.lines.length > 0 && (
        <ul className="lines">
          {state.lines.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function FieldCheck() {
  const [states, setStates] = useState<States>(initialStates)
  const [busy, setBusy] = useState<CheckId | null>(null)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [copied, setCopied] = useState('')
  const autoStarted = useRef(false)

  const log = useCallback(
    (id: CheckId) => (line: string) =>
      setStates((prev) => ({ ...prev, [id]: { ...prev[id], lines: [...prev[id].lines, line] } })),
    [],
  )
  const begin = useCallback((id: CheckId) => setStates((prev) => ({ ...prev, [id]: { status: 'running', lines: [] } })), [])
  const finish = useCallback((id: CheckId, status: Status) => setStates((prev) => ({ ...prev, [id]: { ...prev[id], status } })), [])
  const replace = useCallback((id: CheckId, state: CheckState) => setStates((prev) => ({ ...prev, [id]: state })), [])

  // Checks that need no permission run by themselves when the page opens.
  const runEnvironment = useCallback(async () => {
    begin('environment')
    replace('environment', await runEnvironmentCheck())
  }, [begin, replace])
  const refreshStorage = useCallback(async () => replace('storage', await inspectStorage()), [replace])
  const runOffline = useCallback(async () => {
    begin('offline')
    finish('offline', await runOfflineCheck(log('offline')))
  }, [begin, finish, log])

  useEffect(() => {
    if (autoStarted.current) return
    autoStarted.current = true
    void runEnvironment()
    void refreshStorage()
    void runOffline()
  }, [runEnvironment, refreshStorage, runOffline])

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  // --- Microphone ---
  const [level, setLevel] = useState(0)
  const recording = useRef<{ samples: Float32Array; sampleRate: number } | null>(null)
  const [canPlay, setCanPlay] = useState(false)

  const onMicrophone = async () => {
    begin('microphone')
    setBusy('microphone')
    setCanPlay(false)
    const run = await runMicrophoneCheck(5, (rms) => setLevel(meterPosition(rms)), log('microphone'))
    setLevel(0)
    recording.current = run.samples && run.sampleRate ? { samples: run.samples, sampleRate: run.sampleRate } : null
    setCanPlay(recording.current !== null)
    finish('microphone', run.status)
    setBusy(null)
  }
  const onPlayback = async () => {
    if (!recording.current) return
    setBusy('microphone')
    try {
      await playSamples(recording.current.samples, recording.current.sampleRate)
    } catch (error) {
      log('microphone')(`Playback failed: ${String(error)}`)
    }
    setBusy(null)
  }

  // --- Camera ---
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | undefined>(undefined)
  const [cameraOn, setCameraOn] = useState(false)
  const [photo, setPhoto] = useState<CapturedImage | null>(null)
  const showPhoto = (image: CapturedImage) =>
    setPhoto((old) => {
      if (old) URL.revokeObjectURL(old.url)
      return image
    })

  const onStartCamera = async () => {
    const video = videoRef.current
    if (!video) return
    begin('camera')
    setBusy('camera')
    const run = await startCamera(video, log('camera'))
    streamRef.current = run.stream
    setCameraOn(run.stream !== undefined)
    finish('camera', run.status)
    setBusy(null)
  }
  const onStopCamera = useCallback(() => {
    stopCamera(videoRef.current, streamRef.current)
    streamRef.current = undefined
    setCameraOn(false)
  }, [])
  const onCapture = async () => {
    if (!videoRef.current) return
    try {
      const image = await captureFrame(videoRef.current)
      showPhoto(image)
      log('camera')(`Captured a frame: ${image.width}x${image.height}, JPEG ${(image.bytes / 1024).toFixed(0)} KB`)
    } catch (error) {
      log('camera')(`Capture failed: ${String(error)}`)
    }
  }
  const onPickPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const { lines, image } = await describeImageFile(file)
      lines.forEach(log('camera'))
      showPhoto(image)
    } catch (error) {
      log('camera')(`Could not read the photo: ${String(error)}`)
    }
    event.target.value = ''
  }
  useEffect(() => onStopCamera, [onStopCamera])

  // --- Location ---
  const onLocation = async () => {
    begin('location')
    setBusy('location')
    finish('location', await runLocationCheck(log('location')))
    setBusy(null)
  }

  // --- Storage ---
  const [sizeMb, setSizeMb] = useState(100)
  const [progress, setProgress] = useState('')
  const onWrite = async () => {
    begin('storage')
    setBusy('storage')
    const status = await runStorageWrite(sizeMb, (bytes) => setProgress(`${Math.round(bytes / MB)} MB`), log('storage'))
    setProgress('')
    finish('storage', status)
    setBusy(null)
  }
  const onVerify = async () => {
    begin('storage')
    setBusy('storage')
    const status = await verifyStorage((bytes) => setProgress(`read ${Math.round(bytes / MB)} MB`), log('storage'))
    setProgress('')
    finish('storage', status)
    setBusy(null)
  }
  const onPersist = async () => {
    setBusy('storage')
    await requestPersistence(log('storage'))
    setBusy(null)
  }

  // --- Models ---
  const onModels = async () => {
    begin('models')
    setBusy('models')
    const add = log('models')
    add(`CPU baseline: ${Math.round(cpuBaselineMs())} ms for 40 million multiply-adds (a laptop browser takes roughly 50 to 100 ms)`)
    const { benchmarks, problem } = await loadBenchmarks()
    if (benchmarks.length === 0) {
      add(problem ?? 'No models are bundled in this build yet. The deploy downloads them with scripts/fetch-models.mjs.')
      finish('models', 'warn')
    } else {
      finish('models', await runModelBenchmarks(benchmarks, add))
    }
    setBusy(null)
  }

  // --- Report ---
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const report = useMemo(
    () => buildReport(states, [`BirdDex field check, ${new Date().toISOString()}`, `Page: ${location.href}`]),
    [states],
  )
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(report)
      setCopied('Copied. Paste it into the chat.')
    } catch {
      textareaRef.current?.select()
      setCopied('Text selected. Use Copy from the pop-up menu.')
    }
  }
  const onShare = async () => {
    try {
      await navigator.share({ title: 'BirdDex field check', text: report })
    } catch {
      // The share sheet was dismissed.
    }
  }

  const installed = isStandalone()
  const disabled = busy !== null

  return (
    <main className="page">
      <a className="back" href="#/">
        ← Home
      </a>
      <h1>Field check</h1>
      <p className="muted">
        Run the cards from top to bottom. When you are done, press <b>Copy report</b> at the bottom and paste it into the chat with me.
      </p>

      {!installed && (
        <div className="banner" data-testid="install-banner">
          Not installed yet. On iPhone: tap Share, then <b>Add to Home Screen</b>, then open BirdDex from the new icon and run the checks again.
          On Android: use Chrome&apos;s menu, <b>Install app</b>.
          {installEvent && (
            <div>
              <button onClick={() => void installEvent.prompt()}>Install now</button>
            </div>
          )}
        </div>
      )}

      <Card id="environment" state={states.environment}>
        <button className="secondary" disabled={disabled} onClick={() => void runEnvironment()}>
          Run again
        </button>
      </Card>

      <Card id="microphone" state={states.microphone} hint="Tap Start, then talk, clap or play a bird recording for 5 seconds.">
        <button data-testid="mic-start" disabled={disabled} onClick={() => void onMicrophone()}>
          Start (5 s)
        </button>
        <button className="secondary" disabled={disabled || !canPlay} onClick={() => void onPlayback()}>
          Play it back
        </button>
        <div className="meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={level}>
          <div style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      </Card>

      <Card
        id="camera"
        state={states.camera}
        hint="Point the camera at something. Tap Start camera and wait a few seconds. The photo buttons test the phone's own camera app."
      >
        <video ref={videoRef} playsInline muted autoPlay style={{ display: cameraOn ? 'block' : 'none' }} />
        {photo && <img className="preview" src={photo.url} alt="Last captured" />}
        <div>
          <button data-testid="camera-start" disabled={disabled || cameraOn} onClick={() => void onStartCamera()}>
            Start camera
          </button>
          <button className="secondary" disabled={!cameraOn} onClick={() => void onCapture()}>
            Capture a frame
          </button>
          <button className="secondary" disabled={!cameraOn} onClick={onStopCamera}>
            Stop
          </button>
        </div>
        <p className="hint">Fallback route: the phone&apos;s own camera or photo library.</p>
        <input data-testid="camera-file" type="file" accept="image/*" capture="environment" onChange={(event) => void onPickPhoto(event)} />
      </Card>

      <Card id="location" state={states.location} hint="Needed later to save where you caught each bird.">
        <button data-testid="location-start" disabled={disabled} onClick={() => void onLocation()}>
          Get my location
        </button>
      </Card>

      <Card
        id="storage"
        state={states.storage}
        hint="Catches and models must survive. Write test data, verify it, close the app completely, reopen it, and check again. Check once more tomorrow."
      >
        <label>
          Size{' '}
          <select value={sizeMb} onChange={(event) => setSizeMb(Number(event.target.value))} disabled={disabled}>
            <option value={20}>20 MB (quick)</option>
            <option value={100}>100 MB</option>
            <option value={300}>300 MB</option>
          </select>
        </label>
        <div>
          <button data-testid="storage-write" disabled={disabled} onClick={() => void onWrite()}>
            Write test data
          </button>
          <button className="secondary" data-testid="storage-verify" disabled={disabled} onClick={() => void onVerify()}>
            Verify
          </button>
          <button className="secondary" disabled={disabled} onClick={() => void onPersist()}>
            Ask for persistent storage
          </button>
          <button className="secondary" disabled={disabled} onClick={() => void refreshStorage()}>
            Look again
          </button>
        </div>
        {progress && <p className="hint">{progress}</p>}
      </Card>

      <Card id="offline" state={states.offline} hint="The app must start with no network, for example in the garden.">
        <button className="secondary" disabled={disabled} onClick={() => void runOffline()}>
          Check again
        </button>
      </Card>

      <Card id="models" state={states.models} hint="Times the bird-sound model on this phone. Needs a Wi-Fi connection the first time.">
        <button data-testid="models-start" disabled={disabled} onClick={() => void onModels()}>
          Run speed test
        </button>
      </Card>

      <section className="card">
        <header>
          <h2>Report</h2>
        </header>
        <button data-testid="report-copy" onClick={() => void onCopy()}>
          Copy report
        </button>
        {typeof navigator.share === 'function' && (
          <button className="secondary" onClick={() => void onShare()}>
            Share
          </button>
        )}
        {copied && <p className="hint">{copied}</p>}
        <textarea ref={textareaRef} readOnly value={report} data-testid="report-text" />
      </section>
    </main>
  )
}
