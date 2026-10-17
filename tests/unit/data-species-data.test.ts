// Checks on the real data file public/data/species.json (built by scripts/build-species.py) against the BirdNET label
// files in data/. No model files are needed: everything here runs on committed files.

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Species } from '../../src/domain/types'
import { familyNameCs } from '../../src/data/families'
import {
  RARITIES,
  filterByRegion,
  getSpeciesById,
  parseSpecies,
  searchSpecies,
  speciesByBirdnetIndex,
  speciesByWingclipIndex,
} from '../../src/data/species'

const root = process.cwd()
const dataFile = join(root, 'public', 'data', 'species.json')
const species: Species[] = parseSpecies(JSON.parse(readFileSync(dataFile, 'utf8')))
// labels_en.txt has no final newline and labels_cs.txt has one, so drop an empty last element.
const lines = (file: string) => readFileSync(join(root, 'data', 'birdnet-v2.4', file), 'utf8').replace(/\n$/, '').split('\n')
const labelsEn = lines('labels_en.txt')
const labelsCs = lines('labels_cs.txt')

const N_BIRDNET = 6522
const N_WINGCLIP_SPECIES = 10994
const bySci = new Map(species.map((s) => [s.scientificName, s]))
const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
// Same as CZECH_NAME_OVERRIDES in scripts/build-species.py: BirdNET's Czech label is older nomenclature, the Dex shows the current name.
const CZECH_NAME_OVERRIDES: Record<string, string> = {
  'Calidris minuta': 'jespáček malý',
  'Calidris temminckii': 'jespáček Temminckův',
  'Larus fuscus': 'racek tmavohřbetý',
  'Cecropis daurica': 'vlaštovka červenořitá',
}

// Same lists as in scripts/build-species.py (the script also stops when one of these is wrong).
const SOUND_CLASSES = ['Dog', 'Engine', 'Environmental', 'Fireworks', 'Gun', 'Human non-vocal', 'Human vocal', 'Human whistle', 'Noise', 'Power tools', 'Siren']
const NON_BIRD_GENERA = new Set(
  `Acris Allonemobius Alouatta Amblycorypha Anaxipha Anaxyrus Apis Atlanticus Canis Conocephalus Cyrtoxipha Dryophytes Eleutherodactylus
   Eunemobius Gastrophryne Gryllus Hyliola Incilius Lithobates Microcentrum Miogryllus Neoconocephalus Neonemobius Odocoileus Oecanthus
   Orchelimum Orocharis Phyllopalpus Pseudacris Pterophylla Scaphiopus Sciurus Scudderia Spea Tamias Tamiasciurus`.split(/\s+/),
)

describe('the file', () => {
  it('is compact: one bird per line and well under 200 KiB', () => {
    expect(statSync(dataFile).size).toBeLessThan(200 * 1024)
    const text = readFileSync(dataFile, 'utf8')
    expect(text.split('\n').length).toBe(species.length + 3) // "[", one line per bird, "]", and the empty line after the final newline
    expect(text.startsWith('[\n{"id":')).toBe(true)
  })

  it('has hundreds of European birds and a Czech subset that is also European', () => {
    expect(species.length).toBeGreaterThanOrEqual(400)
    expect(species.length).toBeLessThanOrEqual(700)
    const czech = filterByRegion(species, 'czechia')
    expect(czech.length).toBeGreaterThanOrEqual(250)
    expect(czech.length).toBeLessThanOrEqual(420)
    expect(species.every((s) => s.inEurope)).toBe(true)
    expect(czech.every((s) => s.inEurope)).toBe(true)
    expect(filterByRegion(species, 'europe')).toHaveLength(species.length)
  })

  it('has unique ids that are the scientific name in lower case with dashes', () => {
    expect(new Set(species.map((s) => s.id)).size).toBe(species.length)
    for (const s of species) expect(s.id).toBe(s.scientificName.toLowerCase().replace(/ /g, '-'))
    for (const s of species) expect(s.id).toMatch(/^[a-z]+(-[a-z]+)+$/)
  })

  it('numbers the birds 1 to N in taxonomic order', () => {
    expect(species.map((s) => s.dexNumber)).toEqual(species.map((_, i) => i + 1))
    // eBird order: waterfowl first, then game birds, pigeons ... and the buntings last.
    expect(species[0].family).toBe('Anatidae')
    expect(species[species.length - 1].family).toBe('Emberizidae')
    expect(bySci.get('Anser anser')!.dexNumber).toBeLessThan(bySci.get('Parus major')!.dexNumber)
    expect(bySci.get('Buteo buteo')!.dexNumber).toBeLessThan(bySci.get('Strix aluco')!.dexNumber)
    expect(bySci.get('Strix aluco')!.dexNumber).toBeLessThan(bySci.get('Corvus corax')!.dexNumber)
  })

  it('keeps every family together', () => {
    const closed = new Set<string>()
    let current: string | null = null
    for (const s of species) {
      expect(s.family, `${s.id} has a family`).not.toBeNull()
      if (s.family !== current) {
        expect(closed.has(s.family as string), `${s.family} is split into two blocks`).toBe(false)
        if (current !== null) closed.add(current)
        current = s.family
      }
    }
    expect(closed.size).toBeGreaterThan(50)
  })

  it('has real values everywhere', () => {
    for (const s of species) {
      expect(RARITIES).toContain(s.rarity)
      expect(typeof s.inCzechia).toBe('boolean')
      expect(s.englishName.length).toBeGreaterThan(2)
      expect(s.wikiTitle, s.id).toBeTruthy()
      expect(s.family, s.id).toMatch(/^[A-Z][a-z]+idae$/)
    }
  })
})

