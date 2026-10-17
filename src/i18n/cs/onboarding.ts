// Texts of the welcome screens shown on the first start.
// Keep the named export `onboarding` and `as const`. {appName} is filled in by t() automatically.

export const onboarding = {
  title: 'Vítej v {appName}',
  subtitle: 'Tvůj kapesní ptačí Dex',
  intro: 'Poznáš ptáky podle hlasu i podle fotky a každého, kterého potvrdíš, přidáš do sbírky.',
  start: 'Začít',
  next: 'Dál',
  back: 'Zpět',
  skip: 'Přeskočit',
  privacy: 'Všechno se děje přímo v telefonu. Žádné účty, žádné sledování.',
  stepLabel: 'Krok {step} z {total}',
  stepsLabel: 'Průběh úvodu',

  idea: {
    title: 'Jak to funguje',
    lead: 'Z Česka i celé Evropy poznáš stovky ptáků. Stačí tři věci.',
    listenTitle: 'Poslouchej',
    listen: 'Namiř telefon na zpěv a {appName} ti řekne, kdo to zpívá.',
    shootTitle: 'Vyfoť',
    shoot: 'Vyfoť ptáka, nebo ho nech hledat v živém záběru kamery.',
    catchTitle: 'Chyť',
    catch: 'Když si je {appName} jistý a ty to potvrdíš, pták se zapíše do tvého Dexu i s datem a místem.',
  },

  device: {
    title: 'Stáhne se jen jednou',
    download: 'Při prvním skenování si {appName} stáhne „ptačí mozek“, asi {size} MB. Nejlíp to udělej přes Wi-Fi. Potom funguje i bez internetu.',
    local: 'Rozpoznávání běží přímo v tvém telefonu. Fotky, nahrávky ani poloha ho neopouštějí.',
    noTracking: 'Žádné účty, žádná reklama, žádné sledování. Z internetu se kromě mozku dotahují jen ukázkové fotky ptáků z Wikipedie a název místa.',
  },

  permissions: {
    title: 'O co tě telefon požádá',
    lead: 'Telefon se zeptá na tři povolení. Tady je důvod, proč je potřebuju. Můžeš je povolit hned, nebo až se budou hodit.',
    microphone: 'Mikrofon',
    microphoneWhy: 'Aby šlo poslouchat zpěv ptáků. Zvuk zůstává v telefonu.',
    camera: 'Fotoaparát',
    cameraWhy: 'Pro focení ptáků a živý záběr. Obraz se nikam neposílá.',
    location: 'Poloha',
    locationWhy: 'Uloží místo úlovku a pomůže odhadnout, kteří ptáci tam právě žijí. Zůstává v telefonu.',
    allow: 'Povolit',
    granted: 'Povoleno',
    denied: 'Zablokováno. Povolit to jde později v nastavení prohlížeče nebo telefonu.',
    unavailable: 'Tohle tady nejde zapnout. Aplikace ale funguje i bez toho.',
    laterShort: 'Povolit můžeš i později, až to bude potřeba.',
    locationUnknown: 'Polohu teď nezjistím. Nevadí, ptáky uložím i bez ní.',
  },

  install: {
    title: 'Dej si ho na plochu',
    lead: '{appName} se chová jako obyčejná aplikace: má svou ikonku, běží přes celou obrazovku a funguje bez internetu.',
    ios: 'V Safari klepni dole na Sdílet (čtvereček se šipkou nahoru), posuň seznam a vyber „Přidat na plochu“.',
    iosSafari: 'Jde to jen v Safari. Na iPhonu mají Safari a aplikace z plochy oddělená data, proto si {appName} přidej na plochu hned na začátku.',
    androidPrompt: 'Na Androidu stačí jedno klepnutí.',
    androidButton: 'Nainstalovat',
    androidMenu: 'Otevři nabídku prohlížeče (tři tečky) a vyber „Nainstalovat aplikaci“ nebo „Přidat na plochu“.',
    desktop: 'V adresním řádku najdeš ikonku instalace, nebo v nabídce prohlížeče vyber „Nainstalovat aplikaci“.',
    installed: 'Skvělé, {appName} už běží jako aplikace.',
    accepted: 'Hotovo, ikonka je na ploše.',
    dismissed: 'Nevadí, instalovat můžeš kdykoli později z nabídky prohlížeče.',
    finish: 'Začít',
  },
} as const
