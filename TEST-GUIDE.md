# BirdDex test guide

For the owner. Plain, short, practical. Everything below has been tested on a desktop computer (Chromium) with the real bird models, but **not yet on a real phone**. You are the first to try it there.

## (a) What exists now

- A bird Dex with **423 European species, 276 of them seen in Czechia**, with Czech names, scientific names, rarity and silhouettes for birds you have not caught yet. Filters (All, Czechia, Europe, Caught, Not yet), search and sorting.
- **Sound scan**: the phone listens, shows a level meter and a live top 3 (BirdNET V2.4, running on the phone).
- **Photo scan**: take a photo or pick one from the camera roll, optional crop, top 3 (WingCLIP, on the phone).
- **Live camera**: point at a bird, it locks on, then you can catch it.
- **Catching**: the Catch button only works above a confidence threshold and only after you confirm. A catch saves date, place, and the photo or sound clip.
- Settings (sensitivity, sounds, storage, backup and restore, erase), a credits page, a welcome tour, and a **Field check** page for diagnosing the phone.
- Works offline after the first start and the model download. No accounts, no server, no tracking. All texts are in Czech.

## (b) How to get and refresh the app

The app is live at **https://drcir02.github.io/BirdDex/** and rebuilds by itself after every push to `main`. A rebuild takes about 4 to 5 minutes. Progress is under the **Actions** tab of the repo (https://github.com/Drcir02/BirdDex/actions); a green tick means the new version is live.

**iPhone**
1. Open the link in **Safari** (not in another browser).
2. Tap **Share** (square with an arrow), then **Add to Home Screen**.
3. From now on use **only the new icon**. The installed app has its own storage, separate from Safari, so the bird models (about 90 MB) must be downloaded inside it, on Wi-Fi.

**Android**: open the link in Chrome, menu (three dots), **Install app**.

**Updates**
- The app updates itself the next time it is opened with internet. A banner "Je tu nová verze BirdDexu." with a reload button can appear (never in the middle of a scan or a download).
- If a change does not show: close the app completely (swipe it away in the app switcher) and open it again, with internet.
- Last resort: delete the icon and add it again. **This also deletes the app data** (catches and downloaded models), so make a backup first (Settings, Záloha).

## (c) Test checklist for the iPhone

Use the home-screen icon unless a step says otherwise. Note which step number fails.

