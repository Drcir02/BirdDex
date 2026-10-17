import type { CheckState, Status } from '../types'

// Smallest WebAssembly module that uses a SIMD instruction. validate() tells us if the engine supports SIMD.
const WASM_SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
])

interface GpuAdapterLike {
  info?: { vendor?: string; architecture?: string }
}

type NavigatorExtras = Navigator & {
  standalone?: boolean
  deviceMemory?: number
  gpu?: { requestAdapter(): Promise<GpuAdapterLike | null> }
}

export function isStandalone(): boolean {
  const nav = navigator as NavigatorExtras
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export function parseDevice(ua: string, platform: string, touchPoints: number) {
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1)
  const osMatch = ua.match(/OS (\d+)[_.](\d+)(?:[_.](\d+))?/)
  const safariMatch = ua.match(/Version\/(\d+(?:\.\d+)*)/)
  return {
    isIOS,
    isAndroid: /Android/.test(ua),
    // Safari freezes the OS number in the user agent on newer iOS, so also report the Safari version.
    osVersion: osMatch ? osMatch.slice(1).filter(Boolean).join('.') : undefined,
    safariVersion: safariMatch?.[1],
  }
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`

export async function runEnvironmentCheck(): Promise<CheckState> {
  const nav = navigator as NavigatorExtras
  const device = parseDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
  const lines: string[] = []
  let status: Status = 'pass'
  const worst = (s: Status) => {
    if (s === 'fail' || (s === 'warn' && status === 'pass')) status = s
  }

  lines.push(`App ${__APP_VERSION__}, built ${__BUILD_TIME__}`)
  const os = device.isIOS ? 'iOS' : device.isAndroid ? 'Android' : 'other'
  lines.push(
    `Device: ${os}` +
      (device.osVersion ? `, OS token ${device.osVersion}` : '') +
      (device.safariVersion ? `, Version/${device.safariVersion}` : ''),
  )
  lines.push(`User agent: ${navigator.userAgent}`)

  const standalone = isStandalone()
  lines.push(`Running as installed app (from the home screen): ${standalone ? 'yes' : 'no'}`)
  if (!standalone) {
    lines.push('Tip: run the checks once here and once again after installing (Share, Add to Home Screen).')
    worst('warn')
  }

  lines.push(`Secure context (https): ${window.isSecureContext ? 'yes' : 'NO'}`)
  if (!window.isSecureContext) worst('fail')

  const hasMedia = !!navigator.mediaDevices?.getUserMedia
  lines.push(`Microphone and camera API: ${hasMedia ? 'yes' : 'NO'}`)
  if (!hasMedia) worst('fail')

  const hasWasm = typeof WebAssembly === 'object'
  lines.push(`WebAssembly: ${hasWasm ? 'yes' : 'NO'}${hasWasm ? `, SIMD: ${WebAssembly.validate(WASM_SIMD_PROBE) ? 'yes' : 'no'}` : ''}`)
  if (!hasWasm) worst('fail')

  lines.push(
    `Threads in WebAssembly: ${crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined' ? 'yes' : 'no'} ` +
      `(crossOriginIsolated=${crossOriginIsolated}; GitHub Pages cannot set the headers, so single-threaded is expected)`,
  )

  let webgpu = 'no'
  if (nav.gpu) {
    try {
      const adapter = await nav.gpu.requestAdapter()
      webgpu = adapter ? `yes (${[adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(' ') || 'unknown GPU'})` : 'API present but no adapter'
    } catch (error) {
      webgpu = `API present but failed: ${String(error)}`
    }
  }
  lines.push(`WebGPU: ${webgpu}`)

  lines.push(`AudioWorklet: ${typeof AudioWorkletNode === 'function' ? 'yes' : 'NO'}`)
  if (typeof AudioWorkletNode !== 'function') worst('fail')

  lines.push(`CPU cores: ${navigator.hardwareConcurrency ?? '?'}, memory hint: ${nav.deviceMemory ?? 'n/a'} GB`)
  lines.push(`Screen: ${screen.width}x${screen.height} @${devicePixelRatio}x, language ${navigator.language}`)
  lines.push(`Network: ${navigator.onLine ? 'online' : 'offline'}`)

  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate()
    lines.push(`Storage quota: ${mb(estimate.quota ?? 0)}, used ${mb(estimate.usage ?? 0)}`)
  }
  if (navigator.storage?.persisted) {
    lines.push(`Persistent storage granted: ${(await navigator.storage.persisted()) ? 'yes' : 'no'}`)
  }

  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration()
    const state = registration?.active ? 'active' : registration?.installing ? 'installing' : 'none yet'
    lines.push(`Service worker: ${state}, controlling this page: ${navigator.serviceWorker.controller ? 'yes' : 'no'}`)
  } else {
    lines.push('Service worker: NOT supported')
    worst('fail')
  }

  return { status, lines }
}
