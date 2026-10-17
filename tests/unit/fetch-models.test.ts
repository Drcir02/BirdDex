import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseManifest } from '../../src/ml/runtime/modelManifest'

// Runs scripts/fetch-models.mjs against a small local web server, so the download, checking and manifest logic is
// tested without touching GitHub. The script runs as a separate process, started with spawn (not spawnSync): the
// server lives in this process and must keep answering while the script runs.
describe('scripts/fetch-models.mjs', () => {
  let work: string
  let server: Server
  let base: string
  let hits: string[]
  /** Paths the server answers with a failure, one entry per failing answer, e.g. { '/flaky.bin': 2 }. */
  let failures: Record<string, number>

  const content = {
    audio: Buffer.alloc(5000, 7),
    graph: Buffer.alloc(4000, 9),
    weights: Buffer.alloc(3000, 3),
    big: Buffer.alloc(6000, 5),
  }
  const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'birddex-fetch-test-'))
    const site = join(work, 'site')
    mkdirSync(site, { recursive: true })
    writeFileSync(join(site, 'audio.tflite'), content.audio)
    writeFileSync(join(site, 'graph.onnx'), content.graph)
    writeFileSync(join(site, 'weights.data'), content.weights)
    writeFileSync(join(site, 'big.tflite'), content.big)

    server = createServer((request, response) => {
      const name = request.url?.slice(1) ?? ''
      hits.push(`/${name}`)
      if (failures[`/${name}`] > 0) {
        failures[`/${name}`]--
        response.writeHead(503).end('busy')
        return
      }
      const path = join(site, name)
      if (!name || name.includes('..') || !existsSync(path)) {
        response.writeHead(404).end('missing')
        return
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(readFileSync(path))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(() => {
    server.close()
    rmSync(work, { recursive: true, force: true })
  })

  const reset = () => {
    hits = []
    failures = {}
  }

  const run = (config: unknown, out: string, extra: string[] = []) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const configPath = join(work, 'config.json')
      writeFileSync(configPath, JSON.stringify(config))
      const child = spawn('node', ['scripts/fetch-models.mjs', '--config', configPath, '--out', out, ...extra], {
        env: { ...process.env, FETCH_MODELS_RETRY_MS: '10' },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('error', reject)
      child.on('close', (status) => resolve({ status, stdout, stderr }))
    })

  const manifestOf = (out: string) => JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))

  const input = { shape: [1, 144000], dtype: 'float32' }
  const files = {
    audio: { id: 'audio', label: 'Audio', file: 'audio.tflite', url: `${'BASE'}/audio.tflite` },
    graph: { id: 'graph', label: 'Graph', file: 'graph.onnx', url: `${'BASE'}/graph.onnx` },
    weights: { id: 'weights', label: 'Weights', file: 'weights.data', url: `${'BASE'}/weights.data` },
  }
  const source = (name: keyof typeof files, extra: Record<string, unknown> = {}) => ({ ...files[name], url: files[name].url.replace('BASE', base), ...extra })
  const benchmarks = [
    { id: 'audio', label: 'Audio bench', runtime: 'litert', file: 'audio.tflite', input },
    { id: 'graph', label: 'Graph bench', runtime: 'ort', file: 'graph.onnx', input: { shape: [1, 3, 224, 224], dtype: 'float32' }, externalData: ['weights.data'] },
  ]

  it('downloads the files and writes a version 2 manifest that the app accepts', async () => {
    reset()
    const out = join(work, 'out-ok')
    const result = await run({ files: [source('audio'), source('graph'), source('weights')], benchmarks }, out)
    expect(result.status).toBe(0)
    expect(readFileSync(join(out, 'audio.tflite'))).toEqual(content.audio)
    expect(readFileSync(join(out, 'graph.onnx'))).toEqual(content.graph)

    const manifest = manifestOf(out)
    expect(manifest.version).toBe(2)
    expect(manifest.files).toEqual([
      { id: 'audio', file: 'audio.tflite', bytes: 5000, sha256: sha(content.audio), label: 'Audio' },
      { id: 'graph', file: 'graph.onnx', bytes: 4000, sha256: sha(content.graph), label: 'Graph' },
      { id: 'weights', file: 'weights.data', bytes: 3000, sha256: sha(content.weights), label: 'Weights' },
    ])
    expect(manifest.benchmarks).toEqual(benchmarks)
    // The app must be able to read what the script writes.
    expect(parseManifest(manifest).files).toHaveLength(3)
    expect(parseManifest(manifest).benchmarks[1].externalData).toEqual(['weights.data'])
    expect(readdirSync(out).sort()).toEqual(['audio.tflite', 'graph.onnx', 'manifest.json', 'weights.data'])
  })

  it('checks a downloaded file against the size and checksum it is pinned to', async () => {
    reset()
    const out = join(work, 'out-pinned')
    const result = await run({ files: [source('audio', { bytes: 5000, sha256: sha(content.audio) })] }, out)
    expect(result.status).toBe(0)
    expect(manifestOf(out).files[0]).toMatchObject({ bytes: 5000, sha256: sha(content.audio) })
  })

  it('rejects a file whose checksum does not match, and leaves nothing behind', async () => {
    reset()
    const out = join(work, 'out-checksum')
    const result = await run({ files: [source('graph', { sha256: '0'.repeat(64) })] }, out)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('FAILED')
    expect(result.stderr).toContain('checksum mismatch')
    expect(readdirSync(out)).toEqual(['manifest.json'])
    expect(manifestOf(out).files).toEqual([])
  })

  it('rejects a file of the wrong size', async () => {
    reset()
    const out = join(work, 'out-size')
    const result = await run({ files: [source('graph', { bytes: 123 })] }, out)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('size is 4000, expected 123')
    expect(existsSync(join(out, 'graph.onnx'))).toBe(false)
    expect(existsSync(join(out, 'graph.onnx.part'))).toBe(false)
  })

  it('keeps going when one file cannot be downloaded and lists only what it has', async () => {
    reset()
    const out = join(work, 'out-partial')
    const config = {
      files: [source('audio'), { id: 'gone', label: 'Missing', file: 'gone.bin', url: `${base}/nope.bin` }, source('graph')],
      benchmarks,
    }
    const result = await run(config, out)
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('FAILED')
    expect(result.stderr).toContain('HTTP 404')
    expect(result.stdout).toContain('manifest.json lists 2 of 3 models and 1 benchmarks')
    const manifest = manifestOf(out)
    expect(manifest.files.map((file: { id: string }) => file.id)).toEqual(['audio', 'graph'])
    // The photo benchmark needs weights.data, which is not there, so it is not offered; the audio one is.
    expect(manifest.benchmarks.map((benchmark: { id: string }) => benchmark.id)).toEqual(['audio'])
    // A file that does not exist is not asked for again.
    expect(hits.filter((path) => path === '/nope.bin')).toHaveLength(1)
  })

  it('exits with an error for any missing file when asked to be strict', async () => {
    reset()
    const out = join(work, 'out-strict')
    const result = await run({ files: [source('audio'), { id: 'gone', label: 'Missing', file: 'gone.bin', url: `${base}/nope.bin` }] }, out, ['--strict'])
    expect(result.status).toBe(1)
    expect(manifestOf(out).files.map((file: { id: string }) => file.id)).toEqual(['audio'])
  })

  it('does not download again when the file is already there', async () => {
    reset()
    const out = join(work, 'out-again')
    const config = { files: [source('audio', { bytes: 5000, sha256: sha(content.audio) })] }
    await run(config, out)
    expect(hits).toEqual(['/audio.tflite'])
    const second = await run(config, out)
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('already there')
    expect(hits).toEqual(['/audio.tflite'])
    expect(manifestOf(out).files[0].sha256).toBe(sha(content.audio))
  })

  it('works with no download address at all when the file is already on disk (a machine without internet)', async () => {
    reset()
    const out = join(work, 'out-offline')
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'audio.tflite'), content.audio)
    const result = await run({ files: [{ id: 'audio', label: 'Audio', file: 'audio.tflite', bytes: 5000, sha256: sha(content.audio) }], benchmarks }, out)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('already there')
    expect(hits).toEqual([])
    expect(manifestOf(out).files).toEqual([{ id: 'audio', file: 'audio.tflite', bytes: 5000, sha256: sha(content.audio), label: 'Audio' }])
  })

  it('replaces a file on disk that is damaged, and says so', async () => {
    reset()
    const out = join(work, 'out-damaged')
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'audio.tflite'), Buffer.alloc(5000, 1)) // right size, wrong content
    const result = await run({ files: [source('audio', { bytes: 5000, sha256: sha(content.audio) })] }, out)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('cannot be used')
    expect(readFileSync(join(out, 'audio.tflite'))).toEqual(content.audio)
  })

  it('keeps the old file when the replacement cannot be downloaded', async () => {
    reset()
    const out = join(work, 'out-keep')
    mkdirSync(out, { recursive: true })
    const old = Buffer.alloc(100, 2)
    writeFileSync(join(out, 'gone.bin'), old)
    const result = await run({ files: [{ id: 'gone', label: 'Gone', file: 'gone.bin', url: `${base}/nope.bin` }] }, out, ['--force'])
    expect(result.status).toBe(1)
    expect(readFileSync(join(out, 'gone.bin'))).toEqual(old)
    expect(manifestOf(out).files).toEqual([])
  })

  it('downloads again with --force', async () => {
    reset()
    const out = join(work, 'out-force')
    const config = { files: [source('audio')] }
    await run(config, out)
    await run(config, out, ['--force'])
    expect(hits).toEqual(['/audio.tflite', '/audio.tflite'])
  })

  it('tries again after a busy server', async () => {
    reset()
    failures = { '/audio.tflite': 2 }
    const out = join(work, 'out-retry')
    const result = await run({ files: [source('audio')] }, out)
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('attempt 1 failed')
    expect(hits.filter((path) => path === '/audio.tflite')).toHaveLength(3)
    expect(readFileSync(join(out, 'audio.tflite'))).toEqual(content.audio)
  })

  it('gives up after three tries on a server that stays busy', async () => {
    reset()
    failures = { '/audio.tflite': 99 }
    const out = join(work, 'out-busy')
    const result = await run({ files: [source('audio')] }, out)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('HTTP 503')
    expect(hits.filter((path) => path === '/audio.tflite')).toHaveLength(3)
  })

  it('gets the big test-only model only with --with-fp32, and never lists it', async () => {
    reset()
    const config = { files: [source('audio')], extras: [{ id: 'big', label: 'Big model', file: 'big.tflite', url: `${base}/big.tflite` }] }
    const without = join(work, 'out-extra-no')
    await run(config, without)
    expect(existsSync(join(without, 'big.tflite'))).toBe(false)

    const withIt = join(work, 'out-extra-yes')
    const result = await run(config, withIt, ['--with-fp32'])
    expect(result.status).toBe(0)
    expect(readFileSync(join(withIt, 'big.tflite'))).toEqual(content.big)
    expect(manifestOf(withIt).files.map((file: { id: string }) => file.id)).toEqual(['audio'])
  })

  it('accepts a plain list of files as the config', async () => {
    reset()
    const out = join(work, 'out-list')
    const result = await run([source('audio'), source('graph')], out)
    expect(result.status).toBe(0)
    expect(manifestOf(out).files).toHaveLength(2)
  })

  it('exits with an error when no model at all is available', async () => {
    reset()
    const out = join(work, 'out-none')
    const result = await run({ files: [{ id: 'gone', label: 'Gone', file: 'gone.bin', url: `${base}/nope.bin` }] }, out)
    expect(result.status).toBe(1)
    expect(manifestOf(out)).toEqual({ version: 2, files: [], benchmarks: [] })
  })

  it('pins the sources and checksums from the brief', () => {
    const script = readFileSync(join(process.cwd(), 'scripts', 'fetch-models.mjs'), 'utf8')
    const pinned = [
      ['birdnet-v2.4-fp16.tflite', 25932528, '5c64ba3ffab264ccbfafe784896392051a86be63b0cc507e7683db7df114546b'],
      ['birdnet-v2.4-geo-fp16.tflite', 14770468, '1226f23fc20362617deb09178f366111b70cf085c2c82893f2814e5acedce6c2'],
      ['wingclip_visual_int8.onnx', 14386564, '4d9ddfad519b6e80f0c5820d7d89051a55cdf9cb4b59ab8bbfe0a9fcc9dc4d59'],
      ['wingclip_visual_int8.data', 25165824, '6bfc8c38271437a04351edbbea9478b29431bc155929da0bebcce68b14090d31'],
      ['text_classifier_int8.bin', 8488140, '5904dc6f5e53fa1aa354749682edd4c4fda4209210882e681b304ca7c4ee6739'],
      ['birdnet-v2.4-fp32.tflite', 51726412, '55f3e4055b1a13bfa9a2452731d0d34f6a02d6b775a334362665892794165e4c'],
    ] as const
    for (const [file, bytes, hash] of pinned) {
      expect(script, file).toContain(`file: '${file}'`)
      expect(script, file).toContain(`bytes: ${bytes}`)
      expect(script, file).toContain(`sha256: '${hash}'`)
    }
    expect(script).toContain('https://github.com/birdnet-team/BirdNET-Analyzer/raw/v1.5.1/birdnet_analyzer/checkpoints/V2.4/')
    expect(script).toContain('BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite')
    expect(script).toContain('BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16.tflite')
    expect(script).toContain('https://github.com/jlian/wingdex/raw/b0dda4b7cb77d86f918c1a75ad662b0f462bb0b2/public/models/')
    expect(script).toContain("shape: [1, 144000]")
    expect(script).toContain('shape: [1, 3, 224, 224]')
  })
})