describe('BirdNET', () => {
  it('has a label file of 6522 lines in both languages', () => {
    expect(labelsEn).toHaveLength(N_BIRDNET)
    expect(labelsCs).toHaveLength(N_BIRDNET)
  })

  it('points every bird at its own label', () => {
    for (const s of species) {
      expect(Number.isInteger(s.birdnetIndex)).toBe(true)
      expect(s.birdnetIndex).toBeGreaterThanOrEqual(0)
      expect(s.birdnetIndex).toBeLessThan(N_BIRDNET)
      expect(labelsEn[s.birdnetIndex], s.id).toBe(`${s.scientificName}_${s.englishName}`)
      expect(labelsCs[s.birdnetIndex].startsWith(`${s.scientificName}_`), s.id).toBe(true)
    }
    expect(new Set(species.map((s) => s.birdnetIndex)).size).toBe(species.length)
    expect(speciesByBirdnetIndex(species).size).toBe(species.length)
    expect(speciesByBirdnetIndex(species).get(labelsEn.indexOf('Parus major_Great Tit'))).toBe(bySci.get('Parus major'))
  })

  it('contains no sound class, frog, mammal or insect', () => {
    for (const s of species) {
      expect(SOUND_CLASSES).not.toContain(s.scientificName)
      expect(NON_BIRD_GENERA.has(s.scientificName.split(' ')[0]), s.id).toBe(false)
      expect(s.scientificName.split(' ')).toHaveLength(2) // a species name, not a sound class
    }
    for (const name of [...SOUND_CLASSES, 'Canis lupus', 'Pseudacris crucifer', 'Apis mellifera', 'Gryllus pennsylvanicus', 'Lithobates catesbeianus']) {
      expect(bySci.has(name), name).toBe(false)
    }
  })

  it('uses the Czech label where BirdNET has one, with a capital letter, and nothing where it only has English', () => {
    for (const s of species) {
      const czech = labelsCs[s.birdnetIndex].slice(s.scientificName.length + 1)
      const override = CZECH_NAME_OVERRIDES[s.scientificName]
      expect(s.czechName, s.id).toBe(override ? upperFirst(override) : czech === s.englishName ? null : upperFirst(czech))
    }
  })

  it('corrects the Czech names where BirdNET follows older nomenclature (the sandpiper pair, the Lesser Black-backed Gull, the Red-rumped Swallow)', () => {
    expect(bySci.get('Calidris minuta')?.czechName).toBe('Jespáček malý')
    expect(bySci.get('Calidris temminckii')?.czechName).toBe('Jespáček Temminckův')
    expect(bySci.get('Larus fuscus')?.czechName).toBe('Racek tmavohřbetý')
    expect(bySci.get('Cecropis daurica')?.czechName).toBe('Vlaštovka červenořitá')
    for (const sci of Object.keys(CZECH_NAME_OVERRIDES)) expect(labelsCs.some((line) => line.startsWith(`${sci}_`)), sci).toBe(true)
  })

  it('has a Czech name for at least 95 percent of the birds', () => {
    const named = species.filter((s) => s.czechName !== null).length
    expect(named / species.length).toBeGreaterThanOrEqual(0.95)
    expect(new Set(species.map((s) => s.czechName).filter(Boolean)).size).toBe(named)
    for (const s of species) if (s.czechName) expect(s.czechName).toMatch(/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]+( [A-Za-záčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ-]+)*$/)
  })

  it('has the usual Czech names for the usual birds', () => {
    const names: Record<string, string> = {
      'Parus major': 'Sýkora koňadra', 'Turdus merula': 'Kos černý', 'Erithacus rubecula': 'Červenka obecná', 'Passer domesticus': 'Vrabec domácí',
      'Ciconia ciconia': 'Čáp bílý', 'Strix aluco': 'Puštík obecný', 'Corvus corax': 'Krkavec velký', 'Crex crex': 'Chřástal polní',
    }
    for (const [sci, czech] of Object.entries(names)) expect(bySci.get(sci)?.czechName).toBe(czech)
  })
})

