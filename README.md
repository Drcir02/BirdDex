# BirdDex

A Pokédex for the birds of Czechia and Europe. Identify a bird by its sound or by a photo, confirm the catch, and fill your Dex. Everything runs on the phone: no accounts, no servers.

It is an installable web app (PWA), so the same code works on iPhone and Android. See [PLAN.md](PLAN.md) for the plan, the milestones, the licenses and the risks.

**Status:** milestone M0, the "Field check" page that tests microphone, camera, location, storage, offline start and model speed on a real phone.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests
npm run e2e          # end-to-end tests in Chromium with a fake microphone and camera
```

On the cloud machine, Chromium is preinstalled: `CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e`.

## Models

The bird models are not stored in git. `node scripts/fetch-models.mjs` downloads them into `public/models/` (BirdNET V2.4 from Zenodo and Hugging Face), and the deploy does the same before building. `scripts/make-test-models.py` builds two tiny models for the automatic tests.

## Deploy

The deploy workflow is `deploy/pages.yml`. It is not under `.github/workflows/` because the Claude GitHub App that pushes from the cloud session is not allowed to push workflow files. Switch it on once: in the GitHub web editor create `.github/workflows/pages.yml` with the content of `deploy/pages.yml`, then in the repo settings choose Pages, Source: GitHub Actions. After that every push to `main` builds, downloads the bird models and publishes the site. As an alternative, `scripts/deploy-gh-pages.sh` builds locally and publishes to the `gh-pages` branch (Pages, Source: Deploy from a branch).

## Licenses

- Code: not yet licensed, so all rights are reserved until the owner picks a license.
- BirdNET models: CC BY-NC-SA 4.0 (non-commercial, attribution, share-alike). Code: MIT. See https://github.com/birdnet-team/BirdNET-Analyzer.
- Photo model (WingCLIP): non-commercial. Bird photos: individual Creative Commons licenses with credits shown in the app.
