// Texts of the "Ptáci" screens (the list of every bird you caught and the page of one bird) and of BirdPoints (BP).
// Keep the named export `birds` and `as const`.
//
// Czech names change their ending in a sentence, so a bird's name never sits in the middle of a text here.

export const birds = {
  title: 'Moji ptáci',
  count: {
    one: '{count} pták',
    few: '{count} ptáci',
    many: '{count} ptáků',
  },
  searchLabel: 'Hledat mezi ptáky',
  searchPlaceholder: 'Hledej ptáka…',
  sortGroup: 'Řazení',
  sort: {
    bp: 'BP',
    newest: 'Nejnovější',
    name: 'Název',
    rarity: 'Vzácnost',
  },
  onlySpecies: 'Jen tenhle druh',
  allSpecies: 'Zobrazit všechny',
  none: 'Nic takového nemám',
  noneHint: 'Zkus jiné hledání nebo zobraz všechny ptáky.',
  empty: {
    title: 'V batohu zatím nikdo není',
    text: 'Každý pták, kterého chytíš, tu bude mít své BP. Vyraz ho najít.',
    action: 'Jdu na to',
  },
  loading: 'Otevírám batoh…',
  loadError: 'Ptáky se nepodařilo načíst. Zkus to prosím znovu.',
  card: {
    open: 'Otevřít ptáka',
    sound: 'Zvuk',
  },

  // One bird
  detail: {
    title: 'Detail ptáka',
    notFound: 'Tohohle ptáka v batohu nemám.',
    notFoundHint: 'Možná byl smazaný. Vrať se do batohu.',
    toList: 'Zpět k ptákům',
    position: '{position} z {total}',
    previous: 'Předchozí pták',
    next: 'Další pták',
    aboutSpecies: 'O druhu',
    caughtOn: 'Chycen {date}',
    place: 'Místo',
    noPlace: 'Místo nebylo uloženo',
    openMap: 'Otevřít v mapě',
    way: 'Způsob',
    clip: 'Nahrávka',
    photo: 'Tvoje fotka',
    reference: 'Ukázka',
    note: 'Poznámka',
    notePlaceholder: 'Co se ti na něm líbilo?',
    noteSave: 'Uložit poznámku',
    noteSaved: 'Poznámka je uložená.',
    noteFailed: 'Poznámku se nepodařilo uložit.',
    delete: 'Smazat ptáka',
    deleteTitle: 'Smazat tohohle ptáka?',
    deleteMessage: 'Zmizí i jeho BP a uložená fotka nebo nahrávka. Ostatní ptáci tohoto druhu zůstanou. Tohle už nejde vrátit zpět.',
    deleteConfirm: 'Smazat',
    deleteCancel: 'Ponechat',
    deleted: 'Pták je smazaný.',
    deleteFailed: 'Ptáka se nepodařilo smazat. Zkus to prosím znovu.',
  },

  // BirdPoints
  bp: {
    label: 'BP',
    meterLabel: 'BirdPoints: {bp}, nejméně {min}, nejvíc {max}',
    startLuck: 'Základ {base}, štěstí {luck}',
    breakdown: 'Z čeho se BP vzalo',
    legacy: 'Tenhle úlovek je z doby před BP. BP jsem mu dopočítal dodatečně a čistota rozpoznání je odhad.',
    noBreakdown: 'K tomuhle ptákovi nemám rozpis.',
    factor: {
      confidence: 'Jistota',
      clarity: 'Čistota rozpoznání',
      season: 'Roční doba',
      timeOfDay: 'Denní doba',
      way: 'Způsob chycení',
    },
    factorHint: {
      confidence: 'Jak jistě ho aplikace poznala.',
      clarity: 'Jak moc převyšoval ostatní tipy.',
      season: 'Zda ho chytáš ve správném měsíci.',
      timeOfDay: 'Zda ho chytáš ve správnou hodinu.',
      way: 'Živá kamera má nejvíc, stará fotka z galerie nejméně.',
    },
    caught: 'Tvoje BP',
  },
} as const