describe('WingCLIP', () => {
  it('points at rows of the 10994-species classifier, one bird per row', () => {
    const rows = species.map((s) => s.wingclipIndex).filter((row): row is number => row !== null)
    for (const row of rows) {
      expect(Number.isInteger(row)).toBe(true)
      expect(row).toBeGreaterThanOrEqual(0)
      expect(row).toBeLessThan(N_WINGCLIP_SPECIES) // row 10994 is the bird / not-bird probe, never a species
    }
    expect(new Set(rows).size).toBe(rows.length)
    expect(speciesByWingclipIndex(species).size).toBe(rows.length)
  })

  it('knows almost every bird (the lumped redpolls have no row of their own)', () => {
    const without = species.filter((s) => s.wingclipIndex === null).map((s) => s.scientificName)
    expect(without.sort()).toEqual(['Acanthis cabaret', 'Acanthis hornemanni'])
  })

  it('keeps the rows it was checked against by hand', () => {
    // Row numbers from the WingDex taxonomy (src/lib/taxonomy.json at commit b0dda4b7).
    const rows: Record<string, number> = { 'Parus major': 7082, 'Turdus merula': 8835, 'Erithacus rubecula': 9062, 'Passer domesticus': 9801, 'Cecropis daurica': 7608, 'Accipiter gentilis': 2792 }
    for (const [sci, row] of Object.entries(rows)) expect(bySci.get(sci)?.wingclipIndex, sci).toBe(row)
  })
})

describe('rarity', () => {
  const czech = species.filter((s) => s.inCzechia)
  const europeOnly = species.filter((s) => !s.inCzechia)
  const count = (list: Species[], rarity: string) => list.filter((s) => s.rarity === rarity).length

  it('makes Europe-only birds epic or legendary', () => {
    expect(europeOnly.length).toBeGreaterThan(50)
    for (const s of europeOnly) expect(['epic', 'legendary'], s.id).toContain(s.rarity)
    expect(count(europeOnly, 'epic')).toBeGreaterThan(20)
    expect(count(europeOnly, 'legendary')).toBeGreaterThan(20)
  })

  it('puts the birds of ponds, reed beds and the canopy above the garden birds only where a garden birder would say so', () => {
    // RARITY_OVERRIDES in scripts/build-species.py: the reporting frequency alone put these in "common" ...
    for (const sci of ['Mergus merganser', 'Larus cachinnans', 'Circus aeruginosus', 'Ardea alba', 'Coccothraustes coccothraustes', 'Acrocephalus arundinaceus', 'Acrocephalus palustris', 'Oriolus oriolus']) {
      expect(bySci.get(sci)?.rarity, sci).toBe('uncommon')
    }
    // ... and these, which a garden birder meets all the time, in "uncommon"
    for (const sci of ['Prunella modularis', 'Certhia familiaris', 'Certhia brachydactyla', 'Turdus viscivorus']) {
      expect(bySci.get(sci)?.rarity, sci).toBe('common')
    }
  })

  it('spreads the Czech birds over all tiers, mostly reachable ones', () => {
    for (const rarity of RARITIES) expect(count(czech, rarity), rarity).toBeGreaterThan(0)
    const reachable = count(czech, 'common') + count(czech, 'uncommon') + count(czech, 'rare')
    expect(reachable / czech.length).toBeGreaterThan(0.7)
    expect(count(czech, 'common')).toBeGreaterThanOrEqual(50)
    expect(count(czech, 'common')).toBeLessThanOrEqual(120)
    expect(count(czech, 'legendary')).toBeLessThanOrEqual(25)
  })
})

describe('families', () => {
  it('have Czech names, except the few that have no common one', () => {
    const families = [...new Set(species.map((s) => s.family as string))]
    expect(families.filter((family) => familyNameCs(family) === null).sort()).toEqual(['Calcariidae', 'Leiothrichidae', 'Psittaculidae'])
    for (const family of families) {
      const czech = familyNameCs(family)
      if (czech !== null) expect(czech, family).toMatch(/^[a-zéěíóúůýáčďňřšťž]+ovití$/)
    }
    expect(familyNameCs('Paridae')).toBe('sýkorovití')
    expect(familyNameCs(null)).toBeNull()
    expect(familyNameCs('Nonexistidae')).toBeNull()
  })
})

