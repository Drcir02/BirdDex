// Which Wikimedia Commons licences the app may show: CC0, public domain, CC BY and CC BY-SA, in any version.
// Everything else (non-commercial, no-derivatives, GFDL on its own, fair use, unknown) is refused, so the app never
// displays a picture it may not show. The rules work on the `extmetadata` fields that the Commons API returns.

export type LicenceKind = 'cc0' | 'public-domain' | 'cc-by' | 'cc-by-sa'

export interface LicenceMeta {
  /** Commons "License": a machine tag such as "cc-by-sa-4.0", "cc-zero" or "pd". */
  license?: string
  /** Commons "LicenseShortName": for example "CC BY-SA 4.0". */
  shortName?: string
  /** True when Commons marks the file as non-free (fair use). */
  nonFree?: boolean
}

export interface AcceptedLicence {
  kind: LicenceKind
  /** What the screen shows next to the author: "CC BY-SA 4.0", "CC0" or "Public domain". */
  name: string
}

/** Lower case, with every run of other characters turned into one dash: "CC BY-SA 4.0" becomes "cc-by-sa-4-0". */
function normalise(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

type Verdict = LicenceKind | 'refused' | undefined

function classify(tag: string): Verdict {
  if (tag === '') return undefined
  // Non-commercial and no-derivatives licences are never fine, wherever the letters sit in the name.
  if (/(^|-)(nc|nd)(-|$)/.test(tag)) return 'refused'
  if (/^cc-?0(-|$)|^cc-?zero(-|$)/.test(tag)) return 'cc0'
  if (/^pd(-|$)|^public-domain(-|$)|^pdm(-|$)/.test(tag)) return 'public-domain'
  if (/^cc-by-sa(-|$)/.test(tag)) return 'cc-by-sa'
  if (/^cc-by(-|$)/.test(tag)) return 'cc-by'
  return undefined
}

/** The licence name to display, taken from Commons when it is there, otherwise built from the kind and the tag. */
function displayName(kind: LicenceKind, meta: LicenceMeta): string {
  if (kind === 'public-domain') return 'Public domain'
  if (kind === 'cc0') return 'CC0'
  const short = (meta.shortName ?? '').replace(/\s+/g, ' ').trim()
  if (/^cc[ -]by/i.test(short)) return short.toUpperCase()
  // "cc-by-sa-4.0" -> "CC BY-SA 4.0"
  const parts = (meta.license ?? '').toLowerCase().split('-').filter(Boolean)
  const version = parts.find((part) => /^\d/.test(part))
  const rest = parts.filter((part) => part !== 'cc' && part !== version)
  const base = `CC ${rest.map((part) => part.toUpperCase()).join('-')}`
  return version ? `${base} ${version}` : base
}

/** Returns the licence when the app may show the picture, and undefined when it must not. */
export function acceptLicence(meta: LicenceMeta): AcceptedLicence | undefined {
  if (meta.nonFree) return undefined
  const verdicts = [classify(normalise(meta.license)), classify(normalise(meta.shortName))]
  if (verdicts.includes('refused')) return undefined
  const kind = verdicts.find((verdict): verdict is LicenceKind => verdict !== undefined && verdict !== 'refused')
  return kind ? { kind, name: displayName(kind, meta) } : undefined
}

// ---------- Credit text ----------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  copy: '©',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

/** Commons returns the author and the licence as small HTML fragments. This keeps the text only. */
export function plainText(html: string | undefined): string {
  if (!html) return ''
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

const MAX_AUTHOR_LENGTH = 90

/**
 * The author for the credit line. Returns an empty string when nobody is named, so the screen can say "unknown author"
 * in Czech. Very long entries (several lines of attribution) are cut at a word.
 */
export function cleanAuthor(artistHtml: string | undefined, creditHtml?: string): string {
  let author = plainText(artistHtml) || plainText(creditHtml)
  author = author.replace(/^(photo|photograph|image|picture)( by| ©|:)\s*/i, '').trim()
  if (/^(unknown|anonymous|uncredited|not specified|n\/a)( author| photographer)?\.?$/i.test(author)) return ''
  if (author.length > MAX_AUTHOR_LENGTH) {
    const cut = author.slice(0, MAX_AUTHOR_LENGTH)
    author = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), MAX_AUTHOR_LENGTH / 2)).trim()}…`
  }
  return author
}
