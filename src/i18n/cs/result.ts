// Texts of the result screen (top guesses, catch button, confirmation, success). The scan task owns this file and may extend it.
// Keep the named export `result` and `as const`.
//
// Czech names change their ending in a sentence, so the name never sits inside one: it gets its own line (or is the subject).

export const result = {
  title: 'Výsledek',
  topGuesses: 'Nejlepší tipy',
  weakGuesses: 'Moje tipy, zatím nejisté',
  noPending: 'Zatím není co ukázat. Nejdřív něco naskenuj.',
  scanAgain: 'Skenovat znovu',
  catch: 'Chytit',
  discard: 'Zahodit',
  tooLow: 'Tohle zatím nestačí. Zkus to blíž nebo ještě jednou.',
  confirmTitle: 'Přidat do Dexu?',
  confirmText: 'Uložím ho do tvého Dexu i s místem a záznamem.',
  caught: 'Máš ho! {name} je v Dexu.',
  alreadyCaught: 'Tenhle už v Dexu je.',
  speciesError: 'Seznam ptáků se nepodařilo načíst. Zkontroluj připojení a zkus to znovu.',
  saveFailed: 'Uložení se nepovedlo. Nic se neztratilo, zkus to ještě jednou.',

  // The date, place and picture or clip that will be saved with the catch
  meta: {
    title: 'Co se uloží',
    when: 'Kdy',
    where: 'Kde',
    unknownPlace: 'Místo neznámé',
    noLocation: 'Místo neznám (poloha není povolená, nebo ho fotka neobsahuje), takže ptáka uložím bez místa.',
    coordinates: '{lat}, {lon}',
    north: 'S',
    south: 'J',
    east: 'V',
    west: 'Z',
    photoAlt: 'Fotka, která se uloží',
    clipLabel: 'Záznam, který se uloží',
  },

  // One guess
  card: {
    newSpecies: 'Nový druh',
    inDex: 'Už v Dexu',
    inDexCount: 'Už v Dexu ({count}×)',
    photoCredit: 'Foto: {author}, {licence}',
    photoCreditNoAuthor: 'Foto: {licence}',
  },

  // Why the Catch button is off for a guess
  reason: {
    lowConfidence: 'Zatím to není dost jisté. Potřebuju aspoň {needed}.',
    unclear: 'Příliš podobné jinému druhu. Zkus to ještě jednou, třeba z jiného úhlu.',
    notBird: 'Ptáka nevidím dost zřetelně. Zkus ho vyfotit blíž a v lepším světle.',
    outsideDex: 'Tohle může být pták, kterého v Dexu nemám. Zkus to ještě jednou, třeba z jiného úhlu.',
  },

  // Nothing sure enough to catch
  nothing: {
    title: 'Nic jistého',
    text: 'Tentokrát mi žádný pták nevyšel dost spolehlivě. To se stává, zkus to znovu.',
    empty: 'Tentokrát se mi nepodařilo nic poznat. To se stává, zkus to znovu.',
    tipsTitle: 'Co pomůže',
    tipSound1: 'Přibliž se k ptákovi, nejlépe na pár kroků.',
    tipSound2: 'Počkej na chvilku ticha, bez aut, větru a hlasů.',
    tipSound3: 'Poslouchej aspoň deset sekund.',
    tipPhoto1: 'Vyfoť ptáka blíž, aby vyplnil větší část záběru.',
    tipPhoto2: 'Fotku ořízni jen na ptáka.',
    tipPhoto3: 'Zkus ostřejší snímek při dobrém světle.',
    tipLive1: 'Přibliž se a drž telefon klidně.',
    tipLive2: 'Počkej, až pták nebude schovaný za větvemi.',
    tipLive3: 'Dobré světlo hodně pomáhá.',
    retry: 'Zkusit znovu',
    settings: 'Citlivost rozpoznávání změníš v\u00A0Nastavení.',
  },

  // The question before the bird goes into the Dex
  confirm: {
    withPhoto: 'Uložím ho i s datem, místem a fotkou.',
    withSound: 'Uložím ho i s datem, místem a nahrávkou.',
    withoutMedia: 'Uložím ho i s datem a místem.',
    button: 'Chytit',
    cancel: 'Ještě ne',
  },

  // After the catch
  success: {
    newSpecies: 'Nový druh v tvém Dexu!',
    again: 'Další úlovek tohoto druhu.',
    toDex: 'Zobrazit v Dexu',
    scanNext: 'Skenovat dál',
    celebration: 'Oslava chycení',
  },
} as const
