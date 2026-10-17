import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from '@playwright/test'
import { skipWelcome } from './shell-helpers'

const ROOT = process.cwd()
const PHOTOS = join(ROOT, 'tests/fixtures/photos')
const SCRATCH = '/tmp/claude-0/-home-user-birddex/0e99ca62-2862-5f81-8bab-f52d4da0bb0b/scratchpad'
const geo = JSON.parse(readFileSync(join(SCRATCH, 'geo.json'), 'utf8')) as Record<string, Record<string, number>>
const dex = JSON.parse(readFileSync(join(ROOT, 'public/data/species.json'), 'utf8')) as { id: string; englishName: string }[]
const name = (id: string) => dex.find((s) => s.id === id)?.englishName ?? id

test('measure priors', async ({ page }) => {
  test.setTimeout(600_000)
  await skipWelcome(page)
  await page.goto('/#/dev/photo')
  await page.waitForFunction(() => window.birddexPhotoDev !== undefined)
  await page.evaluate(() => window.birddexPhotoDev!.prepare())
  const out: string[] = []
  for (const mode of ['prague@0.5', 'prague@0.75', 'prague_may@0.5', 'prague_may@0.75']) {
    const [key, k] = mode.split('@')
    const weights = Object.fromEntries(Object.entries(geo[key]).map(([id, w]) => [id, Math.pow(Math.max(w, 0.001), Number(k))]))
    await page.evaluate((w) => window.birddexPhotoDev!.setPriorWeights(w), weights)
    out.push(`== ${mode}`)
    for (const file of readdirSync(PHOTOS).filter((f) => f.endsWith('.jpg')).sort()) {
      const dataUrl = `data:image/jpeg;base64,${readFileSync(join(PHOTOS, file)).toString('base64')}`
      const row = await page.evaluate(([label, url]) => window.birddexPhotoDev!.identifyDataUrl(label, url), [file, dataUrl] as const)
      out.push(`${file.slice(0, 28).padEnd(28)} pBird ${row.pBird.toFixed(3)} outMass ${row.diagnostics.outsideDexMass.toFixed(2)}  ` + row.candidates.map((c) => `${name(c.speciesId)} ${c.confidence.toFixed(3)}`).join(' | '))
    }
  }
  writeFileSync(join(SCRATCH, 'prior-measure.txt'), out.join('\n'))
  console.log(out.join('\n'))
})
