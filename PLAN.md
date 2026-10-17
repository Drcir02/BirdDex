# BirdDex: plan (draft 1)

A Pokédex for the birds of Czechia and Europe. You point your phone at a bird, or let it listen. The app guesses the species, you confirm the "catch", and the bird goes into your Dex.

"BirdDex" is a placeholder name.

## 0. Decisions

Decided:
1. **Approach:** installable web app (section 2).
2. **Repo:** public GitHub repo, so GitHub Pages hosting is free.
3. **Language:** Czech only. The UI is in Czech, and birds are shown by Czech name plus scientific name. If BirdNET has no Czech name for a species, the scientific name is shown alone.
4. **Gift recipient:** Android phone. You test on your iPhone, and the final check should also happen on an Android phone (risk 10).

Still needed from you: the one-time setup in section 8.

## 1. How you get and test the app

- I build on a temporary cloud computer and push the code to your GitHub repo after every milestone.
- GitHub builds it and publishes it at a link like `https://<your-github-name>.github.io/<repo-name>/` (for yours: `https://drcir02.github.io/BirdDex/`).
- **iPhone:** open the link in Safari, tap Share, then Add to Home Screen. It gets its own icon, opens full-screen, and works offline once the models are downloaded.
- **Android (the recipient's phone):** open the link in Chrome and tap Install app.
- The person you give it to only needs the link.
- When I publish a new milestone, the installed app updates itself the next time it opens online.

## 2. The big decision: web app or native app

"Installable web app" (PWA) means one codebase that runs in the phone's browser engine but is installed to the home screen like an app.

| | Installable web app (recommended) | Native app (Flutter or React Native) |
|---|---|---|
| iPhone with no Mac and no Apple developer account | Works. No expiry. | Needs a Mac to build, so I would use a cloud Mac. You then install it from your PC with a free Apple ID. It stops opening after 7 days until you reinstall it, and a free Apple ID allows 3 such apps at a time. |
| Android | Works (Chrome, Install app). | Possible, but I cannot build it here until Google's Android SDK host is allowed on this machine. |
| Can I test it before you do? | Yes. I can run it here in a headless browser with a fake microphone that plays real bird recordings. Only Chromium is installed here, so Safari-only problems show up on your iPhone. | No. There is no emulator or phone here, so every build would be blind. |
| Updates | I push, it is live in about a minute. | Rebuild and reinstall. |
| As a gift | Send a link. | iPhone needs re-signing from a computer every week. |
| Downsides | Not in the App Store. iOS limits web apps: no recording while the screen is locked, no vibration, and possibly more permission prompts for mic, camera and location (we test this first). Models run somewhat slower than native code. In rare cases iOS can clear a web app's storage, so the app gets a backup and restore button. | Everything in the first three rows. |

I recommend the web app because of your setup: an iPhone, a PC, no Mac and no Apple developer account. If you would rather have a native app anyway, say so and I will re-plan for that. The same web code can later be wrapped into a real Android app with Capacitor, and into an iPhone app if you ever get a Mac or an Apple developer account.

## 3. Tech stack (all free and open source)

| Part | Choice | Notes |
|---|---|---|
| App | TypeScript, React, Vite, installable PWA with offline support | Mainstream tools, easy for anyone to maintain later. |
| Storage | IndexedDB (via Dexie), plus a backup file you can export and import | You suggested SQLite. In a browser the built-in equivalent is IndexedDB. Real SQLite in the browser is possible but adds weight and iOS storage quirks for no benefit here. The storage layer sits behind one small interface, so it can be swapped. |
| Sound ID | BirdNET V2.4 (TFLite) run by LiteRT.js, Google's official TFLite runtime for the web | BirdNET already runs in browsers (Cornell's demo uses TensorFlow.js), so the idea is proven. LiteRT.js is the official way to run the TFLite file itself. Fallback: ONNX Runtime Web with an ONNX conversion of the same model. M0 measures both on your iPhone and picks one. |
| Photo and camera ID | WingCLIP-0.3 (39M parameters, distilled from BioCLIP 2) run by ONNX Runtime Web | The open-source WingDex app already runs it in a browser, with a model download of about 53 MB. We only compare against European species. |
| Species data | BirdNET labels and location model, Wikimedia Commons photos | Section 5. |
| Tests | Vitest, Playwright with Chromium | Real bird recordings fed through a fake microphone. |
| Hosting | GitHub Pages, built by GitHub Actions | Free for public repos. |

