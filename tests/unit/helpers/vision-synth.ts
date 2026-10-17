// The synthetic pictures of tests/fixtures/vision/make-preprocess-vectors.py, repeated with the same integer formula,
// so the test can rebuild exactly the pixels that Pillow was given.

/** A height x width x 3 picture of bytes. */
export function synthPicture(width: number, height: number, seed: number): Uint8Array {
  const out = new Uint8Array(width * height * 3)
  let o = 0
  for (let y = 0; y < height; y++) {
    const gy = Math.floor((y * 255) / Math.max(height - 1, 1))
    for (let x = 0; x < width; x++) {
      const gx = Math.floor((x * 255) / Math.max(width - 1, 1))
      for (let c = 0; c < 3; c++) {
        let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(c, 2147483629) + Math.imul(seed, 1274126177)) >>> 0
        h = (h ^ (h >>> 13)) >>> 0
        h = Math.imul(h, 1274126177) >>> 0
        h = (h ^ (h >>> 16)) >>> 0
        const noise = h & 255
        const grad = Math.floor((gx * (c + 1) + gy * (3 - c)) / 4) % 256
        const checker = (Math.floor(x / 9) + Math.floor(y / 6) + c) % 2 === 0 ? 255 : 0
        out[o++] = Math.floor((noise * 2 + grad * 4 + checker * 2) / 8)
      }
    }
  }
  return out
}

/** The same picture with a made-up alpha channel, the way a canvas hands out pixels. */
export function withAlpha(rgb: Uint8Array): Uint8ClampedArray {
  const pixels = rgb.length / 3
  const out = new Uint8ClampedArray(pixels * 4)
  for (let i = 0; i < pixels; i++) {
    out[i * 4] = rgb[i * 3]
    out[i * 4 + 1] = rgb[i * 3 + 1]
    out[i * 4 + 2] = rgb[i * 3 + 2]
    out[i * 4 + 3] = (i * 37) % 256
  }
  return out
}
