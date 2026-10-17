# Shell, theme, i18n and UI kit (task F1a)

Everything every screen stands on: the router, the Pokedex-style device around the screens, the design tokens, the Czech
text system and the shared components. Look at it live at `/#/ui-kit` (not in the navigation).

## Recipe: build a screen

```tsx
// src/pages/SomethingPage.tsx  (default export, because pages are lazy-loaded)
import { Page, PageHeader, LcdPanel, Button } from '../ui'
import { t } from '../i18n'

export default function SomethingPage() {
  return (
    <Page>
      <PageHeader title={t('dex.title')} backTo="/" />   {/* exactly one h1 per screen */}
      <LcdPanel title={t('dex.species.title')}>...</LcdPanel>
    </Page>
  )
}
```

- The screen scrolls inside the LCD (`.bd-lcd`), not the window. Do not use `position: fixed` inside a screen (it would
  ignore the LCD); `position: sticky` and `absolute` work. Use `<Page bleed>` for full-bleed content (a camera view).
- Replace the stub in `src/pages/` but keep the file name and the default export (App.tsx lazy-loads them).
- Put a link to `/field-check` (the phone test) in the real Settings screen: the old home page that linked to it is gone.
- The welcome screen must call `markWelcomed()` (from `src/app/welcome.ts`) when it is done or skipped, then
  `navigate('/', { replace: true })`. The first-run gate sends everybody to `/welcome` until the flag is set.
- Lights: `useDeviceActivity('listening')` while the screen listens, `'busy'` while it thinks, or
  `const { flash } = useDeviceStatus(); flash('success')` for a short celebration (2.4 s). If two screens claim at once the
  newest wins; the claim is withdrawn on unmount. Works without a provider (nothing happens), so screen tests need no setup.
- Toasts: `const toast = useToast(); toast.show('Máš ho!', { tone: 'success' })` (tones `info`, `success`, `error`; errors stay
  6.5 s). Needs `ToastProvider` (App.tsx has it); wrap it around your component in unit tests.
- Inline failures: `<Notice tone="error" title=... action={<Button>Zkusit znovu</Button>}>message</Notice>`. Messages for the
  usual failures are in `common.errors.*` (mic and camera denied, camera stalled, no network, storage full, model failed...).

## Routes (HashRouter)

`src/app/routes.ts` has `ROUTES` (use it instead of typing paths), `speciesPath(id)`, `sectionOf(pathname)` (which bottom
button is lit) and `isOpenOnFirstRun(pathname)`. All routes of BRIEF section 4 exist, plus `/ui-kit` and a friendly
404 for everything else. `/field-check` lives outside the device shell (its own dark look, scoped under `.fc-root` in
`src/styles/fieldcheck.css`) and is open before the welcome screen, so the existing field-check tests keep working.

First run: `FirstRunGate` redirects every path except `/welcome`, `/ui-kit` and `/field-check` to `/welcome` while
`localStorage['birddex:welcomed']` is unset. If the browser refuses storage the flag also lives in memory, so nobody is
trapped on the welcome screen. The bottom navigation is hidden on `/welcome`.

**For e2e tests:** `import { skipWelcome } from './shell-helpers'` and call `await skipWelcome(page)` before `page.goto()`,
otherwise every address redirects to `/#/welcome`. `shell-helpers.ts` also has `collectErrors(page)`.
Stable test ids: `device` (has `data-status`), `screen` (the scrolling LCD), `nav-dex`, `nav-scan`, `nav-settings`,
`lens`, `leds`. The nav is `getByRole('navigation', { name: 'Hlavní nabídka' })` and marks the current section with
`aria-current="page"`.

## The device (src/app/Layout.tsx, src/styles/shell.css)

- Red body with a dark rim, a glossy blue lens (SVG, `Lens.tsx`), three LEDs in a dark housing, wordmark and speaker slits,
  the green LCD in a dark bezel with scanlines, and three big keys at the bottom (Dex, Skenovat, Nastavení; the middle one is blue).
- LED meaning (CSS reads `data-status` on the device): idle = green; listening = red pulse + ripple on the lens;
  busy = yellow blink + sweeping arc on the lens; success = green flashes + lens flash; error = steady red + red tint on the lens.
  The status is also written for screen readers inside the `role="status"` lights.
