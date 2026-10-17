// Pictures and sounds for the demo catches, made on the spot: no files to ship and nothing to download.
// The pictures are small drawings (a sky, some leaves, a bird shape and the word "demo" in a corner), the sounds are a few
// short bird-like whistles. Neither could be mistaken for a real catch.

import { encodeWavBlob } from '../../../ml/audio/wav'
import { SONGBIRD_PATH } from '../../../ui/silhouette'
import { seededRandom } from './demoPlan'

export const DEMO_CLIP_RATE = 16000
export const DEMO_CLIP_SECONDS = 2.4

/** A short run of whistles with a bird-like pitch and rhythm. Samples between -1 and 1. */
export function makeDemoSamples(seed: number): Float32Array {
  const random = seededRandom(seed)
  const samples = new Float32Array(Math.round(DEMO_CLIP_RATE * DEMO_CLIP_SECONDS))
  const base = 1800 + (seed % 7) * 330
  const whistles = 3 + (seed % 3)
  for (let whistle = 0; whistle < whistles; whistle += 1) {
    const start = 0.12 + whistle * (DEMO_CLIP_SECONDS - 0.5) / whistles + random() * 0.08
    const length = 0.22 + random() * 0.16
    const rise = (random() - 0.35) * 0.9 // the pitch goes up or down during the whistle
    let phase = 0
    const from = Math.floor(start * DEMO_CLIP_RATE)
    const to = Math.min(samples.length, Math.floor((start + length) * DEMO_CLIP_RATE))
    for (let index = from; index < to; index += 1) {
      const position = (index - from) / (to - from)
      const vibrato = 1 + 0.03 * Math.sin(2 * Math.PI * 28 * position)
      const frequency = base * (1 + rise * position) * vibrato
      phase += (2 * Math.PI * frequency) / DEMO_CLIP_RATE
      const envelope = Math.sin(Math.PI * position) ** 1.5
      samples[index] += 0.55 * envelope * Math.sin(phase)
    }
  }
  return samples
}

/** The recording of a demo catch, as a WAV file like the ones the sound scan saves. */
export function makeDemoClip(seed: number): { blob: Blob; durationS: number } {
  return { blob: encodeWavBlob(makeDemoSamples(seed), DEMO_CLIP_RATE), durationS: DEMO_CLIP_SECONDS }
}

const WIDTH = 480
const HEIGHT = 360

/** The picture of a demo catch, a JPEG. Needs a browser (canvas); returns undefined where there is none. */
export async function makeDemoImage(seed: number, tag: string): Promise<Blob | undefined> {
  if (typeof document === 'undefined') return undefined
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  if (!context) return undefined
  const random = seededRandom(seed)
  const hue = Math.round(random() * 360)

  const sky = context.createLinearGradient(0, 0, 0, HEIGHT)
  sky.addColorStop(0, `hsl(${(hue + 190) % 360} 60% 72%)`)
  sky.addColorStop(0.7, `hsl(${(hue + 150) % 360} 45% 82%)`)
  sky.addColorStop(1, `hsl(${(hue + 100) % 360} 40% 66%)`)
  context.fillStyle = sky
  context.fillRect(0, 0, WIDTH, HEIGHT)

  // Soft leaves and branches in the foreground and behind.
  for (let leaf = 0; leaf < 26; leaf += 1) {
    context.save()
    context.translate(random() * WIDTH, HEIGHT * (0.55 + random() * 0.5))
    context.rotate((random() - 0.5) * 2.2)
    context.fillStyle = `hsla(${(hue + 80 + random() * 50) % 360} 45% ${28 + random() * 22}% / ${0.35 + random() * 0.4})`
    context.beginPath()
    context.ellipse(0, 0, 16 + random() * 30, 6 + random() * 11, 0, 0, Math.PI * 2)
    context.fill()
    context.restore()
  }
  context.strokeStyle = 'rgba(58, 40, 28, 0.85)'
  context.lineWidth = 9
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(-10, HEIGHT * 0.78)
  context.quadraticCurveTo(WIDTH * 0.45, HEIGHT * (0.7 + random() * 0.08), WIDTH + 10, HEIGHT * 0.74)
  context.stroke()

  // The bird shape sits on the branch (the songbird path is drawn on a 64 x 64 grid facing right).
  context.save()
  const scale = 3.6 + random() * 0.8
  context.translate(WIDTH * (0.34 + random() * 0.14), HEIGHT * 0.74 - 56 * scale)
  context.scale(scale, scale)
  context.fillStyle = `hsl(${(hue + 20) % 360} 35% 22%)`
  context.fill(new Path2D(SONGBIRD_PATH))
  context.fillStyle = '#fff'
  context.beginPath()
  context.arc(45.5, 19.5, 1.9, 0, Math.PI * 2)
  context.fill()
  context.restore()

  // The corner tag, so a demo picture never passes for a real one.
  context.fillStyle = 'rgba(15, 40, 25, 0.8)'
  context.fillRect(12, HEIGHT - 44, 150, 32)
  context.fillStyle = '#b6ff9d'
  context.font = '24px VT323, monospace'
  context.textBaseline = 'middle'
  context.fillText(tag, 22, HEIGHT - 27)

  return new Promise<Blob | undefined>((resolve) => canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/jpeg', 0.72))
}
