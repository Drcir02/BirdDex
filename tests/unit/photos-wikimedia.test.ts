import { describe, expect, it } from 'vitest'
import { acceptLicence, cleanAuthor, plainText } from '../../src/features/photos/licences'
import {
  creditUrl,
  fileOfImageUrl,
  filePageUrl,
  parseCredit,
  parseSummary,
  summaryUrl,
  thumbnailAtWidth,
} from '../../src/features/photos/wikimedia'

describe('acceptLicence', () => {
  it.each([
    [{ license: 'cc-by-sa-4.0', shortName: 'CC BY-SA 4.0' }, 'cc-by-sa', 'CC BY-SA 4.0'],
    [{ license: 'cc-by-sa-3.0-de', shortName: 'CC BY-SA 3.0 de' }, 'cc-by-sa', 'CC BY-SA 3.0 DE'],
    [{ license: 'cc-by-2.0', shortName: 'CC BY 2.0' }, 'cc-by', 'CC BY 2.0'],
    [{ license: 'cc-by-4.0' }, 'cc-by', 'CC BY 4.0'],
    [{ license: 'cc-by-sa-2.5' }, 'cc-by-sa', 'CC BY-SA 2.5'],
    [{ license: 'cc-zero', shortName: 'CC0' }, 'cc0', 'CC0'],
    [{ shortName: 'CC0 1.0' }, 'cc0', 'CC0'],
    [{ license: 'pd', shortName: 'Public domain' }, 'public-domain', 'Public domain'],
    [{ shortName: 'PD-old-70' }, 'public-domain', 'Public domain'],
    [{ shortName: 'PD US Government' }, 'public-domain', 'Public domain'],
    [{ shortName: 'PDM 1.0' }, 'public-domain', 'Public domain'],
  ])('accepts %j', (meta, kind, name) => {
    expect(acceptLicence(meta)).toEqual({ kind, name })
  })

  it.each([
    [{ license: 'cc-by-nc-sa-3.0', shortName: 'CC BY-NC-SA 3.0' }],
    [{ license: 'cc-by-nc-2.0' }],
    [{ shortName: 'CC BY-NC 4.0' }],
    [{ license: 'cc-by-nd-2.0' }],
    [{ shortName: 'CC BY-ND 4.0' }],
    [{ license: 'cc-by-nc-nd-4.0' }],
    [{ license: 'gfdl', shortName: 'GFDL 1.2' }],
    [{ shortName: 'Fair use' }],
    [{ shortName: 'Attribution' }],
    [{ shortName: 'Copyrighted free use' }],
    [{ shortName: 'All rights reserved' }],
    [{}],
    [{ license: '', shortName: '' }],
  ])('refuses %j', (meta) => {
    expect(acceptLicence(meta)).toBeUndefined()
  })

  it('refuses a non-free file even if the licence name looks fine', () => {
    expect(acceptLicence({ license: 'cc-by-sa-4.0', nonFree: true })).toBeUndefined()
  })

  it('refuses when one of the two fields names a forbidden licence', () => {
    expect(acceptLicence({ license: 'cc-by-4.0', shortName: 'CC BY-NC 4.0' })).toBeUndefined()
  })
})

describe('credit text', () => {
  it('keeps the text of a Commons HTML fragment and decodes entities', () => {
    expect(plainText('<a href="//commons.wikimedia.org/wiki/User:Foo" title="User:Foo">Foo &amp; Bar</a>')).toBe('Foo & Bar')
    expect(plainText('Ren&#233; Dupont &#x26; Co&nbsp;Ltd')).toBe('René Dupont & Co Ltd')
    expect(plainText('<span>  two   words </span>')).toBe('two words')
    expect(plainText(undefined)).toBe('')
  })

  it('gives the author, or an empty string when nobody is named', () => {
    expect(cleanAuthor('<a href="x">Jan Novák</a>')).toBe('Jan Novák')
    expect(cleanAuthor('', '<b>Photo by Eva Svobodová</b>')).toBe('Eva Svobodová')
    expect(cleanAuthor('Unknown author')).toBe('')
    expect(cleanAuthor('Anonymous')).toBe('')
    expect(cleanAuthor(undefined)).toBe('')
  })

  it('cuts a very long attribution at a word', () => {
    const long = `${'Dlouhé jméno '.repeat(20)}`
    const author = cleanAuthor(long)
    expect(author.length).toBeLessThanOrEqual(92)
    expect(author.endsWith('…')).toBe(true)
    expect(author).not.toMatch(/Dlouh…/)
  })
})

