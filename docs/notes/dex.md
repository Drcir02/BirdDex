# Dex screens, reference photos and demo data (task S1)

The Dex list (`/`), the bird screen (`/species/:id`), the reference photo service, the hidden demo page (`/#/dev/demo`) and all
Czech texts of these screens (`src/i18n/cs/dex.ts`). Everything below was run here; the last section lists what could not be.

## What a person sees

**Dex (`src/pages/DexPage.tsx`)**: the title and a progress ring with "Chyceno 22 z 276" for the active region and a cheering line
(six stages, from "Pojď na první lov!" to "Hotovo, jsi legenda!"); a search box; chips for the region (Česko, Evropa) and the status
(Vše, Chycené, Zatím ne); the number of birds and a sort menu (Číslo, Název in Czech alphabet order, Vzácnost from common to
legendary); the grid. A card has the picture (a silhouette until the bird is caught), the Czech name (the Latin name under it when
the Czech name is short, or alone when BirdNET has no Czech name), the number `#007`, five rarity stars in the rarity colour and,
when caught, a green badge (with `2×` for several catches). A bird that is not caught has a dashed card. Empty states: nothing found
(with "Zrušit filtry"), nothing caught yet (with a button to scan), everything caught.

**Bird screen (`src/pages/SpeciesPage.tsx`)**: back, "186 z 276", previous and next; a big dark LCD panel with the picture (the
person's own photo, or the reference photo with its credit, or a glowing silhouette) and the Dex number; the name block (Czech name
as the one h1, Latin name in italics, family in Czech and Latin, rarity, "Kde žije: Česko ✓ Evropa ✓"); then either "Tohohle ptáka
ještě nemáš" with a tip for finding it and "Jdu ho hledat" (to `/scan`), or "Tenhle pták už je tvůj!" and the list of catches. A
catch shows the method icon and name, the date and time in Czech, the place name or rounded coordinates (`50,08° s. š., 14,44° v. d.`)
with an "Otevřít v mapě" link (OpenStreetMap), the confidence bar, a note if there is one, the recording player or the photo (tap
for full size), and a delete button that asks first.

## Decisions

