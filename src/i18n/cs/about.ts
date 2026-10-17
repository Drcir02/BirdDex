// Texts of the About page (credits and licences).
// Keep the named export `about` and `as const`. Licence names stay as they are written by their authors.

export const about = {
  title: 'O aplikaci',
  intro: 'Ptačí atlas, který se vejde do kapsy. Žádné účty, žádný server, rozpoznávání i sbírka zůstávají v tvém telefonu.',
  credits: 'Poděkování',
  licences: 'Licence',
  version: 'Verze {version}',

  // Kept from the first version (other code may still use them)
  models: {
    birdnet: 'Zvuky rozpoznává BirdNET, licence CC BY-NC-SA 4.0.',
    wingclip: 'Fotky rozpoznává WingCLIP, licence CC BY-NC 4.0.',
  },
  photos: 'Fotografie ptáků pocházejí z Wikimedia Commons a mají vlastní licence Creative Commons.',

  gift: {
    title: 'Dárek, ne zboží',
    text: '{appName} je dárek. Není na prodej a nesmí se prodávat ani nabízet za peníze: modely uvnitř povolují jen nekomerční použití.',
  },

  privacy: {
    title: 'Žádné sledování',
    text: 'Žádné účty, žádná reklama, žádné statistiky ani sledování. Tvoje sbírka, fotky, nahrávky a poloha zůstávají v telefonu. Z internetu se stahují jen modely (jednou), ukázkové fotky ptáků a název místa, a to jen když jsi online.',
  },

  sound: {
    title: 'Rozpoznávání zvuku',
    name: 'BirdNET',
    by: 'Cornell Lab of Ornithology a Chemnitz University of Technology',
    text: 'Ptáky podle hlasu pozná BirdNET. Model používáš na základě licence CC BY-NC-SA 4.0 (jen nekomerčně, s uvedením původu, sdílet dál za stejných podmínek).',
  },

  photo: {
    title: 'Rozpoznávání fotek',
    name: 'WingCLIP a WingDex',
    by: 'projekt WingDex',
    text: 'Ptáky na fotkách i v živém záběru pozná WingCLIP z projektu WingDex. Váhy modelu mají licenci CC BY-NC 4.0 (jen nekomerčně, s uvedením původu), kód je pod licencí MIT.',
    teacher: 'WingCLIP je zmenšený model TinyCLIP (licence MIT), který se učil od větších modelů WingCLIP-0.1 a BioCLIP 2 (licence MIT).',
  },

  taxonomy: {
    title: 'Seznam ptáků',
    name: 'eBird / Clements',
    by: 'Cornell Lab of Ornithology',
    text: 'Pořadí druhů v Dexu, jejich vědecké a anglické názvy a odkazy na Wikipedii vycházejí z taxonomie eBird/Clements, kterou přebírá projekt WingDex. České názvy doplňuje BirdNET.',
  },

  images: {
    title: 'Fotografie ptáků',
    name: 'Wikipedie a Wikimedia Commons',
    text: 'Ukázkové fotky ptáků pocházejí z Wikipedie a Wikimedia Commons a mají vlastní licence Creative Commons. U každé fotky vidíš na stránce ptáka jejího autora a licenci.',
  },

  places: {
    title: 'Názvy míst',
    name: 'OpenStreetMap',
    text: 'Název místa úlovku se zjišťuje přes službu Nominatim (data: přispěvatelé OpenStreetMap, licence ODbL). Posílá se jen zaokrouhlená poloha a jen když jsi online. Odkaz „Otevřít v mapě“ vede na openstreetmap.org.',
  },

  libraries: {
    title: 'Otevřený software',
    text: 'Aplikace stojí na těchto otevřených knihovnách. Díky jejich autorům.',
    react: 'React (MIT)',
    vite: 'Vite a vite-plugin-pwa (MIT)',
    router: 'React Router (MIT)',
    dexie: 'Dexie (Apache-2.0)',
    litert: 'LiteRT.js (Apache-2.0)',
    onnx: 'ONNX Runtime Web (MIT)',
    fflate: 'fflate (MIT)',
    workbox: 'Workbox (MIT), díky kterému aplikace funguje bez internetu',
    fonts: 'Písma Press Start 2P, VT323 a Silkscreen (SIL Open Font License)',
  },

  dedication: {
    title: 'Věnování',
  },
} as const
