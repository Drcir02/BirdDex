// Texts of the Dex screens (list and bird detail), the reference photo credits and the hidden demo page.
// The Dex task owns this file and may extend it. Keep the named export `dex` and `as const`.
//
// Czech names change their ending inside a sentence, so a bird's name never sits in the middle of a text here: it is a
// heading, a label of its own, or the subject at the start. The bird itself is always "pták" (masculine), which is why
// "chycený" and "nechycený" stay correct next to any name, however the name's own gender goes.

export const dex = {
  title: 'Ptačí Dex',
  subtitle: 'Sbírka ptáků Česka a Evropy',
  progress: 'Chyceno {caught} z {total}',
  progressLabel: 'Postup sbírkou',
  // A cheering line under the progress, from "nothing yet" to "everything".
  progressNote: {
    none: 'Pojď na první lov!',
    start: 'Dobrý začátek!',
    growing: 'Sbírka pěkně roste.',
    half: 'Už jsi pořádný znalec!',
    almost: 'Skoro hotovo!',
    complete: 'Hotovo, jsi legenda!',
  },

  // Search, filters and sorting
  searchLabel: 'Hledat v Dexu',
  searchPlaceholder: 'Hledej ptáka…',
  regionGroup: 'Oblast',
  statusGroup: 'Stav',
  filter: {
    all: 'Vše',
    czechia: 'Česko',
    europe: 'Evropa',
    caught: 'Chycené',
    missing: 'Zatím ne',
  },
  sortLabel: 'Řazení',
  sort: {
    number: 'Číslo',
    name: 'Název',
    rarity: 'Vzácnost',
  },
  listCount: '{count} {birds}',
  birds: {
    one: 'pták',
    few: 'ptáci',
    many: 'ptáků',
  },
  gridLabel: 'Ptáci v Dexu',

  // Nothing to show
  loading: 'Listuju ptačím atlasem…',
  empty: {
    title: 'Nic se nenašlo',
    hint: 'Zkus jiné slovo nebo změň filtr.',
    reset: 'Zrušit filtry',
  },
  emptyDex: {
    title: 'Zatím nemáš nic chyceno',
    hint: 'Vyraz ven, poslouchej a vyfoť prvního ptáka. Dex se naplní sám.',
    action: 'Jdu na to',
  },
  allCaught: {
    title: 'Máš je všechny!',
    hint: 'V téhle oblasti už ti žádný pták neuniká. Pořádný lovec!',
  },
  loadError: {
    title: 'Dex se nenačetl',
    network: 'Seznam ptáků se nepodařilo stáhnout. Zkontroluj připojení a zkus to znovu.',
    other: 'Seznam ptáků se nepodařilo načíst. Zkus to prosím ještě jednou.',
  },
  summaryError: {
    title: 'Sbírku se nepodařilo přečíst',
    text: 'Ptáky vidíš, ale ne ty chycené. Zkus aplikaci zavřít a znovu otevřít.',
  },

  // One card in the list
  card: {
    caught: 'chycený pták',
    notCaught: 'zatím nechycený pták',
    aria: '{name}, číslo {number}, {state}, {rarity}',
    times: '{count}×',
  },
  unknownName: '???',
  number: 'č. {number}',
  rarityAria: 'Vzácnost: {rarity}',

  // The detail screen
  species: {
    title: 'Detail ptáka',
    notFound: 'Tohohle ptáka v Dexu nemám.',
    notFoundHint: 'Možná odletěl. Vrať se do Dexu a vyber jiného.',
    toDex: 'Zpět do Dexu',
    previous: 'Předchozí pták',
    next: 'Další pták',
    position: '{position} z {total}',
    family: 'Čeleď',
    regions: 'Kde žije',
    yes: 'ano',
    no: 'ne',
    photo: 'Fotka',
  },
  status: {
    notCaughtTitle: 'Tohohle ptáka ještě nemáš',
    caughtTitle: 'Tenhle pták už je tvůj!',
    firstCaught: 'Poprvé chyceno {date}',
    catchCount: 'Úlovků: {count}',
    scan: 'Jdu ho hledat',
  },
  // A tip for a bird that is not caught yet, by the shape of its silhouette (a bird family in general, not this very bird).
  hint: {
    songbird: 'Poslouchej v zahradách, parcích a v lese. Nejvíc zpívají ráno.',
    duck: 'Hledej ho u vody: na rybníku, na řece nebo na přehradě.',
    owl: 'Vyraz za soumraku a poslouchej. Sovy se ozývají v noci.',
    raptor: 'Dívej se k obloze. Dravci krouží nad poli a lesy.',
    wader: 'Zkus mokřady, vlhké louky a břehy rybníků.',
  },
  rarityNote: {
    common: 'Tenhle bývá nablízku, měl by jít snadno.',
    uncommon: 'Občas se ukáže, chce to trochu trpělivosti.',
    rare: 'Vzácný host. Dej si na něj čas.',
    epic: 'Epická vzácnost. Tohle bude celá výprava.',
    legendary: 'Opravdová legenda. Potkat ho je velká událost.',
  },

  // The picture on the detail screen
  photo: {
    mine: 'Tvoje fotka',
    reference: 'Ukázka',
    altMine: 'Tvoje fotka ptáka',
    altReference: 'Ukázková fotka ptáka',
    credit: 'Foto: {author}',
    unknownAuthor: 'neznámý autor',
    publicDomain: 'Volné dílo',
    source: 'Wikimedia Commons',
    sourceLink: 'Zdroj fotky na Wikimedia Commons',
    reveal: 'Ukázat, jak vypadá',
    hide: 'Zase schovat',
    searching: 'Hledám ukázkovou fotku…',
    none: 'K tomuhle ptákovi nemám žádnou volnou fotku.',
    offline: 'Bez připojení ukázkovou fotku nenačtu.',
    enlarge: 'Zvětšit fotku',
    viewerTitle: 'Fotka na celou obrazovku',
    closeViewer: 'Zavřít fotku',
    missing: 'Uložená fotka chybí.',
  },

  // The list of catches of one bird
  catches: {
    title: 'Moje úlovky',
    noPlace: 'Místo nebylo uloženo',
    openMap: 'Otevřít v mapě',
    delete: 'Smazat úlovek',
    entry: 'Úlovek {index}',
  },
  deleteDialog: {
    title: 'Smazat tenhle úlovek?',
    message: 'Zmizí i uložená fotka nebo nahrávka. Tohle už nejde vrátit zpět.',
    confirm: 'Smazat',
    cancel: 'Ponechat',
  },
  deleted: 'Úlovek je smazaný.',
  deleteFailed: 'Úlovek se nepodařilo smazat. Zkus to prosím znovu.',

  // The player for saved recordings
  audio: {
    label: 'Nahrávka',
    play: 'Přehrát nahrávku',
    pause: 'Pozastavit nahrávku',
    position: 'Místo v nahrávce',
    missing: 'Uložená nahrávka chybí.',
    error: 'Nahrávku se nepodařilo přehrát.',
    loading: 'Načítám nahrávku…',
  },

  // The hidden demo page (/#/dev/demo): fake catches to try the Dex with
  demo: {
    title: 'Ukázková data',
    intro: 'Skrytá stránka pro zkoušení. Naplní Dex třiceti vymyšlenými úlovky s obrázky a zvukem, aby se dalo prohlédnout, jak vypadá sbírka plná ptáků.',
    safe: 'Tvoje opravdové úlovky se nedotknou, mažou se jen ty ukázkové.',
    status: 'Ukázkových úlovků v telefonu: {count}',
    add: 'Přidat ukázky',
    remove: 'Smazat ukázky',
    working: 'Pracuju na tom…',
    added: 'Hotovo, ukázkových úlovků je teď {count}.',
    removed: 'Ukázkové úlovky jsou pryč.',
    failed: 'Něco se nepovedlo. Zkus to prosím znovu.',
    openDex: 'Otevřít Dex',
    removeTitle: 'Smazat ukázkové úlovky?',
    removeMessage: 'Odstraní se jen ukázkové úlovky. Ty tvoje zůstanou.',
    demoTag: 'UKÁZKA',
    notes: {
      feeder: 'U krmítka za domem.',
      river: 'Seděl na větvi nad řekou.',
      early: 'Zpíval už před sedmou ráno.',
      field: 'Při procházce kolem pole.',
    },
  },
} as const
