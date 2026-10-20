// Texts of the scan screens (hub, sound, photo, live camera). The scan task owns this file and may extend it.
// Keep the named export `scan` and `as const`.
//
// Czech names change their ending inside a sentence, so a bird's name never sits in one of these texts: it gets its own line.
// Present tense, no past forms that carry gender ("slyšel jsem"), calm errors that always say what to do next.

export const scan = {
  title: 'Skenovat',
  chooseMethod: 'Jak chceš ptáka poznat?',
  toPhoto: 'Místo toho vyfotit',

  // The hub: three big buttons
  hub: {
    privacy: 'Všechno se počítá přímo v\u00A0tvém telefonu. Zvuk ani fotky se nikam neposílají.',
    sound: {
      title: 'Poslouchat',
      hint: 'Nech telefon poslouchat zpěv a\u00A0hlasy kolem tebe. Nejlíp ráno a\u00A0v\u00A0klidu.',
    },
    photo: {
      // A non-breaking space keeps the one-letter "z" with its word when the title wraps on a narrow screen.
      title: 'Vyfotit nebo z\u00A0galerie',
      hint: 'Vyfoť ptáka, nebo vyber snímek, který už máš v\u00A0telefonu.',
    },
    live: {
      title: 'Živá kamera',
      hint: 'Namiř kameru na ptáka a sleduj, jak ho poznávám.',
    },
  },

  // The "bird brain" (the models): download once, then it works without internet
  models: {
    title: 'Ptačí mozek',
    checking: 'Zjišťuju, co už mám v telefonu…',
    neededAll: 'Stáhne se jen jednou. Potom ptáky poznávám i\u00A0bez internetu.',
    neededSound: 'Na poslech si musím jednou stáhnout část ptačího mozku. Potom to jde i\u00A0bez internetu.',
    neededPhoto: 'Na fotky si musím jednou stáhnout část ptačího mozku. Potom to jde i\u00A0bez internetu.',
    download: 'Stáhnout ptačí mozek',
    downloadSize: '(asi {size} MB, nejlépe přes Wi-Fi)',
    downloading: 'Stahuju ptačí mozek…',
    progress: '{loaded} z {total} MB',
    keepOpen: 'Nech aplikaci otevřenou, než se stahování dokončí.',
    preparing: 'Rozjíždím ptačí mozek…',
    ready: 'Ptačí mozek je připravený. Funguje i\u00A0bez internetu.',
    progressLabel: 'Stahování ptačího mozku',
  },

  // Listening
  sound: {
    title: 'Poslech',
    hint: 'Nech telefon poslouchat zpěv a hlasy kolem tebe.',
    start: 'Začít poslouchat',
    stop: 'Hotovo',
    listening: 'Poslouchám…',
    starting: 'Zapínám mikrofon…',
    stopping: 'Vyhodnocuju záznam…',
    idleHint: 'Stiskni tlačítko a chvíli poslouchej. Čím blíž k ptákovi, tím líp. Po minutě se poslech zastaví sám.',
    heardBird: 'Slyším ptáka!',
    noBird: 'Zatím žádný pták',
    topTitle: 'Co slyším',
    nothingYet: 'Zatím nic nepoznávám. Poslouchám dál…',
    elapsed: 'Čas poslechu',
    levelLabel: 'Hlasitost mikrofonu',
    paused: {
      title: 'Poslech se zastavil',
      hidden: 'Když aplikace zmizí z obrazovky, telefon mi vypne mikrofon.',
      microphone: 'Mikrofon se přestal ozývat. Možná ho převzal hovor nebo jiná aplikace.',
      showResult: 'Zobrazit výsledek',
      again: 'Poslouchat znovu',
    },
  },

  // Photo
  photo: {
    title: 'Fotka',
    hint: 'Vyfoť ptáka, nebo vyber snímek z\u00A0galerie.',
    chooseHint: 'Nejlíp funguje ostrá fotka, na které je pták dobře vidět.',
    take: 'Vyfotit',
    pick: 'Vybrat z galerie',
    opening: 'Otevírám fotku…',
    previewTitle: 'Tvoje fotka',
    previewAlt: 'Náhled vybrané fotky',
    cropGroup: 'Výřez fotky',
    cropHint: 'Chceš ptáka vybrat přesněji? Posuň rámeček prstem a táhni za rohy. Není to nutné.',
    cropReset: 'Celá fotka',
    cropMove: 'Posunout výřez (šipkami)',
    cropCornerNw: 'Levý horní roh výřezu',
    cropCornerNe: 'Pravý horní roh výřezu',
    cropCornerSw: 'Levý dolní roh výřezu',
    cropCornerSe: 'Pravý dolní roh výřezu',
    identify: 'Určit',
    other: 'Jiná fotka',
    analysing: 'Prohlížím fotku…',
    errors: {
      heic: 'Formát HEIC neumím přečíst. Vyfoť ptáka rovnou tlačítkem Vyfotit, nebo ulož fotku jako JPEG.',
      notImage: 'Tohle není obrázek. Vyber prosím fotku.',
      unreadable: 'Fotku se nepodařilo otevřít. Zkus jinou, nejlépe JPEG nebo PNG.',
      tooBig: 'Fotka je moc velká. Zkus menší, nebo ptáka vyfoť znovu.',
      empty: 'Ten soubor je prázdný. Vyber prosím jinou fotku.',
    },
  },

  // Live camera
  live: {
    title: 'Živá kamera',
    hint: 'Namiř kameru na ptáka a sleduj, jak ho poznávám.',
    start: 'Zapnout kameru',
    stop: 'Vypnout kameru',
    catch: 'Chytit',
    starting: 'Zapínám kameru…',
    aim: 'Namiř kameru na ptáka a drž ji klidně. Pták má být uprostřed.',
    searching: 'Hledám ptáka…',
    locked: 'Mám ho na mušce!',
    lockedUnsure: 'Skoro… ještě si nejsem jistý',
    unsureHint: 'Nejsem si jistý. Přibliž obraz a drž telefon klidně, nebo ho chyť přesto: rozhoduješ ty.',
    guess: 'Můj tip',
    catchWait: 'Tlačítko se odemkne, až ptáka zaměřím.',
    reticle: 'Zaměřovač',
    previewLabel: 'Obraz z kamery',
    zoom: {
      label: 'Přiblížení',
      hint: 'Rozevři dva prsty nebo klepni na číslo a přibliž ptáka.',
      step: 'Přiblížení {zoom}',
    },
    snapshotFailed: 'Snímek se nepovedl. Zkus to ještě jednou.',
    paused: 'Kamera se vypnula, když aplikace zmizela z obrazovky. Zapni ji znovu.',
    stalled: {
      title: 'Kamera nic neukazuje',
      text: 'Z kamery nepřichází obraz. Někdy pomůže ji vypnout a zapnout, nebo aplikaci zavřít a otevřít. Ptáka můžeš taky vyfotit.',
    },
  },

  // What to do when the microphone or the camera is blocked
  help: {
    micTitle: 'Chybí povolení k mikrofonu',
    cameraTitle: 'Chybí povolení ke kameře',
    steps: 'Jak to zapnout',
    micIphone: 'iPhone: v Safari klepni vlevo v adresním řádku na „aA“, vyber „Nastavení webu“ a u mikrofonu zvol „Povolit“. Potom stránku načti znovu.',
    micAndroid: 'Android: v Chromu klepni vedle adresy na ikonu nastavení webu, vyber „Oprávnění“ a u mikrofonu zvol „Povolit“.',
    cameraIphone: 'iPhone: v Safari klepni vlevo v adresním řádku na „aA“, vyber „Nastavení webu“ a u kamery zvol „Povolit“. Potom stránku načti znovu.',
    cameraAndroid: 'Android: v Chromu klepni vedle adresy na ikonu nastavení webu, vyber „Oprávnění“ a u kamery zvol „Povolit“.',
    homeScreen: 'Aplikace na ploše: zavři ji, otevři znovu a při dotazu zvol „Povolit“.',
  },

  errors: {
    cameraMissing: 'Kameru se nepodařilo najít. Zkontroluj, jestli telefon nějakou má, nebo ptáka vyfoť přes tlačítko Fotka.',
    cameraBusy: 'Kameru právě používá jiná aplikace. Zavři ji a zkus to znovu.',
  },
} as const