describe('summaryUrl', () => {
  it('builds the REST address with underscores and escapes', () => {
    expect(summaryUrl('Great tit')).toBe('https://en.wikipedia.org/api/rest_v1/page/summary/Great_tit')
    expect(summaryUrl("Scopoli's shearwater")).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/Scopoli's_shearwater")
    expect(summaryUrl('Parus major/minor')).toContain('Parus_major%2Fminor')
    expect(summaryUrl('Chiffchaff ')).toBe('https://en.wikipedia.org/api/rest_v1/page/summary/Chiffchaff')
  })
})

describe('parseSummary', () => {
  it('reads the picture addresses and the article', () => {
    expect(
      parseSummary({
        type: 'standard',
        thumbnail: { source: 'https://upload.wikimedia.org/a/330px-x.jpg', width: 330, height: 220 },
        originalimage: { source: 'https://upload.wikimedia.org/a/x.jpg' },
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Great_tit' } },
      }),
    ).toEqual({
      thumbnailUrl: 'https://upload.wikimedia.org/a/330px-x.jpg',
      originalUrl: 'https://upload.wikimedia.org/a/x.jpg',
      pageUrl: 'https://en.wikipedia.org/wiki/Great_tit',
    })
  })

  it('copes with missing pieces and nonsense', () => {
    expect(parseSummary({ type: 'standard' })).toEqual({})
    expect(parseSummary({ thumbnail: { source: '' } })).toEqual({})
    expect(parseSummary({ thumbnail: 7 })).toEqual({})
    expect(parseSummary(null)).toBeUndefined()
    expect(parseSummary('text')).toBeUndefined()
    expect(parseSummary({ type: 'disambiguation', thumbnail: { source: 'https://upload.wikimedia.org/a.jpg' } })).toBeUndefined()
  })
})

