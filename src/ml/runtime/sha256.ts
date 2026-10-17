// SHA-256 of a byte array, as lower-case hex. Uses the browser's own implementation (fast, hardware backed) where it
// exists. `crypto.subtle` is only there on secure pages (https or localhost), so over a plain http address, for
// example while testing from a phone on the home network, a plain JavaScript version steps in.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

/** Mixes whole 64-byte blocks from `data` (starting at `offset`) into the running state `h`. */
function compress(h: Uint32Array, w: Uint32Array, data: Uint8Array, offset: number, end: number): void {
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7]
  for (let at = offset; at < end; at += 64) {
    for (let i = 0; i < 16; i++) {
      const j = at + i * 4
      w[i] = (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3]
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]
      const y = w[i - 2]
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let A = a, B = b, C = c, D = d, E = e, F = f, G = g, H = hh
    for (let i = 0; i < 64; i++) {
      const S1 = ((E >>> 6) | (E << 26)) ^ ((E >>> 11) | (E << 21)) ^ ((E >>> 25) | (E << 7))
      const ch = (E & F) ^ (~E & G)
      const t1 = (H + S1 + ch + K[i] + w[i]) | 0
      const S0 = ((A >>> 2) | (A << 30)) ^ ((A >>> 13) | (A << 19)) ^ ((A >>> 22) | (A << 10))
      const maj = (A & B) ^ (A & C) ^ (B & C)
      const t2 = (S0 + maj) | 0
      H = G
      G = F
      F = E
      E = (D + t1) | 0
      D = C
      C = B
      B = A
      A = (t1 + t2) | 0
    }
    a = (a + A) | 0
    b = (b + B) | 0
    c = (c + C) | 0
    d = (d + D) | 0
    e = (e + E) | 0
    f = (f + F) | 0
    g = (g + G) | 0
    hh = (hh + H) | 0
  }
  h[0] = a
  h[1] = b
  h[2] = c
  h[3] = d
  h[4] = e
  h[5] = f
  h[6] = g
  h[7] = hh
}

const SLICE_BYTES = 4 * 1024 * 1024 // a multiple of 64
const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Plain JavaScript SHA-256. Works through the data in slices and lets the page breathe between them. */
export async function sha256HexJs(data: Uint8Array): Promise<string> {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const whole = data.length - (data.length % 64)
  for (let at = 0; at < whole; at += SLICE_BYTES) {
    compress(h, w, data, at, Math.min(at + SLICE_BYTES, whole))
    if (at + SLICE_BYTES < whole) await yieldToBrowser()
  }

  // The last partial block, a 1 bit, zeros, and the length in bits (64-bit, big-endian) fill one or two more blocks.
  const rest = data.length - whole
  const tail = new Uint8Array(rest + 9 > 64 ? 128 : 64)
  tail.set(data.subarray(whole))
  tail[rest] = 0x80
  const bits = data.length * 8
  const view = new DataView(tail.buffer)
  view.setUint32(tail.length - 8, Math.floor(bits / 0x100000000))
  view.setUint32(tail.length - 4, bits >>> 0)
  compress(h, w, tail, 0, tail.length)

  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  h.forEach((word, index) => outView.setUint32(index * 4, word))
  return toHex(out)
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      return toHex(new Uint8Array(await subtle.digest('SHA-256', data as BufferSource)))
    } catch {
      // Fall through to the JavaScript version.
    }
  }
  return sha256HexJs(data)
}