I picked BirdNET V2.4 over the newer V3.0 preview because V2.4 is the stable, widely tested release. V3.0 can be tried later behind the same code.

## 4. How identification works

**Sound**
- Microphone audio is converted to 48 kHz mono. Every second, the last 3 seconds go to BirdNET, because that is its input size.
- Only European species are scored, a few hundred instead of BirdNET's 6,522. BirdNET's own location model (latitude, longitude, week of the year) lowers species that do not occur near you at this time of year.
- A bird counts only when the same species wins in at least 2 consecutive windows. The live top 3 is shown while listening.
- Starting catch threshold: 70%. Settings offer Strict, Normal and Easy.

**Photo and live camera**
- A photo (taken or picked) or a camera frame (about 1 per second) is cropped and resized, turned into an embedding by WingCLIP, and compared with the embedding of each European species. The result is the top 3 with percentages.
- Live camera shows a "lock-on" when the same species is first for 3 frames in a row.
- Starting catch threshold: 60%, and clearly ahead of the second guess.
- Stretch goal: a tiny bird detector to auto-crop small, distant birds, because tiny subjects are the hardest case.

**Both**
- The results screen shows the top 3 with confidence and a reference photo of each.
- The Catch button is enabled only for a guess above the threshold. Pressing it asks for confirmation.
- A catch saves the date, place (if you allow location), confidence, method, and the photo or audio clip.
- The numbers above are starting values. BirdNET scores are not true probabilities, so I will tune the thresholds with real recordings and photos in M3 and M4.

**Honest expectations:** loud, clear song gives good results. Distant, noisy or overlapping birds are weak. Photo ID struggles with tiny, blurry or look-alike birds. That is why every catch needs your confirmation.

## 5. The Dex data (Czech and European birds)

- **Species set:** every species in BirdNET V2.4 that its location model says occurs in Europe. Each species is flagged "Czechia" if it occurs there. A script builds the list, then I sanity-check it. Expect a few hundred up to about 650 species. The exact number comes in M1.
- **Names:** Czech name plus scientific name, both from BirdNET's label files (they include Czech).
- **Photos:** one freely licensed photo per species from Wikimedia Commons, with author and license shown in the app.
- **Rarity tiers** (Common to Legendary) derived from the location model.
- **Dex features:** filters All, Czechia, Europe and Caught, Not yet. Search. Sort by number, name, family or rarity.
- **Caught entries show:** first-catch date, place, saved photo or audio clip, and how many times you saw it again.
- **Privacy:** everything runs on the phone. No accounts, no analytics. The network is used only to download the app and models once, and optionally to look up a place name.

## 6. UI concept (Pokédex-inspired, original art)