1. **Welcome screen.** Open the app for the first time. You see "Vítej v BirdDex" with 4 steps. Tap **Dál** through them (idea, what is downloaded, permissions, install hint). On the permission step, tapping **Povolit** next to Mikrofon, Fotoaparát or Poloha should show the iPhone question. At the end tap **Začít**. You land in the Dex. (Settings has "Znovu ukázat úvod" to replay it.)
2. **Model download on Wi-Fi.** Tap **Skenovat** at the bottom, then **Poslouchat**. A card "Ptačí mozek" offers **Stáhnout ptačí mozek** (about 90 MB). Tap it, keep the app open and the screen on. A progress bar counts MB. It ends with "Ptačí mozek je připravený. Funguje i bez internetu." Try the same with Wi-Fi switched off halfway: you should get a calm message and a retry button, and the download should continue where it stopped.
3. **Dex browsing and filters.** Tap **Dex**. Scroll the grid (silhouettes). Tap **Česko**, then **Evropa**: the number of birds changes (276 and 423). Type a name such as "sýkora" into the search. Change the sorting (Číslo, Název, Vzácnost). Tap a bird: the species page opens (photo from Wikipedia needs internet, a drawn fallback appears without it). Go back.
4. **Sound scan with a recording played from another device.** Play a bird song at normal volume from a computer or another phone, 20 to 30 cm from the iPhone (for example search "Lesser Redpoll song" or a common local bird such as Great Tit or Blackbird). Tap **Skenovat**, **Poslouchat**, **Začít poslouchat**, and allow the microphone. You should see the level meter move and "Co slyším" with a top 3 appearing within a few seconds. Tap **Hotovo**. The result screen shows the top 3 and, if the best guess is confident enough, an active **Chytit** button.
5. **Outdoor sound scan.** Same as step 4 outdoors, early morning if possible, as close to a singing bird as you can get, at least 10 to 20 seconds. Notice false alarms (a bird named when nothing sings), missed birds and wrong names. Write down what you heard against what the app said.
6. **Photo from the camera roll.** **Skenovat**, **Vyfotit nebo z galerie**, **Vybrat z galerie**, pick a photo of a bird (or a bird picture on a screen). Optionally drag the crop frame. Tap **Určit**. A top 3 appears.
7. **Photo taken with the camera.** Same screen, tap **Vyfotit**, take a photo of a bird or a picture of one, confirm, then **Určit**. (The iPhone may ask for camera permission. If the photo comes out as HEIC and the app complains, tell me.)
8. **Live camera and zoom.** **Skenovat**, **Živá kamera**, **Zapnout kameru**. The camera now fills the whole screen (the cross at the top left switches it off). Point it at a bird picture on a screen or a real bird. The text "Hledám ptáka…" should turn into "Mám ho na mušce!" and **Chytit** unlocks. **Zoom** for a bird that is far away: spread two fingers on the picture, or tap **2×**, **3×**, **5×** at the bottom; with one finger drag the zoomed picture to move it; the number at the top right shows the zoom. Zoom until the bird is big in the middle, then hold still: the app looks at exactly what you see, and the photo saved with the catch is the zoomed part too. Zooming lets go of the lock, so it needs a second to lock on again. **The camera catches by itself:** as soon as the guess is above the percentage of your sensitivity (Settings), it takes the picture, saves the catch and shows the celebration, so you don't have to tap at the right moment (you can delete a wrong catch on the bird's page in the Dex). The **Chytit** button stays for catching by hand, and Settings has a switch to turn the automatic catch off. Try it in the home-screen app AND in Safari; the camera can stall in home-screen mode (see section f).
9. **Catch confirmation.** On any result screen with an active **Chytit**, tap it. A question says what will be saved ("Uložím ho i s datem, místem a ..."). Tap **Ještě ne** once to check that nothing is saved, then **Chytit** again and confirm. You should see a short celebration and "Nový druh v tvém Dexu!". Try an uncertain result too (a low percentage): the card says why the app is unsure, but **Chytit** still works; the question then adds that the app is not sure and that you decide.
10. **Caught details.** Tap **Zobrazit v Dexu**. The caught bird now has its picture instead of a silhouette. Open it: you should see the date, the place name (needs internet at the moment of catching; otherwise only coordinates), and the saved photo or a playable sound clip. Play the clip.
11. **Settings.** Tap **Nastavení**. Check the trainer card (counts), **Citlivost** (Přísná, Normální, Snadná; the Catch threshold changes), sounds on and off, storage info and the list of downloaded models, and **O aplikaci** (credits and licences).
12. **Backup and restore.** Settings, **Záloha**, **Zálohovat**. A share sheet should offer to save a `.zip` (to Files or iCloud). Then (carefully, with a backup in hand) **Smazat vše** and its two confirmations, and afterwards **Obnovit ze zálohy** and pick the file: your catches, photos and clips come back.
13. **Offline start in airplane mode.** With the models already downloaded and the app opened at least once with internet, close the app completely, switch on airplane mode, open the home-screen icon. The Dex opens, species pages work, and a sound scan and a photo scan still identify birds (Wikipedia photos and place names are not available offline, which is fine).
14. **Field check report.** Open **https://drcir02.github.io/BirdDex/#/field-check** (in the installed app: Settings, tap the version line at the bottom 7 times, then the new "Zkouška telefonu" button appears). Run the cards from top to bottom, then press **Copy report** at the bottom and paste it into the chat.

## (d) What to report back

- The **step number** that failed and what you saw instead of what was described. One line is enough.
- A **screenshot** of any error message or odd screen (iPhone: side button and volume up).
- Whether you used Safari or the home-screen icon, and your iPhone model and iOS version.
- The **Field check report** (step 14), pasted as text.
- For sound and photo scans: what the bird really was, what the app said, and the percentage.

