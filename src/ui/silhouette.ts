// Which bird outline to draw for a species, and the outline of the generic songbird (also used by the "bird" icon).
// Pure logic and path data only; the drawing lives in SpeciesSilhouette.tsx.

export type SilhouetteShape = 'songbird' | 'duck' | 'owl' | 'raptor' | 'wader'

export const SILHOUETTE_SHAPES: readonly SilhouetteShape[] = ['songbird', 'duck', 'owl', 'raptor', 'wader']

/** The generic songbird on a 64 x 64 grid, facing right. */
export const SONGBIRD_PATH =
  'M59 23.5 L51 19.8 C50.2 14.6 46.2 11 41.5 11 C36.3 11 32.6 14.4 29 19.6 C25 26 19.5 30.5 15.6 37 L3.5 55.5 L7.8 58.2 L21.8 47.2 C27 51.5 36 52.8 43.5 47.4 C49.5 43 52.2 36.2 51.4 29 L51.2 25.8 Z'

// Latin family names first, then English and Czech words, so it works with whatever the species data carries.
const PATTERNS: ReadonlyArray<readonly [SilhouetteShape, RegExp]> = [
  ['owl', /strigidae|tytonidae|\bowls?\b|sovy|sovovit|puštík|kalous|výr\b/i],
  [
    'raptor',
    /accipitridae|falconidae|pandionidae|\b(hawks?|eagles?|falcons?|kites?|harriers?|vultures?|osprey|buzzards?)\b|jestřáb|jestřábovit|sokolovit|orlovit|orlovec|luňák|káně|moták/i,
  ],
  [
    'duck',
    /anatidae|podicipedidae|gaviidae|rallidae|phalacrocoracidae|laridae|sternidae|alcidae|stercorariidae|\b(ducks?|geese|swans?|grebes?|divers?|loons?|coots?|rails?|cormorants?|gulls?|terns?|auks?|skuas?)\b|kachn|husa|labut|potápk|potáplic|chřástal|kormorán|racek|rackovit|rybák|alkovit/i,
  ],
  [
    'wader',
    /ardeidae|ciconiidae|gruidae|scolopacidae|charadriidae|recurvirostridae|threskiornithidae|phoenicopteridae|haematopodidae|burhinidae|glareolidae|\b(herons?|egrets?|bitterns?|storks?|cranes?|sandpipers?|plovers?|waders?|avocets?|ibises|spoonbills?|flamingos?|curlews?|snipes?)\b|volavk|čápovit|jeřáb|slukovit|kulík|tenkozob|ibisovit|plameňák|ústřičník/i,
  ],
]

/** Picks the outline for a bird family. Unknown or missing families get the generic songbird (most European birds are one). */
export function silhouetteShapeFor(family: string | null | undefined): SilhouetteShape {
  if (!family) return 'songbird'
  for (const [shape, pattern] of PATTERNS) if (pattern.test(family)) return shape
  return 'songbird'
}