- Safe areas: top bar, bottom keys and side padding add `env(safe-area-inset-*)` (tokens `--safe-top/right/bottom/left`).
- Landscape phones (`orientation: landscape` and height <= 520 px): the lens and lights become a left column and the keys a
  right column, the LCD fills the middle. Screens 560 px wide and 640 px high or more show the device as a 460 px handheld
  in the middle of the page.
- Tapping the key of the screen you are already on scrolls the LCD to the top (smooth, or instant with reduced motion).
- Scroll memory: a new screen starts at the top; the browser's back button returns a list to where it was left (the position
  is kept per history entry, restored for up to 1.5 s while the screen fills with content). Query-only changes keep the place.
- `document.title` is "<section> · BirdDex" from `common.nav.*`.
- An `ErrorBoundary` sits around the routed page inside the shell (a crash keeps the device and the keys alive; leaving the
  screen heals it) and another around the whole app. A screen whose code cannot be downloaded (offline after a new deploy)
  gets its own message, `common.errors.chunk`. Note that `React.lazy` remembers a failed download until the page reloads,
  which is why the main button is "Načíst znovu".

## Theme (src/styles)

`tokens.css` is the single source: palette (`--shell-red*`, `--lens-blue*`, `--led-*`, `--lcd-*`, `--ink`, `--paper`, rarity
colours), spacing `--space-1..7`, radii, shadows, type scale, motion, z-index, `--tap: 44px`. `base.css` has the reset,
focus ring, `.bd-sr-only`, the `prefers-reduced-motion` rule and zero-specificity typography for text inside
`.bd-text` (the LCD, dialogs and error screens have that class). `--shell-bar` equals the `theme-color` meta in index.html.

Class prefix is `bd-`. Component CSS lives next to the component in `src/ui` and loads with it.
No dark mode. All animation is switched off by the reduced-motion rule; status colours stay so nothing depends on motion.

### Fonts and Czech letters (checked glyph by glyph with fontTools, and in screenshots)

| Font | Use | Czech coverage |
|---|---|---|
| Press Start 2P | headings, wordmark | all of ě š č ř ž ý á í é ú ů ď ť ň and capitals (the lowercase ů is a bit heavy at small sizes) |
| VT323 | all LCD text, buttons, labels | all, clean |
| Silkscreen | digits and Latin-only text | **missing ě č ř ů ď ť ň and their capitals** |

Never set Czech sentences in Silkscreen. `--font-wordmark` is Silkscreen with VT323 as fallback, so a stray missing
letter at least stays pixel-style. Only the latin and latin-ext subsets are imported (src/styles/fonts.css).
Pixel fonts look crispest at 8, 16 and 24 px; VT323 is small for its size, so body text is 22 px.

## i18n (src/i18n)

