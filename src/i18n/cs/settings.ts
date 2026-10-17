// Texts of the settings screen. The polish task owns this file and may extend it.
// Keep the named export `settings` and `as const`.

export const settings = {
  title: 'Nastavení',
  sensitivity: {
    title: 'Citlivost chytání',
    hint: 'Čím přísnější nastavení, tím jistější musí rozpoznání být, než ptáka půjde chytit.',
    strict: 'Přísná',
    normal: 'Běžná',
    easy: 'Shovívavá',
  },
  backup: {
    title: 'Záloha',
    hint: 'Sbírku si můžeš uložit do souboru a později obnovit.',
    export: 'Uložit zálohu',
    import: 'Obnovit ze zálohy',
  },
  about: 'O aplikaci',
  diagnostics: 'Zkouška telefonu',
  diagnosticsHint: 'Ověří mikrofon, kameru, polohu a paměť.',
} as const