describe('fileOfImageUrl and friends', () => {
  const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6c/Kingfisher_%28Alcedo_atthis%29_2.jpg/330px-Kingfisher_%28Alcedo_atthis%29_2.jpg'
  const original = 'https://upload.wikimedia.org/wikipedia/commons/6/6c/Kingfisher_%28Alcedo_atthis%29_2.jpg'

  it('finds the file behind a thumbnail and behind an original', () => {
    expect(fileOfImageUrl(thumb)).toEqual({ host: 'commons.wikimedia.org', name: 'Kingfisher (Alcedo atthis) 2.jpg' })
    expect(fileOfImageUrl(original)).toEqual({ host: 'commons.wikimedia.org', name: 'Kingfisher (Alcedo atthis) 2.jpg' })
  })

  it('finds files that live on English Wikipedia, and files with pages', () => {
    expect(fileOfImageUrl('https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Bird.jpg/250px-Bird.jpg')).toEqual({
      host: 'en.wikipedia.org',
      name: 'Bird.jpg',
    })
    expect(fileOfImageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Plate.tif/lossy-page1-330px-Plate.tif.jpg')?.name).toBe('Plate.tif')
  })

  it('decodes non-ASCII names', () => {
    expect(fileOfImageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Sýkora_ko%C5%88adra.jpg/330px-x.jpg')?.name).toBe('Sýkora koňadra.jpg')
  })

  it('refuses everything else', () => {
    expect(fileOfImageUrl('https://example.com/wikipedia/commons/a/b/Foo.jpg')).toBeUndefined()
    expect(fileOfImageUrl('https://upload.wikimedia.org/wikipedia/de/a/b/Foo.jpg')).toBeUndefined()
    expect(fileOfImageUrl('https://upload.wikimedia.org/other/commons/a/b/Foo.jpg')).toBeUndefined()
    expect(fileOfImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/b/NoExtension')).toBeUndefined()
    expect(fileOfImageUrl('not a url')).toBeUndefined()
    expect(fileOfImageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/%E0%A4%A.jpg/330px-x.jpg')).toBeUndefined()
  })

  it('builds the file page and the credit question', () => {
    const file = fileOfImageUrl(thumb)!
    expect(filePageUrl(file)).toBe('https://commons.wikimedia.org/wiki/File:Kingfisher_(Alcedo_atthis)_2.jpg')
    const url = new URL(creditUrl(file))
    expect(url.origin).toBe('https://commons.wikimedia.org')
    expect(url.pathname).toBe('/w/api.php')
    expect(url.searchParams.get('titles')).toBe('File:Kingfisher (Alcedo atthis) 2.jpg')
    expect(url.searchParams.get('prop')).toBe('imageinfo')
    expect(url.searchParams.get('iiprop')).toBe('extmetadata')
    expect(url.searchParams.get('origin')).toBe('*')
    expect(url.searchParams.get('format')).toBe('json')
  })

  it('asks the thumbnail for another width', () => {
    expect(thumbnailAtWidth(thumb, 500)).toBe(thumb.replace('/330px-', '/500px-'))
    expect(thumbnailAtWidth('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Plate.tif/lossy-page1-330px-Plate.tif.jpg', 500)).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Plate.tif/lossy-page1-500px-Plate.tif.jpg',
    )
  })

  it('leaves an original or a strange address alone', () => {
    expect(thumbnailAtWidth(original, 500)).toBe(original)
    expect(thumbnailAtWidth('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo.jpg/Foo.jpg', 500)).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo.jpg/Foo.jpg',
    )
  })
})

describe('parseCredit', () => {
  const answer = (meta: Record<string, string>, extra: Record<string, unknown> = {}) => ({
    query: {
      pages: [
        {
          title: 'File:X.jpg',
          imageinfo: [{ extmetadata: Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, { value }])) }],
          ...extra,
        },
      ],
    },
  })

  it('reads author and licence from the extmetadata', () => {
    expect(
      parseCredit(
        answer({
          Artist: '<a href="//commons.wikimedia.org/wiki/User:Foo">Foo</a>',
          LicenseShortName: 'CC BY-SA 4.0',
          License: 'cc-by-sa-4.0',
          NonFree: 'false',
        }),
      ),
    ).toEqual({ author: 'Foo', licence: { kind: 'cc-by-sa', name: 'CC BY-SA 4.0' } })
  })

  it('returns an empty author when none is given', () => {
    expect(parseCredit(answer({ LicenseShortName: 'CC0', License: 'cc-zero' }))).toEqual({ author: '', licence: { kind: 'cc0', name: 'CC0' } })
  })

  it('refuses a licence that is not allowed, a missing page and rubbish', () => {
    expect(parseCredit(answer({ LicenseShortName: 'CC BY-NC 2.0', License: 'cc-by-nc-2.0' }))).toBeUndefined()
    expect(parseCredit(answer({ LicenseShortName: 'CC BY 4.0', NonFree: 'true' }))).toBeUndefined()
    expect(parseCredit(answer({}, { missing: true }))).toBeUndefined()
    expect(parseCredit({ query: { pages: [] } })).toBeUndefined()
    expect(parseCredit({ query: { pages: [{ title: 'File:X.jpg' }] } })).toBeUndefined()
    expect(parseCredit(null)).toBeUndefined()
    expect(parseCredit({})).toBeUndefined()
  })

  it('also understands the older answer format (pages as an object)', () => {
    const legacy = { query: { pages: { '123': { imageinfo: [{ extmetadata: { LicenseShortName: { value: 'CC BY 2.0' }, Artist: { value: 'Eva' } } }] } } } }
    expect(parseCredit(legacy)).toEqual({ author: 'Eva', licence: { kind: 'cc-by', name: 'CC BY 2.0' } })
  })
})