- `t('dex.progress', { caught: 12, total: 412 })`. Keys are typed from the dictionary and placeholder names are checked at
  compile time: a missing or extra param is a type error. This needs `as const` at the end of every file in `src/i18n/cs/`
  (without it a file still works, only that file's placeholders are not checked).
- A key held in a variable only type-checks if every key it may be has the same params (a union of placeholder-free keys is fine;
  for a computed key use `` t(`common.nav.${section}` as const) ``, which is a union of literal keys).
- `{appName}` is filled automatically from `APP_NAME` (src/app/constants.ts, the only place the name lives).
- Numbers passed as params are written Czech style (decimal comma, no digit grouping). Missing params leave `{name}` visible.
- Files may nest objects (`common.nav.dex`); only strings are texts (no arrays). Keep the named exports
  (`common`, `dex`, `scan`, `result`, `settings`, `about`, `fun`, `onboarding`) because `cs/index.ts` merges them.
- `plural(n, ['pták', 'ptáci', 'ptáků'])`: exactly 1 is the first form, 2 to 4 the second, every other whole number
  (0, 5 to 20, 21, 22, 100...) the third. Czech uses the genitive plural from 22 on too ("22 ptáků"). An optional fourth form
  is used for fractions ("1,5 ptáka").
- Format helpers: `formatNumber`, `formatPercent` (0.853 becomes "85 %" with a non-breaking space), `formatDate`
  ("16. 10. 2026"), `formatTime`, `formatDateTime`.
- Voice: informal "ty", present tense, no gendered past forms ("viděl jsi"), calm errors with a next step. The tests reject
  ASCII-fied Czech words, `...` instead of the ellipsis character, empty texts and emoji.
- **Czech names change their ending inside a sentence** ("Chytit sýkoru", not "Chytit Sýkora koňadra"). Never put a species
  name into a slot that needs another case. Give the name its own line, or make it the subject: `'Máš ho! {name} je v Dexu.'`.
- `common.ts` is complete (navigation, generic buttons, device states, rarity names, failure messages, error screen, kit texts).
  The other files have a first set of keys; their feature owners extend them.

## UI components (src/ui, one import: `import { ... } from '../ui'`)

Button / ButtonLink (primary, secondary, danger; md 44 px, lg 56 px; `busy`; `icon`) / IconButton, IconLink / LcdPanel (light,
dark) / Chip (tones incl. the five rarities; with `onClick` it becomes a 44 px toggle with `aria-pressed`) / ProgressRing /
LevelMeter / ConfidenceBar (optional catch `threshold` notch; turns green once reached) / ConfirmDialog (portal, focus
trapped, Escape and outside tap cancel, focus returns, page behind is `inert`, first focus on Cancel for `tone="danger"`) /
Toast (`ToastProvider`, `ToastViewport`, `useToast`) / Spinner / EmptyState / Notice / SpeciesSilhouette / SegmentedControl
(radio group, arrow keys) / Switch / SearchField / Page, PageHeader / `Icon` with 24 icons (dex, scan, settings, microphone,
camera, photo, live, check, close, play, pause, location, calendar, bird, back, search, info, warning, trash, download,
upload, refresh, speaker, chevron).

`SpeciesSilhouette` has five outlines (songbird, duck, owl, raptor, wader). Pass `shape`, or `family` and it picks one
from Latin, English or Czech family names (anything unknown is a songbird). The family mapping has not been checked against the
real species data from the data task: if its `family` values look different, pass `shape` explicitly.
Tint with `color` or the text colour; the eye follows `--sil-eye`.

Pure logic is in `src/ui/logic.ts`, `silhouette.ts` and `toastState.ts` and is unit-tested.

## Tests

- `tests/unit/shell-i18n.test.ts`, `shell-ui-logic.test.ts`, `shell-components.test.ts` (jsdom), `shell-app.test.ts` (jsdom:
  welcome flag, first-run gate, lights, Layout, ErrorBoundary, kit page). Component tests are `.test.ts` files that use
  `createElement` and the docblock `// @vitest-environment jsdom`, because the vitest config only includes `*.test.ts`.
  Call `cleanup()` in `afterEach` (no globals).
- `tests/e2e/shell.spec.ts` (24 tests): first-run redirect, navigation through the keys, every route, field check, 360 px
  and 320 px and landscape without horizontal scroll, no console errors, 44 px targets, lights, reduced motion, dialog
  focus trap, toasts, scroll memory, fonts, theme colour, a screen that cannot be downloaded. It checks for "an h1 that is
  visible" on each route, not for exact titles, so replacing the stubs does not break it.

## Changes outside my area (all small)

- `tests/e2e/field-check.spec.ts`: the first test needed the old home page with the "Field check" link, which no longer
  exists. It now opens `/#/field-check` directly.
- `scripts/make-icons.mjs`: one line, the iOS home-screen icon is rendered from `icon-maskable.svg` (full bleed). iOS shows
  transparent corners as black.
- `src/styles.css` was deleted: its rules moved, scoped under `.fc-root`, to `src/styles/fieldcheck.css` (used by `FieldCheckRoute`).
- The app icons (`public/icons/*`) are redrawn to match the device: glossy lens with a white songbird, LEDs, red body.

## Not verified here

- Real iPhone and Android: safe-area insets (`env()` is 0 in the test browser), home-screen mode, the on-screen keyboard
  with a focused search field, landscape with a notch.
- The look of the Czech letters in Press Start 2P at sizes other than 12 to 24 px.
- Screen readers (the roles and labels are tested, the spoken result is not).
- The Field check page itself is still English (it is a diagnostic page from the first milestone, not part of the app UI).
