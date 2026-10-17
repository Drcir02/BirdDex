import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex, sha256HexJs } from '../../src/ml/runtime/sha256'

const reference = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const pattern = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 131 + (i >> 8) * 7 + 3) & 0xff)

afterEach(() => vi.unstubAllGlobals())

describe('sha256HexJs (the fallback for pages without crypto.subtle)', () => {
  it('matches the well-known test vectors', async () => {
    expect(await sha256HexJs(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256HexJs(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256HexJs(new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it.each([1, 2, 31, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 1000, 4095, 65536, 100_003])(
    'matches Node for %i bytes',
    async (length) => {
      const data = pattern(length)
      expect(await sha256HexJs(data)).toBe(reference(data))
    },
  )

  it('handles data bigger than one slice, and a view into a bigger buffer', async () => {
    const data = pattern(4 * 1024 * 1024 + 4096 + 13)
    expect(await sha256HexJs(data)).toBe(reference(data))
    const big = pattern(5000)
    const view = big.subarray(100, 4000)
    expect(await sha256HexJs(view)).toBe(reference(view))
  })

  it('does not change the data it hashes', async () => {
    const data = pattern(300)
    const copy = data.slice()
    await sha256HexJs(data)
    expect(data).toEqual(copy)
  })
})

describe('sha256Hex', () => {
  it('uses the browser implementation when there is one', async () => {
    const data = pattern(777)
    expect(await sha256Hex(data)).toBe(reference(data))
  })

  it('falls back to JavaScript without crypto.subtle (an http page)', async () => {
    vi.stubGlobal('crypto', {})
    const data = pattern(777)
    expect(await sha256Hex(data)).toBe(reference(data))
  })

  it('falls back to JavaScript when the browser implementation fails', async () => {
    vi.stubGlobal('crypto', {
      subtle: {
        digest: async () => {
          throw new Error('not allowed')
        },
      },
    })
    const data = pattern(500)
    expect(await sha256Hex(data)).toBe(reference(data))
  })
})
