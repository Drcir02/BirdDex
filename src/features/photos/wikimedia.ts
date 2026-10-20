// Addresses and answers of the Wikipedia and Wikimedia Commons web services, as pure functions (no network here).
//
// The pattern follows WingDex (https://github.com/jlian/wingdex, MIT licence, src/lib/wikimedia.ts): the English
// Wikipedia summary gives the lead picture of the article, and the Commons API gives its author and licence.

import { acceptLicence, cleanAuthor, plainText, type AcceptedLicence } from './licences'

const SUMMARY_BASE = 'https://en.wikipedia.org/api/rest_v1/page/summary/'
const CZECH_SUMMARY_BASE = 'https://cs.wikipedia.org/api/rest_v1/page/summary/'
const COMMONS_HOST = 'commons.wikimedia.org'
const ENGLISH_WIKIPEDIA_HOST = 'en.wikipedia.org'
const UPLOAD_HOST = 'upload.wikimedia.org'

/** The width of the larger picture on the detail screen. Wikimedia serves only a fixed set of widths; 500 is one of them. */
export const DETAIL_WIDTH = 500

// ---------- Wikipedia summary ----------

/** "Great tit" becomes `.../page/summary/Great_tit`. */
export function summaryUrl(title: string): string {
  return SUMMARY_BASE + encodeURIComponent(title.trim().replace(/ /g, '_'))
}

/** The same question to the Czech Wikipedia, for birds whose English article has no usable picture. */
export function czechSummaryUrl(title: string): string {
  return CZECH_SUMMARY_BASE + encodeURIComponent(title.trim().replace(/ /g, '_'))
}

export interface WikiSummary {
  /** The article's lead picture, small version. */
  thumbnailUrl?: string
  /** The article's lead picture, full size. */
  originalUrl?: string
  /** The article itself. */
  pageUrl?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sourceOf(value: unknown): string | undefined {
  return isRecord(value) && typeof value.source === 'string' && value.source !== '' ? value.source : undefined
}

/** Reads the answer of the summary service. Returns undefined when it is not an article (or not even an object). */
export function parseSummary(json: unknown): WikiSummary | undefined {
  if (!isRecord(json)) return undefined
  // Disambiguation pages list several articles; a picture there says nothing about the bird.
  if (json.type === 'disambiguation') return undefined
  const desktop = isRecord(json.content_urls) && isRecord(json.content_urls.desktop) ? json.content_urls.desktop : undefined
  const summary: WikiSummary = {}
  const thumbnailUrl = sourceOf(json.thumbnail)
  const originalUrl = sourceOf(json.originalimage)
  if (thumbnailUrl) summary.thumbnailUrl = thumbnailUrl
  if (originalUrl) summary.originalUrl = originalUrl
  if (desktop && typeof desktop.page === 'string') summary.pageUrl = desktop.page
  return summary
}

// ---------- Picture addresses ----------

export interface CommonsFile {
  /** The wiki that holds the file page: Commons for nearly everything. */
  host: typeof COMMONS_HOST | typeof ENGLISH_WIKIPEDIA_HOST
  /** The file name with spaces, for example "Parus major 2.jpg" (no "File:" in front). */
  name: string
}

/**
 * Finds the file behind a picture address on upload.wikimedia.org: the segment before the size for a thumbnail
 * (`.../thumb/a/ab/Foo.jpg/330px-Foo.jpg`), the last segment for an original (`.../a/ab/Foo.jpg`).
 * Returns undefined for any other address, so a picture whose credit cannot be looked up is never shown.
 */
export function fileOfImageUrl(imageUrl: string): CommonsFile | undefined {
  let url: URL
  try {
    url = new URL(imageUrl)
  } catch {
    return undefined
  }
  if (url.hostname !== UPLOAD_HOST) return undefined
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0] !== 'wikipedia') return undefined
  const host = segments[1] === 'commons' ? COMMONS_HOST : segments[1] === 'en' ? ENGLISH_WIKIPEDIA_HOST : undefined
  if (!host) return undefined
  const raw = segments[2] === 'thumb' ? segments.at(-2) : segments.at(-1)
  if (!raw || !raw.includes('.')) return undefined
  let name: string
  try {
    name = decodeURIComponent(raw)
  } catch {
    return undefined
  }
  return { host, name: name.replace(/_/g, ' ') }
}

/** `https://commons.wikimedia.org/wiki/File:Parus_major_2.jpg`: the page with the credit and the licence text. */
export function filePageUrl(file: CommonsFile): string {
  return `https://${file.host}/wiki/File:${encodeURIComponent(file.name.replace(/ /g, '_'))}`
}

/** The Commons API question for the author and the licence of one file. `origin=*` lets a web page ask. */
export function creditUrl(file: CommonsFile): string {
  const title = encodeURIComponent(`File:${file.name}`)
  return `https://${file.host}/w/api.php?action=query&titles=${title}&prop=imageinfo&iiprop=extmetadata&format=json&formatversion=2&origin=*`
}

/**
 * The same thumbnail at another width. The size sits in the last part of the address (`.../330px-Foo.jpg`, or
 * `.../lossy-page1-330px-Foo.tif.jpg` for files with pages). Addresses without a size are returned unchanged.
 */
