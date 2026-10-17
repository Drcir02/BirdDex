import type { Status } from '../types'

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number
}

interface FrameStats {
  firstFrameMs?: number
  frames: number
  windowSeconds: number
}

/**
 * Counts decoded video frames for `windowMs` after the first one arrives.
 * Reports zero frames if nothing arrives within `timeoutMs` (a stalled camera).
 */
function measureFrames(video: VideoWithFrameCallback, timeoutMs: number, windowMs: number): Promise<FrameStats> {
  return new Promise((resolve) => {
    const start = performance.now()
    let firstAt: number | undefined
    let frames = 0
    let finished = false
    let lastTime = -1

    const finish = () => {
      if (finished) return
      finished = true
      clearInterval(poll)
      resolve({
        firstFrameMs: firstAt === undefined ? undefined : firstAt - start,
        frames,
        windowSeconds: firstAt === undefined ? 0 : (performance.now() - firstAt) / 1000,
      })
    }
    const stallTimer = setTimeout(finish, timeoutMs)
    const onFrame = () => {
      if (finished) return
      if (firstAt === undefined) {
        firstAt = performance.now()
        clearTimeout(stallTimer)
        setTimeout(finish, windowMs)
      }
      frames++
    }

    let poll: ReturnType<typeof setInterval> | undefined
    if (video.requestVideoFrameCallback) {
      const loop = () => {
        onFrame()
        if (!finished) video.requestVideoFrameCallback!(loop)
      }
      video.requestVideoFrameCallback(loop)
    } else {
      // Older browsers: treat each change of the playback position as a frame.
      poll = setInterval(() => {
        if (video.currentTime !== lastTime) {
          lastTime = video.currentTime
          onFrame()
        }
      }, 33)
    }
  })
}

export async function startCamera(
  video: HTMLVideoElement,
  log: (line: string) => void,
): Promise<{ status: Status; stream?: MediaStream }> {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      log('getUserMedia is not available in this browser.')
      return { status: 'fail' }
    }
    const opened = performance.now()
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
    log(`Camera opened in ${Math.round(performance.now() - opened)} ms`)
    const settings = stream.getVideoTracks()[0].getSettings()
    log(`Track: ${settings.width ?? '?'}x${settings.height ?? '?'} at ${settings.frameRate ?? '?'} fps, facing ${settings.facingMode ?? 'unknown'}`)

    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play().catch((error: unknown) => log(`video.play() was rejected: ${String(error)}`))

    const stats = await measureFrames(video, 6000, 2000)
    if (stats.frames === 0) {
      log('No video frames arrived within 6 s. This matches a known iOS bug for home-screen web apps. The fallback is the phone camera picker below.')
      return { status: 'fail', stream }
    }
    const fps = stats.windowSeconds > 0 ? (stats.frames - 1) / stats.windowSeconds : 0
    log(`First frame after ${Math.round(stats.firstFrameMs ?? 0)} ms, about ${fps.toFixed(0)} frames/s, picture ${video.videoWidth}x${video.videoHeight}`)
    return { status: fps >= 8 ? 'pass' : 'warn', stream }
  } catch (error) {
    log(`Failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`)
    return { status: 'fail' }
  }
}

export function stopCamera(video: HTMLVideoElement | null, stream: MediaStream | undefined): void {
  stream?.getTracks().forEach((track) => track.stop())
  if (video) video.srcObject = null
}

export interface CapturedImage {
  width: number
  height: number
  bytes: number
  url: string
}

/** Copies the current video frame to a JPEG, the same way the app will feed photos to the models. */
export async function captureFrame(video: HTMLVideoElement): Promise<CapturedImage> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) throw new Error('The camera has no picture yet.')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(video, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
  if (!blob) throw new Error('Could not encode the frame as JPEG.')
  return { width, height, bytes: blob.size, url: URL.createObjectURL(blob) }
}

/** Reads a photo picked with the phone's own camera app, to prove that route works. */
export async function describeImageFile(file: File): Promise<{ lines: string[]; image: CapturedImage }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    bitmap = await createImageBitmap(file)
  }
  const image: CapturedImage = { width: bitmap.width, height: bitmap.height, bytes: file.size, url: URL.createObjectURL(file) }
  bitmap.close()
  return {
    lines: [`Photo picked: ${file.type || 'unknown type'}, ${image.width}x${image.height}, ${(file.size / 1024).toFixed(0)} KB`],
    image,
  }
}
