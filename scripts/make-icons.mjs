// Renders the SVG icons in public/icons/ to the PNG sizes phones need, using the Chromium that
// Playwright already has. Run with: CHROMIUM_PATH=/path/to/chromium npm run icons
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const jobs = [
  { svg: 'icon.svg', png: 'icon-192.png', size: 192 },
  { svg: 'icon.svg', png: 'icon-512.png', size: 512 },
  // iOS rounds the corners itself and shows transparent pixels as black, so it gets the full-bleed version.
  { svg: 'icon-maskable.svg', png: 'apple-touch-icon.png', size: 180 },
  { svg: 'icon-maskable.svg', png: 'icon-maskable-512.png', size: 512 },
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
try {
  for (const { svg, png, size } of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    const source = readFileSync(join(dir, svg), 'utf8')
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
    )
    writeFileSync(join(dir, png), await page.screenshot({ omitBackground: true }))
    await page.close()
    console.log('wrote', png)
  }
} finally {
  await browser.close()
}