export function thumbnailAtWidth(thumbnailUrl: string, width: number): string {
  if (!thumbnailUrl.includes('/thumb/')) return thumbnailUrl
  const slash = thumbnailUrl.lastIndexOf('/')
  const last = thumbnailUrl.slice(slash + 1)
  if (!/\d+px-/.test(last)) return thumbnailUrl
  return `${thumbnailUrl.slice(0, slash + 1)}${last.replace(/\d+px-/, `${width}px-`)}`
}

// ---------- Commons credit ----------

export interface Credit {
  author: string
  licence: AcceptedLicence
}

function valueOf(field: unknown): string | undefined {
  return isRecord(field) && typeof field.value === 'string' ? field.value : undefined
}

function firstPage(json: unknown): Record<string, unknown> | undefined {
  if (!isRecord(json) || !isRecord(json.query)) return undefined
  const pages = json.query.pages
  // formatversion=2 gives a list, the older format an object keyed by page number.
  const list: unknown[] = Array.isArray(pages) ? pages : isRecord(pages) ? Object.values(pages) : []
  const page = list[0]
  return isRecord(page) ? page : undefined
}

function creditOfMeta(meta: Record<string, unknown>): Credit | undefined {
  const licence = acceptLicence({
    license: plainText(valueOf(meta.License)),
    shortName: plainText(valueOf(meta.LicenseShortName)),
    nonFree: /^(true|1|yes)$/i.test(valueOf(meta.NonFree) ?? ''),
  })
  if (!licence) return undefined
  return { author: cleanAuthor(valueOf(meta.Artist), valueOf(meta.Credit)), licence }
}

/** What the Commons answer says about a file: the author and the accepted licence, or undefined when the licence is not acceptable. */
export function parseCredit(json: unknown): Credit | undefined {
  const page = firstPage(json)
  if (!page || page.missing === true) return undefined
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined
  const meta = isRecord(info) && isRecord(info.extmetadata) ? info.extmetadata : undefined
  return meta ? creditOfMeta(meta) : undefined
}

// ---------- Pictures found on Commons itself ----------

const FILE_INFO =
  'prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=330&iiextmetadatafilter=License|LicenseShortName|Artist|Credit|NonFree&format=json&formatversion=2&origin=*'

/** The pictures in the Commons category of a species ("Category:Parus major"), with their credits, in one question. */
export function commonsCategoryUrl(scientificName: string): string {
  const title = encodeURIComponent(`Category:${scientificName.trim()}`)
  return `https://${COMMONS_HOST}/w/api.php?action=query&generator=categorymembers&gcmtitle=${title}&gcmtype=file&gcmlimit=30&${FILE_INFO}`
}

/** A search for pictures of a species on Commons, with their credits, in one question. */
export function commonsSearchUrl(scientificName: string): string {
  const query = encodeURIComponent(`"${scientificName.trim()}" filetype:bitmap`)
  return `https://${COMMONS_HOST}/w/api.php?action=query&generator=search&gsrsearch=${query}&gsrnamespace=6&gsrlimit=20&${FILE_INFO}`
}

export interface CommonsPhoto {
  thumbnailUrl: string
  file: CommonsFile
  credit: Credit
}

/** Pictures that are not photos of a living bird: eggs, maps, sounds, skulls, museum specimens, drawings. */
const NOT_A_BIRD_PHOTO = /\b(eggs?|maps?|range|distribution|skull|skeleton|sound|song|calls?|spectrogram|nests?|feathers?|footprints?|tracks?|stamps?|coins?|logos?|flags?|drawings?|illustrations?|plates?|painting|specimens?|museum|taxidermy|chicks?|pellets?|cover|diagram)\b/i

/** Reads the answer of commonsCategoryUrl or commonsSearchUrl: the usable photos (accepted licence, a real photo), best first. */
export function parseCommonsFiles(json: unknown): CommonsPhoto[] {
  if (!isRecord(json) || !isRecord(json.query)) return []
  const pages = json.query.pages
  const list: unknown[] = Array.isArray(pages) ? pages : isRecord(pages) ? Object.values(pages) : []
  const found: Array<CommonsPhoto & { order: number }> = []
  list.forEach((page, position) => {
    if (!isRecord(page) || typeof page.title !== 'string') return
    const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined
    if (!isRecord(info) || typeof info.thumburl !== 'string') return
    if (typeof info.mime !== 'string' || !/^image\/(jpeg|png|webp)$/.test(info.mime)) return
    if (NOT_A_BIRD_PHOTO.test(page.title.replace(/^File:/, '').replace(/[_.-]/g, ' '))) return
    const meta = isRecord(info.extmetadata) ? info.extmetadata : undefined
    const credit = meta ? creditOfMeta(meta) : undefined
    const file = fileOfImageUrl(info.thumburl)
    if (!credit || !file) return
    found.push({ thumbnailUrl: info.thumburl, file, credit, order: typeof page.index === 'number' ? page.index : position })
  })
  return found.sort((a, b) => a.order - b.order).map(({ order: _order, ...photo }) => photo)
}
