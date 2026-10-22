// Checks on the finding info in public/data/species.json (built by scripts/build-species-info.py). No model files are needed.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSpecies } from '../../src/data/species'
import { isTranslationKey } from '../../src/i18n'
import { monthLevels, seasonText } from '../../src/features/dex/findingInfo'
import type { Species } from '../../src/domain/types'

const raw: unknown = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'species.json'), 'utf8'))
const species = parseSpecies(raw)
const bySci = new Map(species.map((s) => [s.scientificName, s]))
const infoOf = (scientificName: string) => {
  const info = bySci.get(scientificName)?.info
  if (!info) throw new Error(`${scientificName} has no info`)
  return info
}

describe('the finding info of the Dex', () => {
  it('is there for every bird', () => {
    expect(species.filter((s) => !s.info).map((s) => s.scientificName)).toEqual([])
  })

  it('has a Czech text for every group, place, time of day and country it uses', () => {
    for (const s of species) {
      const info = s.info!
      expect(isTranslationKey(`dex.info.tips.${info.tip}`), `${s.scientificName} tip ${info.tip}`).toBe(true)
      expect(isTranslationKey(`dex.info.place.${info.place}`), `${s.scientificName} place ${info.place}`).toBe(true)
      expect(isTranslationKey(`dex.info.dayPart.${info.day}`), `${s.scientificName} day ${info.day}`).toBe(true)
      for (const code of info.countries ?? []) expect(isTranslationKey(`dex.info.country.${code}`), `${s.scientificName} country ${code}`).toBe(true)
    }
  })

  it('gives a country list to the birds that are not in Czechia, and to them only', () => {
    for (const s of species) {
      const countries = s.info!.countries
      if (s.inCzechia) expect(countries, s.scientificName).toBeUndefined()
      else {
        expect(countries?.length, s.scientificName).toBeGreaterThan(0)
        expect(countries!.length, s.scientificName).toBeLessThanOrEqual(10)
        expect(new Set(countries).size, s.scientificName).toBe(countries!.length)
      }
    }
  })

  it('has at least one likely month for every bird', () => {
    for (const s of species) expect(Math.max(...monthLevels(s.info!.months)), s.scientificName).toBeGreaterThanOrEqual(2)
  })

  it('knows the seasons of some well known birds', () => {
    // Swift and cuckoo: summer visitors. Greater white-fronted goose: winter guest. Blackbird and great tit: all year.
    expect(seasonText(infoOf('Apus apus').months)).toMatch(/^od (dubna|května) do (srpna|září)$/)
    expect(monthLevels(infoOf('Apus apus').months).slice(0, 3)).toEqual([0, 0, 0])
    expect(monthLevels(infoOf('Cuculus canorus').months)[0]).toBe(0)
    expect(monthLevels(infoOf('Anser albifrons').months)[6]).toBe(0)
    expect(seasonText(infoOf('Anser albifrons').months)).toContain('října')
    expect(seasonText(infoOf('Turdus merula').months)).toBe('celý rok')
    expect(seasonText(infoOf('Parus major').months)).toBe('celý rok')
  })

  it('gives every bird a range of BirdPoints, with the floors of the rarities', () => {
    const FLOOR = { common: 50, uncommon: 300, rare: 650, epic: 1100, legendary: 1600 }
    for (const s of species) {
      const range = s.info!.bp
      expect(range, s.scientificName).toBeDefined()
      const [min, max] = range!
      expect(min, s.scientificName).toBeGreaterThanOrEqual(0)
      expect(max, s.scientificName).toBeGreaterThan(min)
      expect(min, `${s.scientificName} floor`).toBe(FLOOR[s.rarity])
    }
    expect(infoOf('Anas platyrhynchos').bp).toEqual([50, 750])
  })

  it('puts the nocturnal birds at night or in the twilight, and the others in the day', () => {
    expect(infoOf('Bubo bubo').day).toBe('night')
    expect(infoOf('Strix aluco').day).toBe('night')
    expect(infoOf('Tyto alba').day).toBe('night')
    expect(infoOf('Athene noctua').day).toBe('dusk')
    expect(infoOf('Caprimulgus europaeus').day).toBe('dusk')
    expect(infoOf('Parus major').day).toBe('day')
    const nightBirds = species.filter((s) => s.info!.day === 'night').map((s) => s.family)
    expect(new Set(nightBirds)).toEqual(new Set(['Strigidae', 'Tytonidae']))
  })

  it('knows who lets you come close and who does not', () => {
    expect(infoOf('Anas platyrhynchos').shy).toBe(1)
    expect(infoOf('Columba livia').shy).toBe(1)
    expect(infoOf('Passer domesticus').shy).toBe(1)
    expect(infoOf('Aquila chrysaetos').shy).toBe(3)
    expect(infoOf('Ciconia nigra').shy).toBe(3)
    expect(infoOf('Tetrao urogallus').shy).toBe(3)
    expect(infoOf('Crex crex').shy).toBe(3)
  })

  it('names the countries where the Europe-only birds live', () => {
    expect(infoOf('Fratercula arctica').countries).toEqual(expect.arrayContaining(['NO', 'IS', 'GB']))
    expect(infoOf('Phoenicopterus roseus').countries).toEqual(expect.arrayContaining(['ES', 'IT', 'GR']))
    expect(infoOf('Curruca melanocephala').countries).toEqual(expect.arrayContaining(['ES', 'PT', 'IT', 'GR']))
  })

  it('sets the place of the park birds and of the birds met on Czech ponds', () => {
    expect(infoOf('Pavo cristatus').place).toBe('woods')
    expect(infoOf('Haliaeetus albicilla').place).toBe('water')
    expect(infoOf('Larus argentatus').place).toBe('water')
    expect(infoOf('Cinclus cinclus').place).toBe('river')
  })
})

describe('reading the info from the file', () => {
  const base = (patch: object): unknown[] => [
    {
      id: 'parus-major',
      dexNumber: 1,
      scientificName: 'Parus major',
      czechName: 'Sýkora koňadra',
      englishName: 'Great Tit',
      family: 'Paridae',
      inCzechia: true,
      inEurope: true,
      rarity: 'common',
      birdnetIndex: 1,
      wingclipIndex: 1,
      wikiTitle: 'Great tit',
      ...patch,
    },
  ]
  const goodInfo = { months: '333333333333', place: 'woods', shy: 1, day: 'day', tip: 'smallwoods' }

  it('keeps a good info', () => {
    expect(parseSpecies(base({ info: goodInfo }))[0]!.info).toEqual(goodInfo)
  })

  it('keeps the countries, and drops what is not a country code', () => {
    const [bird] = parseSpecies(base({ info: { ...goodInfo, countries: ['ES', 3, 'PT'] } })) as [Species]
    expect(bird.info?.countries).toEqual(['ES', 'PT'])
  })

  it('works without an info (a Dex file from before it existed)', () => {
    const [bird] = parseSpecies(base({})) as [Species]
    expect(bird.info).toBeUndefined()
    expect('info' in bird).toBe(false)
  })

  it('drops a broken info and keeps the bird', () => {
    for (const info of [{ ...goodInfo, months: '33' }, { ...goodInfo, months: '33333333333x' }, { ...goodInfo, place: 'moon' }, { ...goodInfo, shy: 4 }, { ...goodInfo, day: 'noon' }, 'text', null, 42]) {
      const [bird] = parseSpecies(base({ info })) as [Species]
      expect(bird.id).toBe('parus-major')
      expect(bird.info, JSON.stringify(info)).toBeUndefined()
    }
  })
})
