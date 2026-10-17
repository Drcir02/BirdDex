import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { orientedSize, parseImageHeader, readImageHeader } from '../../src/features/scan/imageHeader'

// Real files made by tests/fixtures/phone/make-phone-fixtures.py (Pillow), the kind of picture a phone sends.
const PHONE = join(__dirname, '..', 'fixtures', 'phone')
const PHOTOS = join(__dirname, '..', 'fixtures', 'photos')
const bytes = (path: string) => new Uint8Array(readFileSync(path))

describe('parseImageHeader', () => {
  it('reads a 12 megapixel portrait photo that is stored sideways (EXIF orientation 6)', () => {
    const header = parseImageHeader(bytes(join(PHONE, 'iphone-portrait-12mp-exif6.jpg')))
    expect(header).toEqual({ width: 4032, height: 3024, orientation: 6 })
    expect(orientedSize(header!)).toEqual({ width: 3024, height: 4032 })
  })

  it('reads the other quarter turn (8) and the half turn (3)', () => {
    const eight = parseImageHeader(bytes(join(PHONE, 'phone-portrait-exif8.jpg')))
    expect(eight).toEqual({ width: 900, height: 1200, orientation: 8 })
    expect(orientedSize(eight!)).toEqual({ width: 1200, height: 900 })
    const three = parseImageHeader(bytes(join(PHONE, 'phone-upside-down-exif3.jpg')))
    expect(three).toEqual({ width: 1200, height: 900, orientation: 3 })
    expect(orientedSize(three!)).toEqual({ width: 1200, height: 900 })
  })

  it('treats a JPEG without EXIF as upright', () => {
    expect(parseImageHeader(bytes(join(PHONE, 'tiny.jpg')))).toEqual({ width: 12, height: 9, orientation: 1 })
    expect(parseImageHeader(bytes(join(PHOTOS, 'Mallard_drake_on_Union_Bay_Natural_Area.jpg')))?.orientation).toBe(1)
  })

  it('reads a PNG', () => {
    expect(parseImageHeader(bytes(join(PHONE, 'kingfisher.png')))).toEqual({ width: 640, height: 427, orientation: 1 })
  })

  it('reads the size of a cut-off JPEG whose header is intact (decoding is what fails)', () => {
    expect(parseImageHeader(bytes(join(PHONE, 'truncated.jpg')))).toMatchObject({ width: 960, height: 640 })
  })

  it('gives up quietly on anything else', () => {
    expect(parseImageHeader(new Uint8Array())).toBeUndefined()
    expect(parseImageHeader(new TextEncoder().encode('this is not a picture at all'))).toBeUndefined()
    expect(parseImageHeader(new Uint8Array([0xff, 0xd8]))).toBeUndefined()
    expect(parseImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45]))).toBeUndefined()
    // A frame header that claims no size.
    expect(parseImageHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 0, 0, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]))).toBeUndefined()
    // A PNG signature and nothing else.
    expect(parseImageHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeUndefined()
  })

  it('ignores an orientation value outside 1 to 8', () => {
    const file = Uint8Array.from(readFileSync(join(PHONE, 'phone-portrait-exif8.jpg')))
    // The orientation sits in the EXIF block; patch the value (little or big endian: the short is 8 in one byte).
    const at = file.findIndex((value, index) => index > 20 && index < 200 && value === 0x12 && file[index - 1] === 0x01)
    expect(at).toBeGreaterThan(0)
    const copy = file.slice()
    for (let i = at; i < at + 10; i++) if (copy[i] === 8) copy[i] = 9
    expect(parseImageHeader(copy)?.orientation).toBe(1)
  })
})

describe('readImageHeader', () => {
  it('reads from a Blob and never throws', async () => {
    expect(await readImageHeader(new Blob([readFileSync(join(PHONE, 'iphone-portrait-12mp-exif6.jpg'))]))).toMatchObject({ orientation: 6 })
    expect(await readImageHeader(new Blob(['nope']))).toBeUndefined()
    expect(await readImageHeader({ slice: () => { throw new Error('boom') } } as unknown as Blob)).toBeUndefined()
  })
})