- A handheld-device look: red shell, glossy blue lens button, LED lights, a green LCD scanner screen, chunky buttons, pixel-style fonts under open licenses.
- Dex numbers (#001 and up). Unknown birds are silhouettes that turn to colour on catch, with a "NEW!" flash.
- A catch animation with sounds made in code (so no sound-licensing issues), rarity stars, and a progress ring such as "142 / 418 caught".
- Czech UI only. I write the Czech text, and I will ask you to check it for natural wording when you see M2.
- No Nintendo or Pokémon names, logos or art.

## 7. Milestones: I build, you test, you give feedback

Each milestone ends with a deployed link and exact test steps. I do not start the next one until you reply.

**M0. Foundations and iPhone field check**
- I build: repo and automatic deploy, a minimal installable app, and a "Field check" page that tests the risky iPhone parts.
- You test: add it to your home screen, then run the Field check. It covers microphone (level meter, record and play back), camera (live preview in home-screen mode and photo capture), location, storing a 150 MB file and surviving a restart and airplane mode, and the speed of the real models. Send me the report screen.
- Done when every check passes, or we know the fallback for the ones that fail.

**M1. Species data**
- I build: the Europe and Czechia species list, with English and Czech names, photos, credits and rarity.
- You test: a "Data check" page. Look up about 10 birds you know, and tell me what is missing or wrong.

**M2. Dex and storage**
- I build: the Pokédex-style shell, the Dex grid and list with filters and search, species pages, the caught state, and a demo-data switch so you can see caught entries.
- You test: browse and filter on your iPhone, and give design feedback.

**M3. Sound ID**
- I build: record, identify on the phone, live top 3, the results screen with threshold and confirmation, and saving the catch with its audio clip, date and place.
- You test: play bird recordings from a computer near the phone, then try outdoors. Tell me about wrong IDs, false alarms in silence, speed and battery.

**M4. Photo ID**
- I build: take or pick a photo, top 3, results screen, confirm, and save the photo.
- You test: photos from your camera roll and pictures of birds on a screen.

**M5. Live camera ID**
- I build: continuous scanning with lock-on, picking the best frame, and the optional auto-crop.
- You test: point at a screen, a poster, or real birds.

**M6. Fun and polish**
- I build: animations and sounds, stats and progress, settings, backup and restore, an offline check, onboarding, and the app icon.
- You test: a full run-through, as if you were the recipient.

**M7. Gift packaging**
- I build: a final QA pass, a credits and licenses screen, a one-page Czech "how to install" guide for the recipient (Chrome, Install app), and an optional personal message or name on the trainer card. Optionally a real Android app file (APK, made with Capacitor) if you would rather hand over a file than a link.
- You test: a final check on a fresh install, ideally on an Android phone (risk 10).

## 8. One-time setup (you)

1. **GitHub:** make a free account if you do not have one. Create a new **public** repository, for example `birddex`, completely empty (no README, no license).
2. **Connect GitHub to Claude** at https://claude.ai/connect-github, and install the Claude GitHub App on that repository.
3. **Allow websites on the cloud machine.** Open the cloud environment menu in this session's title bar, choose Edit, then Network access. Either pick a broader level, or add these hosts under Allowed domains and keep "Allow package managers" ticked:
   - `zenodo.org` (BirdNET models)
   - `huggingface.co`, `cdn-lfs.huggingface.co`, `cdn-lfs-us-1.hf.co`, `cas-bridge.xethub.hf.co` (WingCLIP model)
   - `commons.wikimedia.org`, `upload.wikimedia.org`, `en.wikipedia.org`, `cs.wikipedia.org`, `www.wikidata.org`, `api.wikimedia.org` (photos, Czech names)
   - `xeno-canto.org` (test recordings, optional)
   - `github.com` (model and data downloads)
4. **Tell me the repo name.** I will try to attach it to this session. If that is refused, start a new session with the repo selected and attach this PLAN.md.
5. **After my first push:** in the repo, go to Settings, then Pages, then Source, and choose GitHub Actions. This is one click. (If I have to use the `gh-pages` branch instead, see risk 9; the choice there is "Deploy from a branch", branch `gh-pages`.)

## 9. Licenses

| Thing | License | What it means for you |
|---|---|---|
| BirdNET models (V2.4) | CC BY-NC-SA 4.0 | Free for personal and educational use with credit. No selling, ads or paid features. A converted model must keep the same license. |
| BirdNET code | MIT | No restrictions of note. |
| WingCLIP weights | CC BY-NC 4.0 according to a search summary of its model card. I could not open the card from this machine, so I will re-check. | Non-commercial, like BirdNET. Trained on iNaturalist photos. |
| WingDex code (reference) | MIT | Fine to learn from. Credit it if code is reused. |
| BioCLIP 2 (teacher model, not shipped) | MIT | None. |
| Bird photos (Wikimedia Commons) | Per photo: CC0, CC BY or CC BY-SA | Author and license are shown in the app and on a credits screen. I only use photos under those licenses. |
| React, Vite, Dexie, LiteRT.js, ONNX Runtime Web | MIT or Apache-2.0 | No restrictions. |
| Fonts | SIL OFL | Free to embed. |
| Pokémon names, logos, art | Nintendo trademarks | Not used. Original design only. |

You said license limits are fine for personal use. If you ever want to sell the app, or publish it on the App Store with ads or purchases, the BirdNET and WingCLIP models would have to be replaced or licensed.

## 10. Risks and how I handle them

1. **iPhone quirks of home-screen web apps.** A WebKit bug report describes the camera stalling in home-screen mode on iOS 17.4.1. I do not know if it still happens. M0 tests it first. Fallbacks: the phone's own camera picker for photos, and running in a Safari tab for live camera.
2. **Accuracy.** Far, noisy or tiny birds are hard. I use European-only label sets, the location filter, smoothing over time, thresholds and your confirmation, and I tune them in M3 and M4.
3. **Download size.** About 100 to 150 MB on first run (two models plus photos). The app shows progress, asks you to use Wi-Fi, and then works offline.
4. **I cannot run Safari or an iPhone here.** I test in Chromium first, then you test every milestone on the iPhone.
5. **Model hosting.** Models come from Zenodo and Hugging Face. I record checksums and keep a copy in the build so a host outage does not break the app.
6. **iOS clearing web storage.** Backup and restore, plus a reminder.
7. **Photo licensing.** Credits are stored with every image.
8. **GitHub free-tier limits.** Pages has soft limits (about 1 GB site size, 100 GB/month traffic), which is plenty for a gift.
9. **GitHub may refuse build-workflow files pushed by me.** Apps often need an extra permission to change files under `.github/workflows`. If that happens, I build the app here and push the finished files to a branch called `gh-pages`, which needs no workflow. As a second option, I give you the single workflow file to paste into the repo in your browser, once.
10. **No Android phone to test on.** You have an iPhone, but the gift goes to an Android phone. Chrome on Android is the best-supported place for installed web apps, and I test in Chromium here, but real-device checks still matter (camera, microphone and speed differ per phone). Please plan to borrow an Android phone for about 15 minutes around M3 and again at M7.
11. **Czech wording.** I write the Czech UI text. A native reader should skim it for natural phrasing, and bird names come from BirdNET's Czech labels, which I will spot-check.

## 11. Not in version 1

Accounts and cloud sync, sharing and social features, non-European birds, separating several overlapping birds in one recording, background listening, widgets, and App Store release.

## Sources

- BirdNET library and licenses: https://github.com/birdnet-team/birdnet and https://github.com/birdnet-team/BirdNET-Analyzer
- BirdNET V2.4 model files (Zenodo): https://zenodo.org/records/15050749
- BirdNET running in a browser (Cornell demo): https://birdnet.cornell.edu/demo/
- WingDex (WingCLIP in a browser): https://github.com/jlian/wingdex
- WingCLIP model card: https://huggingface.co/johnlian/WingCLIP
- BioCLIP 2 (MIT): https://huggingface.co/imageomics/bioclip-2
- LiteRT.js: https://developers.google.com/edge/litert/web/index and the `@litertjs/core` package on npm
- iPhone sideloading limits (7 days, 3 apps): https://faq.altstore.io/altstore-world/your-altstore
- WebKit bug on camera in home-screen mode: https://bugs.webkit.org/show_bug.cgi?id=273938
- Home-screen web apps and the 7-day storage rule: https://developer.apple.com/forums/thread/710157
- GitHub Pages availability by plan: https://help.github.com/articles/what-is-github-pages
