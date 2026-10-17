// Texts of the About page (credits and licences). The polish task owns this file and may extend it.
// Keep the named export `about` and `as const`.

export const about = {
  title: 'O aplikaci',
  intro: 'Ptačí atlas, který se vejde do kapsy. Žádné účty, žádný server, všechno zůstává v tvém telefonu.',
  credits: 'Poděkování',
  licences: 'Licence',
  version: 'Verze {version}',
  models: {
    birdnet: 'Zvuky rozpoznává BirdNET, licence CC BY-NC-SA 4.0.',
    wingclip: 'Fotky rozpoznává WingCLIP, licence CC BY-NC 4.0.',
  },
  photos: 'Fotografie ptáků pocházejí z Wikimedia Commons a mají vlastní licence Creative Commons.',
} as const