1. **Czechia is the default region** (the gift is for somebody in Czechia). 276 Czech birds, 423 for Europe.
2. **State of the list lives in the address and is written with `history.replaceState`, not through the router.** Going through the
   router (`setSearchParams`) was tried first and was wrong in two ways found by the end-to-end tests: every change made a new
   history key (the shell's scroll memory is filed under that key, so "back" restored position 0), and the router shows an address
   change a moment late (as a low priority update), so a quick second tap was merged onto the old address and the first tap was
   lost. Now the page keeps the state itself (`useState` + a ref) and copies it to the address, keeping `history.state` (the router's
   key) as it is. Taps write at once, the search waits 250 ms (Safari allows only 100 `replaceState` calls in 30 s). The page follows
   the address when it changes from outside (a link inside the app, or the browser's back and forward through a `popstate` listener).
   **If you need the Dex's current filters from other code, read `window.location`; `useLocation().search` is stale there.**
3. **Bird address carries the list**: a card links to `/species/<id>?region=europe&status=caught&sort=name&q=...` (only what differs
   from the default) with router state `{ fromDex: true }`. The bird screen builds previous and next from that same list (so with
   a search, "next" is the next match), and moves with `replace`, so one step back is the Dex. Back is `navigate(-1)` only when
   `fromDex` is set; an address opened directly has nothing behind it, so Back opens the Dex with the same filters.
4. **Search**: `searchSpecies` from the data layer (Czech, Latin and English names, accents ignored). With the default sort the best
   matches come first (names that start with the word); choosing another sort puts the matches in that order. Chips and the search
   box answer at once, the list follows through `useDeferredValue` (it dims after 160 ms if it is slow).
5. **Speed**: 423 cards with `content-visibility: auto` (layout and paint of far cards are skipped) and an exact card height, so
   skipped cards take exactly their room and the scroll bar does not jump (`contain-intrinsic-block-size` is the height of the
   content, 176 px; the 5 px padding comes on top, as for a real card). Pictures load only for cards near the screen
   (`useNearScreen`, one shared `IntersectionObserver` on the LCD scroll box with a 500 px margin). Measured on the production build
   here, tapping "Evropa" until 423 cards are painted: 164 ms normal, 472 ms with the CPU 4 times slower, 646 ms 6 times slower;
   one letter in the search: 185, 595 and 1108 ms (the box itself answers at once). 8100 DOM nodes. A test with 700 birds passes.
6. **Own photos in the grid are shrunk** (`thumbnails.ts`): a camera photo is megabytes; the grid shows 400 px copies made one at a
   time through an `<img>` (so the camera's orientation note is applied), kept in memory for the session. Photos under 70 KB are
   used as they are. Delete a catch through `deleteCatch` and call `forgetThumbnail(mediaId)` if you delete outside my screens.
7. **A bird that is caught without a photo of its own (a sound catch) shows the reference photo** in the grid and on its screen.
   **A bird that is not caught keeps its secret**: silhouette only, and no web request, until the person taps "Ukázat, jak vypadá".
   A caught bird with its own photo has a "Tvoje fotka | Ukázka" switch once the reference photo is known.
8. **Maps**: an OpenStreetMap link (`target=_blank`, `rel=noopener noreferrer`) works in every browser on every phone. The link uses
   the exact stored position, the text shows it rounded to two decimals.
9. **The recording player** is an `<audio>` element without the browser's controls, with a play and pause button, a seek bar
   (`input[type=range]`, keyboard and screen reader friendly) laid over the "level bar": 32 bars with the loudness of the clip
   (RMS over the WAV samples, read once from the saved file), which light up as it plays. Only one clip plays at a time. No
   AudioContext, so nothing needs unlocking on iOS.
10. **Rarity stars** are drawn SVG (one `<svg>` with five paths per card), not characters.

## Reference photos (`src/features/photos`)

```ts
import { useReferencePhoto, getReferencePhoto, peekReferencePhoto } from '../features/photos'
const { photo, status } = useReferencePhoto(speciesId, { enabled })   // status: idle | loading | ready | none | error
const photo = await getReferencePhoto('parus-major')                    // ReferencePhoto | null, never throws
// ReferencePhoto: { speciesId, thumbnailUrl (330 px), imageUrl (500 px), author, licence, link }
```

To show one, use `ReferenceImage` (`src/features/dex/ReferenceImage.tsx`) and always show the credit next to it: author (empty means
`t('dex.photo.unknownAuthor')`), the licence (`licenceLabel()` from `SpeciesPhoto.tsx` turns "Public domain" into "Volné dílo") and
the link. `SpeciesPhoto.tsx` is the example.

- **How it finds a photo**: English Wikipedia REST summary for `wikiTitle` (then the Latin name when the first has no picture),
  then the Commons API (`extmetadata`, `origin=*`) for the author and the licence of that file. Pattern from WingDex (MIT). No
  custom request headers, so there is no CORS preflight.
- **Licences**: only CC0, public domain, CC BY and CC BY-SA, any version. Anything with NC or ND, GFDL alone, fair use, unknown or
  "non-free" is refused and the bird is remembered as "no photo".
- **Cache**: IndexedDB `photoCache`, hits for 60 days, "no photo" for 7 days (an empty `thumbnailUrl`), records dated in the future are
  ignored. Offline, an old record is better than nothing. Results are also kept in memory (`peek` answers at once).
- **Manners**: at most 4 lookups at a time (the newest request first, so what is on screen goes first; a lookup nobody waits for
  any more is skipped before it starts), 3 tries with growing pauses (700 ms, 1.4 s; `Retry-After` honoured), a request that has
  not delivered its whole answer in 12 s is given up and tried again (so one stuck request cannot hold one of the 4 places for
  ever), no tries while the phone says it is offline, 20 s of rest for a bird after a failure (a forced retry when the browser
  fires `online`), and after 6 failures in a row the whole service rests for a minute. A failed lookup is never cached as "no photo".
- **Service worker** (`vite.config.ts`, the one rule added): `https://upload.wikimedia.org/` CacheFirst in `birddex-photos-v1`,
  800 entries, statuses 0 and 200, purge on quota error. Pictures are requested with `crossOrigin="anonymous"` so the worker keeps
  them as readable responses (an opaque response counts for several MB of quota). If a server did not allow CORS, `ReferenceImage`
  tries the wide picture, the small one, and then both again without `crossorigin`.
- **Tests**: licence rules, address and answer parsing, the service with a mocked `fetch` (cache, TTL, offline, retries, the queue and
  its limit of 4, skipping, the breaker), the hook. And `tests/e2e/dex-offline.spec.ts`, which plays the three Wikimedia hosts with
  a local HTTPS server (host mapping, a throw-away certificate made with `openssl`): the service worker really caches the
  picture as `cors 200`, the bird shows photo and credit again with no server at all after a reload, and a server without CORS
  still ends with a visible picture.

## Demo data (`src/features/dex/demo`)

`/#/dev/demo` (inside the device, after the welcome screen) or **seven quick taps on the progress ring** of the Dex (there is no
address bar in an installed iPhone app). "Přidat ukázky" adds 30 catches: 24 birds (common garden birds, owls, a kingfisher, a
stork, a wallcreeper, and two that do not live in Czechia), six of them caught again; sound, photo and live; place names,
coordinates only, and no place; four notes; two without a picture or recording. Ids are `demo-01` to `demo-30`; the pictures are
small drawings with an "UKÁZKA" tag, the sounds are generated whistles (WAV, 2.4 s). Running it twice adds nothing. "Smazat ukázky"
asks first and deletes only ids starting with `demo-` (and their media). A demo catch shows a blue "UKÁZKA" tag in its list.
**On an iPhone, Safari and the home-screen app have separate storage**, so seed the data in the one you want to look at.

## Tests

Unit (`tests/unit/`, no model files): `dex-filters` (address, selection, search, sort, progress, neighbours), `dex-format`,
`dex-copy` (every computed text key exists, Czech plurals), `dex-demo` (plan, sounds, seeding and clearing in IndexedDB),
`dex-thumbnails`, `dex-components` (jsdom: stars, cards with a fake `IntersectionObserver`, the picture fallbacks, the player, the
viewer, the Dex page and the bird screen with deletes and navigation), `photos-wikimedia`, `photos-service`, `photos-hook`.
End to end (`E2E_PORT=4186`): `dex.spec.ts` (demo page, progress, filters, search, sort, the address and back, fast taps, 423 and 700
cards with a slow CPU, the bird screen, player, viewer, delete, previous and next, reference photos with a pretend Wikipedia, big
camera photos with an EXIF turn, both phone sizes and landscape) and `dex-offline.spec.ts`. The phone screenshots go to
`test-results/dex-shots-<port>/` (390x844, 360x800, landscape) and were looked at.

## Changes outside my files

- `src/App.tsx`: one lazy import and one route, `/dev/demo`, inside the device shell and the first-run gate.
- `vite.config.ts`: the one runtime caching rule for `upload.wikimedia.org`.
- Nothing else. `src/i18n/cs/dex.ts` is rewritten; the old keys that other code might use (`dex.title`, `dex.progress`, `dex.filter.*`,
  `dex.empty*`, `dex.species.title`, `dex.unknownName`, `dex.number`) are still there.

## Gotchas

- `page.route` does not see requests made by the service worker, so the Dex tests run with `serviceWorkers: 'block'`. A route that
  fulfils a request is not held to CORS, so only the real HTTPS server of `dex-offline.spec.ts` can test that.
- The service worker's own requests ignore a test context's `ignoreHTTPSErrors`; that spec starts Chromium with
  `--ignore-certificate-errors` and `--no-proxy-server` (the cloud machine's proxy would otherwise get the host names).
- Rows written into IndexedDB behind the app's back (`addRealCatch` in the helpers) are not seen by live queries until the app
  restarts; the tests reload.
- A `page.goto` to another hash is a `popstate` with no router key (`'default'`), which the shell's scroll memory shares between
  entries; in a real phone every entry has its own key. The screenshots wait for the screen to settle (`scrollScreen`).
- Skipped cards are 10 px too tall if the stand-in height includes the padding (the first version did); there is a test of equal
  heights.

## Not verified here

- Real Wikipedia and Commons answers (blocked): the field names come from WingDex's working code and the API documentation, the
  shapes are tested with mocks. If a photo never shows on the phone, look at the answer of
  `https://en.wikipedia.org/api/rest_v1/page/summary/Great_tit` and `thumbnailAtWidth` (500 px must be a width Wikimedia serves;
  the small picture is the fallback).
- Whether `upload.wikimedia.org` sends `Access-Control-Allow-Origin` for pictures (it did when this was written, from memory); the
  plain-request fallback covers it if not.
- Real phones: how the grid scrolls on a cheap Android, `content-visibility` before iOS 18 (older iPhones just render all cards),
  the on-screen keyboard with the search box, the tap targets with a thumb, the iPhone's safe areas.
- The Czech texts were written by me and read by nobody else; "Kde žije", the tips (by silhouette: water, owl, raptor, wader,
  songbird) and the cheering lines are the ones to read first.
- The demo catches use a pixel drawing of a songbird for every bird; it is a stand-in, not a real photo.