## (e) Known limitations and what could not be verified

- **Never run on a real phone.** Everything was tested in desktop Chromium on a cloud machine with fake microphone and camera. iPhone Safari, the home-screen app and Android Chrome are untested.
- **Real birds are untested.** The models were checked on two test recordings and a few test photos only. How well it recognises Czech garden birds in real conditions (wind, traffic, distance) is unknown. The catch thresholds are starting values and will probably need tuning from your results.
- **Wikipedia photos and place names** (OpenStreetMap) are blocked on the build machine, so they were only tested with mock answers. If a photo is missing or a link is wrong, report it.
- **Speed.** Model speed on a phone is unknown. The photo model runs on the CPU only (no WebGPU), and the first start of a scan can take several seconds.
- **Updates in the field.** The update banner when a new version is deployed while the app is open was tested only in a simulation.
- **Share sheet, install prompt, sound unlocking** on iOS were not testable here.
- **Zoom of the live camera** was tested in desktop Chromium with a pretend camera and two-finger touch events. On a real iPhone the zoom is digital (the picture is enlarged: how smooth the pinch feels and how sharp it is at 5× is unknown). On Android Chrome the camera's own zoom is used when the phone offers it, with the digital zoom as the fallback; that was only tested with a pretend camera.
- **Accents in the pixel-style headings.** The pixel font may show "Nastaveni" without the hooks and accents. A design decision is open.
- No code licence yet (all rights reserved until you pick one). The bird models are for non-commercial use (CC BY-NC-SA 4.0, CC BY-NC 4.0).
- Android APK packaging (milestone M7) was not done; the web app installs from Chrome.

## (f) The five most likely problems on a real iPhone, and the fallback

1. **Camera does not work or stalls in the home-screen app.** Fallback: use **Vyfotit** (the system camera) instead of Živá kamera, or open the app in Safari instead of from the icon. Also try: close the app completely and open it again.
2. **Microphone permission is refused or asked every time.** Fallback: in Safari tap **aA** in the address bar, **Nastavení webu**, set Mikrofon to Povolit, reload. For the home-screen app: close and reopen it and tap Povolit when asked; if it stays blocked, Settings of the iPhone, Safari, Microphone. The app shows these steps in Czech too.
3. **Storage: the models disappear or the download fails.** iOS can clear website data of apps that are not used for a long time, or when the phone is nearly full. Fallback: free some space (the models are about 90 MB), tap **Stáhnout ptačí mozek** again; in Settings, Úložiště, you can see what is stored. Make backups regularly.
4. **The models are slow or the app reloads during a scan (memory).** Fallback: close other apps, start with the sound scan, wait a little at the first start. If the app restarts when you open the photo scan, tell me your iPhone model; I can reduce the picture size.
5. **Recording level too low, or nothing is recognised.** Fallback: bring the phone closer (10 to 20 cm from a speaker, a few steps from a real bird), turn the other device's volume up, listen for at least 10 seconds, keep out of wind, and remove thick cases that cover the microphone (bottom edge). If the level meter does not move at all, the microphone is blocked (see 2). In Settings, **Snadná** lets weaker results be caught.

## (g) Where the Czech texts live

All visible texts are in **`src/i18n/cs/`**, one file per area:

- `common.ts` (buttons, navigation, shared messages), `dex.ts` (Dex, filters, species page, caught details), `scan.ts` (sound, photo, live camera, errors), `result.ts` (result screen, catch confirmation), `settings.ts` (settings, backup, erase), `onboarding.ts` (welcome tour), `about.ts` (credits and licences), `fun.ts` (celebrations).
- `index.ts` joins them. Edit the text between the quotes and keep `{placeholders}` such as `{count}` exactly as they are. Czech plural forms are in the same files (for example `birds: one, few, many`).
- The app name is one constant in `src/app/constants.ts`.
