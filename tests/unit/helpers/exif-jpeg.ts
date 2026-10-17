// A hand-made EXIF block (little-endian TIFF) for the tests of src/features/scan/exifMeta.ts.

// A small JPEG with an EXIF block, built by hand (little-endian TIFF).
export interface ExifFields {
  date?: string
  gps?: { latRef: string; lat: [number, number, number]; lonRef: string; lon: [number, number, number] }
}

export function buildExifSegment({ date, gps }: ExifFields): number[] {
  const tiff: number[] = []
  const u16 = (value: number) => [value & 0xff, (value >> 8) & 0xff]
  const u32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
  const entry = (tag: number, type: number, count: number, value: number[]) => [...u16(tag), ...u16(type), ...u32(count), ...[...value, 0, 0, 0, 0].slice(0, 4)]

  // Layout: header (8), IFD0 (2 + 2 entries * 12 + 4), Exif IFD, GPS IFD, then the data blocks.
  const ifd0At = 8
  const ifd0Size = 2 + 2 * 12 + 4
  const exifAt = ifd0At + ifd0Size
  const exifSize = 2 + 12 + 4
  const gpsAt = exifAt + exifSize
  const gpsSize = 2 + 4 * 12 + 4
  const dataAt = gpsAt + gpsSize
  const dateBytes = date ? [...Buffer.from(`${date}\0`, 'latin1')] : []
  const rational = (parts: [number, number, number]) => parts.flatMap((part) => [...u32(Math.round(part * 100)), ...u32(100)])
  const latData = gps ? rational(gps.lat) : []
  const lonData = gps ? rational(gps.lon) : []
  const dateAt = dataAt
  const latAt = dateAt + dateBytes.length
  const lonAt = latAt + latData.length

  tiff.push(0x49, 0x49, 42, 0, ...u32(ifd0At))
  tiff.push(...u16(2), ...entry(0x8769, 4, 1, u32(exifAt)), ...entry(0x8825, 4, 1, gps ? u32(gpsAt) : u32(0)), ...u32(0))
  tiff.push(...u16(1), ...entry(0x9003, 2, dateBytes.length, u32(dateAt)), ...u32(0))
  tiff.push(
    ...u16(4),
    ...entry(1, 2, 2, [...Buffer.from(`${gps?.latRef ?? 'N'}\0`, 'latin1')]),
    ...entry(2, 5, 3, u32(latAt)),
    ...entry(3, 2, 2, [...Buffer.from(`${gps?.lonRef ?? 'E'}\0`, 'latin1')]),
    ...entry(4, 5, 3, u32(lonAt)),
    ...u32(0),
  )
  tiff.push(...dateBytes, ...latData, ...lonData)

  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const length = exif.length + 2
  return [0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...exif]
}

/** A tiny JPEG (no picture data) that carries only the EXIF block. */
export function buildJpeg(fields: ExifFields): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...buildExifSegment(fields), 0xff, 0xda, 0, 2])
}

