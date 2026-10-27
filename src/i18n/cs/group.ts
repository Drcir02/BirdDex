// Texts of the group: joining and creating, the feed, the leaderboards, the members, sharing and its settings.
// Keep the named export `group` and `as const`. A nickname or a bird's name never sits inside a sentence that would decline it.

export const group = {
  title: 'Skupina',
  key: 'Skupina',
  keyNews: 'Skupina, jsou tam nové úlovky',
  back: 'Zpět do skupiny',
  loading: 'Načítám skupinu…',

  tabs: {
    label: 'Část skupiny',
    feed: 'Feed',
    board: 'Žebříček',
    members: 'Členové',
  },

  // Not in a group
  none: {
    title: 'Zatím v žádné skupině nejsi',
    text: 'Ve skupině vidíte úlovky jeden druhého a soutěžíte v žebříčku. {appName} funguje naplno i bez ní, nic se nikam neposílá, dokud se nepřipojíš.',
    join: 'Připojit se kódem',
    create: 'Vytvořit skupinu',
  },
  removed: 'Už nejsi členem skupiny {name}: buď tě odebral správce, nebo se tomuhle telefonu ztratilo přihlášení. Tvoji ptáci zůstávají u tebe, připojit se můžeš znovu kódem.',
  removedDismiss: 'Rozumím',

  // Joining
  join: {
    title: 'Připojit se ke skupině',
    codeLabel: 'Kód skupiny',
    codeHint: '8 znaků, dostaneš ho od zakladatele skupiny (nebo ho přinese odkaz či QR kód).',
    codePlaceholder: 'např. RODINA23',
    nicknameLabel: 'Přezdívka',
    nicknameHint: 'Takhle tě ve skupině uvidí ostatní.',
    colorLabel: 'Barva',
    colorOption: 'Barva {n}',
    submit: 'Připojit se',
    sharedTitle: 'Co se ve skupině sdílí',
    shared: {
      what: 'Nově chycení ptáci: druh, BP, způsob chycení, datum a hodina.',
      picture: 'Jejich fotka zmenšená na 720 bodů (bez polohy a údajů z foťáku) nebo nahrávka.',
      place: 'Místo: název a odkaz na mapu. Můžeš to změnit na jen název nebo nic, a u každého ptáka ho zvlášť skrýt.',
      who: 'Vidí to jen členové téhle skupiny a správce serveru. Starší úlovky se nesdílejí.',
      control: 'Každého ptáka můžeš hned po chycení nebo později skrýt, nebo smazat. Ze skupiny můžeš kdykoli odejít, tvé příspěvky se smažou.',
    },
    errors: {
      noCode: 'Zadej kód skupiny.',
      noNickname: 'Zadej přezdívku (nejvýš 24 znaků).',
      noGroup: 'Takovou skupinu neznám. Zkontroluj kód.',
      nameTaken: 'Tuhle přezdívku už ve skupině někdo má (třeba tvoje dřívější připojení z jiného prohlížeče). Zkus jinou, nebo ať starou odebere správce.',
      full: 'Skupina je plná.',
      network: 'Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.',
      other: 'Připojení se nepovedlo. Zkus to prosím za chvíli.',
    },
    done: 'Jsi ve skupině',
    already: 'Ve skupině už jsi. Nejdřív z ní odejdi, jestli se chceš připojit jinam.',
    toGroup: 'Do skupiny',
  },

  // Creating
  create: {
    title: 'Vytvořit skupinu',
    intro: 'Skupinu může založit jen ten, kdo zná kód zakladatele. Ostatní se pak připojí kódem skupiny.',
    founderLabel: 'Kód zakladatele',
    founderHint: 'Tajný kód od tvůrce aplikace. Nikomu ho neposílej dál.',
    nameLabel: 'Název skupiny',
    namePlaceholder: 'např. Rodina',
    submit: 'Vytvořit skupinu',
    errors: {
      noFounder: 'Zadej kód zakladatele.',
      noName: 'Zadej název skupiny (nejvýš 40 znaků).',
      wrongFounder: 'Kód zakladatele nesedí.',
    },
    doneTitle: 'Skupina je hotová',
    doneText: 'Pozvi ostatní: ukaž jim QR kód nebo jim pošli odkaz či kód.',
  },

  // The invitation
  invite: {
    title: 'Pozvánka',
    code: 'Kód skupiny',
    link: 'Odkaz',
    copy: 'Kopírovat odkaz',
    copied: 'Odkaz je zkopírovaný.',
    copyFailed: 'Odkaz se nepodařilo zkopírovat.',
    share: 'Poslat pozvánku',
    shareText: 'Pojď do mojí skupiny v aplikaci {appName}. Kód je {code}.',
    qr: 'QR kód s pozvánkou',
    qrHint: 'Ostatní ho namíří fotoaparátem.',
  },

  // Settings
  settings: {
    title: 'Skupina',
    none: 'Zatím v žádné skupině nejsi. Ve skupině vidíte úlovky jeden druhého a soutěžíte.',
    join: 'Připojit se kódem',
    create: 'Vytvořit skupinu',
    open: 'Otevřít skupinu',
    member: 'Jsi ve skupině {name}',
    asNickname: 'jako',
    admin: 'Jsi správce',
    nicknameLabel: 'Přezdívka',
    colorLabel: 'Barva',
    save: 'Uložit',
    saved: 'Uloženo.',
    saveFailed: 'Změnu se nepodařilo uložit.',
    autoShare: 'Sdílet nové úlovky automaticky',
    autoShareHint: 'Každého nového ptáka můžeš hned po chycení skrýt. Skrytý pták se v žebříčku nepočítá.',
    placeTitle: 'Jak moc se sdílí místo',
    placeGroup: 'Sdílení místa',
    place: {
      exact: 'Přesně',
      name: 'Jen název',
      none: 'Nic',
    },
    placeHint: {
      exact: 'Skupina vidí název místa a z něj odkaz na mapu s přesným bodem.',
      name: 'Skupina vidí jen název místa, třeba „Praha“. Bez mapy.',
      none: 'Skupina nevidí o místě nic.',
    },
    leave: 'Odejít ze skupiny',
    leaveTitle: 'Odejít ze skupiny?',
    leaveMessage: 'Všechny tvoje příspěvky, fotky a nahrávky se ve skupině smažou. Ptáci u tebe zůstanou. Připojit se můžeš znovu kódem.',
    leaveConfirm: 'Odejít a smazat příspěvky',
    leaveCancel: 'Zůstat',
    leaveFailed: 'Odejít se nepodařilo. Zkontroluj připojení a zkus to znovu.',
    left: 'Odchod ze skupiny je hotový.',
    eraseNote: 'Tvoje příspěvky ve skupině se smažou taky. Ve skupině zůstaneš.',
  },

  // Sharing one bird
  share: {
    label: 'Sdílet se skupinou',
    statePending: 'Za chvíli se pošle do feedu.',
    stateSent: 'Je ve feedu skupiny.',
    stateHidden: 'Zůstává jen u tebe.',
    place: 'Ukázat místo',
    placeHint: 'Jak moc se ukáže, nastavuješ v Nastavení.',
    failed: 'Změnu se nepodařilo uložit.',
    notShareable: 'Tenhle pták byl chycen před připojením do skupiny, takže se nesdílí.',
  },

  // The feed
  feed: {
    filterLabel: 'Co ukázat',
    filter: {
      all: 'Všichni',
      newOnly: 'Nové druhy',
      mine: 'Moje',
    },
    refresh: 'Obnovit',
    loadMore: 'Starší úlovky',
    empty: {
      title: 'Ve feedu zatím nic není',
      text: 'Jakmile někdo ve skupině chytí ptáka, objeví se tady. Zkus chytit prvního.',
      action: 'Skenovat',
    },
    emptyNew: 'Žádný nový druh. Zkus jiný filtr.',
    emptyMine: 'Zatím tu nemáš žádný sdílený úlovek.',
    offline: 'Jsi offline, ukazuji, co jsem viděl naposledy.',
    error: 'Feed se nepodařilo načíst.',
    retry: 'Zkusit znovu',
    newPosts: 'Nové příspěvky jsou nahoře.',
  },

  // A post
  post: {
    open: 'Podrobnosti',
    close: 'Skrýt podrobnosti',
    newSpecies: 'Nový druh v Dexu',
    firstInGroup: 'První ve skupině',
    react: 'Super!',
    reacted: 'Tvoje reakce: Super',
    reactions: {
      one: '{count} Super',
      few: '{count} Super',
      many: '{count} Super',
    },
    hasSpecies: 'Tenhle druh máš v Dexu.',
    missingSpecies: 'Tenhle druh ještě nemáš v Dexu.',
    toSpecies: 'Stránka druhu',
    openMap: 'Otevřít v mapě',
    caughtOn: 'Chyceno {date}',
    by: 'od',
    delete: 'Smazat příspěvek',
    deleteTitle: 'Smazat příspěvek?',
    deleteMessage: 'Příspěvek zmizí všem ze skupiny. Pták u autora zůstane.',
    deleteConfirm: 'Smazat',
    deleteCancel: 'Ponechat',
    deleteFailed: 'Příspěvek se nepodařilo smazat.',
    deleted: 'Příspěvek je smazaný.',
    reactFailed: 'Super se nepodařilo poslat.',
    photo: 'Fotka ptáka',
    sound: 'Nahrávka ptáka',
    reference: 'Ukázka druhu',
    unknownSpecies: 'Neznámý druh',
  },

  // Time since
  ago: {
    now: 'právě teď',
    minute: 'před minutou',
    minutes: 'před {count} min.',
    hour: 'před hodinou',
    hours: 'před {count} hod.',
    yesterday: 'včera',
    days: 'před {count} dny',
  },

  // Leaderboards
  board: {
    periodGroup: 'Období',
    boardGroup: 'Žebříček',
    period: {
      all: 'Celkem',
      month: 'Měsíc',
      week: 'Týden',
    },
    boards: {
      species: 'Druhy',
      strongest: 'Nejsilnější',
      catches: 'Úlovky',
      streak: 'Série',
    },
    hint: {
      species: 'Kolik různých druhů kdo chytil.',
      strongest: 'Kdo má nejsilnějšího ptáka (nejvíc BP u jednoho ptáka).',
      catches: 'Kolik ptáků kdo chytil.',
      streak: 'Nejdelší série dní za sebou, kdy kdo něco chytil.',
    },
    value: {
      species: { one: '{count} druh', few: '{count} druhy', many: '{count} druhů' },
      catches: { one: '{count} úlovek', few: '{count} úlovky', many: '{count} úlovků' },
      streak: { one: '{count} den', few: '{count} dny', many: '{count} dní' },
      strongest: 'BP {count}',
    },
    you: 'ty',
    rank: '{rank}. místo',
    nobody: 'Zatím tu nikdo nic nemá.',
    error: 'Žebříček se nepodařilo načíst.',
    openMember: 'Otevřít profil',
  },

  // Members
  members: {
    title: 'Členové',
    count: {
      one: '{count} člen',
      few: '{count} členové',
      many: '{count} členů',
    },
    admin: 'správce',
    you: 'ty',
    since: 'od {date}',
    remove: 'Odebrat',
    removeTitle: 'Odebrat člena?',
    removeMessage: 'Člen a všechny jeho příspěvky ze skupiny zmizí. Jeho ptáci v telefonu zůstanou.',
    removeConfirm: 'Odebrat',
    removeCancel: 'Ponechat',
    removeFailed: 'Člena se nepodařilo odebrat.',
    removed: 'Člen je odebraný.',
    error: 'Členy se nepodařilo načíst.',
  },

  // A member's page
  profile: {
    title: 'Člen skupiny',
    notFound: 'Tenhle člen už ve skupině není.',
    speciesOf: '{caught} z {total}',
    speciesLabel: 'Druhy',
    catchesLabel: 'Úlovky',
    streakLabel: 'Nejdelší série',
    strongestLabel: 'Nejsilnější pták',
    rarestLabel: 'Nejvzácnější pták',
    top: 'Nejsilnější ptáci',
    latest: 'Poslední úlovky',
    noPosts: 'Zatím nic nesdílí.',
  },
} as const