describe('sentinel birds', () => {
  const gardenBirds = [
    'Parus major', 'Cyanistes caeruleus', 'Turdus merula', 'Erithacus rubecula', 'Passer domesticus', 'Passer montanus', 'Fringilla coelebs',
    'Carduelis carduelis', 'Chloris chloris', 'Columba palumbus', 'Streptopelia decaocto', 'Pica pica', 'Corvus cornix', 'Sturnus vulgaris',
    'Motacilla alba', 'Phoenicurus ochruros', 'Sitta europaea', 'Dendrocopos major', 'Troglodytes troglodytes', 'Phylloscopus collybita',
    'Sylvia atricapilla', 'Hirundo rustica', 'Apus apus', 'Anas platyrhynchos', 'Buteo buteo', 'Falco tinnunculus', 'Garrulus glandarius',
  ]

  it('has the garden birds of Czechia, all common', () => {
    for (const sci of gardenBirds) {
      const s = bySci.get(sci)
      expect(s?.inCzechia, sci).toBe(true)
      expect(s?.rarity, sci).toBe('common')
    }
  })

  it('has raptors, owls, waders, ducks and woodland birds in Czechia', () => {
    const inCzechia = [
      'Accipiter nisus', 'Milvus milvus', 'Haliaeetus albicilla', 'Pandion haliaetus', 'Falco peregrinus', 'Circus aeruginosus',
      'Strix aluco', 'Asio otus', 'Strix uralensis', 'Athene noctua', 'Bubo bubo', 'Glaucidium passerinum', 'Tyto alba',
      'Vanellus vanellus', 'Actitis hypoleucos', 'Tringa ochropus', 'Calidris pugnax', 'Gallinago gallinago', 'Numenius arquata',
      'Aythya fuligula', 'Anas crecca', 'Mareca penelope', 'Spatula clypeata', 'Bucephala clangula', 'Mergus merganser', 'Mergellus albellus',
      'Upupa epops', 'Alcedo atthis', 'Merops apiaster', 'Grus grus', 'Ciconia nigra', 'Tetrao urogallus', 'Lyrurus tetrix', 'Crex crex',
      'Nucifraga caryocatactes', 'Cinclus cinclus', 'Corvus corax', 'Panurus biarmicus', 'Luscinia megarhynchos', 'Cuculus canorus',
    ]
    for (const sci of inCzechia) expect(bySci.get(sci)?.inCzechia, sci).toBe(true)
  })

  it('has Mediterranean, Atlantic and Arctic birds in Europe but not in Czechia', () => {
    const europeOnly = [
      'Curruca melanocephala', 'Curruca undata', 'Ichthyaetus audouinii', 'Sturnus unicolor', 'Cyanopica cooki', 'Aquila adalberti',
      'Fratercula arctica', 'Alca torda', 'Bubo scandiacus', 'Falco rusticolus', 'Somateria spectabilis', 'Perisoreus infaustus',
      'Pinicola enucleator', 'Lagopus muta', 'Uria lomvia', 'Oenanthe leucura', 'Sitta whiteheadi', 'Pterocles alchata', 'Chersophilus duponti',
    ]
    for (const sci of europeOnly) {
      const s = bySci.get(sci)
      expect(s?.inEurope, sci).toBe(true)
      expect(s?.inCzechia, sci).toBe(false)
      expect(['epic', 'legendary'], sci).toContain(s?.rarity)
    }
  })

  it('leaves out American and Asian vagrants, tropical birds and everything that is not a bird', () => {
    const out = [
      'Setophaga striata', 'Setophaga coronata', 'Setophaga petechia', 'Cyanocitta cristata', 'Turdus migratorius', 'Cardinalis cardinalis',
      'Poecile atricapillus', 'Zonotrichia leucophrys', 'Haemorhous mexicanus', 'Calypte anna', 'Ramphastos toco', 'Phoenicurus moussieri',
      'Dog', 'Human vocal', 'Siren', 'Engine',
    ]
    for (const sci of out) expect(bySci.has(sci), sci).toBe(false)
  })

  it('has the three birds the fake engines talk about', () => {
    for (const id of ['parus-major', 'erithacus-rubecula', 'turdus-merula']) expect(getSpeciesById(id, species), id).toBeDefined()
  })
})

describe('searching the real list', () => {
  it('finds the great tit in all three languages and without accents', () => {
    for (const query of ['sykora konadra', 'Sýkora', 'great tit', 'parus major', 'KOŇADRA']) {
      expect(searchSpecies(species, query).map((s) => s.id), query).toContain('parus-major')
    }
    expect(searchSpecies(species, 'sykora konadra')[0].id).toBe('parus-major')
    expect(searchSpecies(species, 'blackbird')[0].id).toBe('turdus-merula')
    expect(searchSpecies(species, 'kos cerny')[0].id).toBe('turdus-merula')
  })
})
