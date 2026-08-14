# Releasechecklista för 1.0.0-rc.1

Status: offentlig valideringskandidat. Inte produktionsverifierad 1.0.

## Förverifiering 15 augusti 2026

- [x] Fixerad testsuite: 72 av 72 godkända, 0 fel.
- [x] EBU Loudness Test Set v5.0: 68 av 68 krav för 62 relevanta filer.
- [x] ITU-R BS.2217-2: 19 av 19 relevanta filer inom +/-0,1 LKFS.
- [x] Syntaxkontroll och `git diff --check` godkända.
- [x] Pagespaket: 17 tillåtna filer, varav buildmanifestet binder de övriga 16 med SHA-256.
- [x] Samtliga 17 resurser gav HTTP 200 från lokal server.
- [x] Inga spårade ljudfiler, rapporter, projekt, uppenbara hemligheter eller U+2013 hittades.
- [ ] Kandidaten är ännu inte releasecommittad; commit-, Actions-, artifact- och livekvitton återstår.

## Lokal kandidat

- [ ] Arbetskatalogen är ren och varje releasefil är avsiktligt inkluderad.
- [x] Versionen `1.0.0-rc.1` är konsekvent i paket, app, workers, projekt, rapport, dokumentation, PWA-cache och validation-manifest.
- [x] Syntaxkommandona i `npm run check`, hela fixerade testsuiten och `git diff --check` passerar.
- [x] EBU visar 68/68 och ITU visar 19/19 för exakt releasekod.
- [x] Build skapar endast den uttryckliga allowlisten och `build-manifest.json`.
- [x] Varje publik fil har SHA-256 i buildmanifestet.
- [x] Inga ljudfiler, projekt, rapporter, credentials, hemligheter eller U+2013 finns i releasepaketet.
- [x] Alla publicerade sökvägar är ASCII.
- [x] Privacy, metod, formatmatris och kända begränsningar motsvarar koden.

## Säkerhet och integritet

- [x] CSP blockerar tredjepartsanslutningar; statisk nätgranskning visar inga appinitierade tredjepartsanrop.
- [x] Full SHA-256, inte edge-hash, krävs innan sparad analys återanvänds.
- [x] Projektimport har schema-, typ-, storleks- och intervallvalidering.
- [x] Rapporten redigerar koordinater enligt Dold/Avrundad/Exakt.
- [x] OPFS partial tas bort vid fel/cancel; complete listas och rensas uttryckligen.
- [x] Cache, repo, Pages-artefakt och rapport saknar ljudsamplingar.

## GitHub och Pages

- [ ] Repo är publikt på `https://github.com/hktcr/ljudr-analysverkstad` med `main` som standardgren.
- [x] Actions är pinnade till granskade fulla commit-SHA.
- [x] Checkout använder `persist-credentials: false`.
- [x] Test/build och deploy har separata jobb och minsta rättigheter.
- [ ] Spara lokal commit, tree-id, tagg, Actions run-id, artifact digest och tidsstämplar.
- [ ] GitHub `main` och buildmanifestets commit är exakt lokal releasecommit.
- [ ] Pages använder GitHub Actions och deployjobbet anger slutlig URL.
- [ ] Liveversionen på `https://hktcr.github.io/ljudr-analysverkstad/` matchar releasecommit.

## Live smoke

- [ ] Bred och smal layout, Safari och aktuell Chromium.
- [ ] Konsol och nätlogg utan oväntade fel.
- [ ] Öppna, analysera, adaptiv zoom, markörer, preview och monitor routing.
- [ ] Sample-payload-identiskt trimutdrag verifieras med hash.
- [ ] Redigerad WAV-master återöppnas och får verifierade signalmått/containerdata.
- [ ] Projekt sparas, migreras, öppnas och matchas med full källhash.
- [ ] HTML/JSON innehåller Källfil, Beräknat exporturval och Verifierad exportfil.
- [ ] Offline cold start och update från föregående cacheversion.
- [ ] Inga ljudbytes finns i Cache Storage eller nättrafik.

## RC-kvitto

- Releaseversion: `1.0.0-rc.1`
- Releasecommit: _fylls efter commit_
- Tree-id: _fylls efter commit_
- Actions run-id: _fylls efter grön körning_
- Artifact digest: _fylls efter grön körning_
- Pages-URL: _fylls från deploysteget_
- Buildmanifest SHA-256: _fylls efter bygg_
- Fixerad testsuite: `72/72, 0 fel`
- EBU/ITU: `68/68 respektive 19/19`
- Status: `publik valideringskandidat`

## Produktionsport för 1.0.0

Versionsnumret `1.0.0` är förbjudet tills samtliga punkter nedan är verifierade och dokumenterade:

- [ ] Noll öppna P0/P1-fel.
- [ ] Fysisk 15 till 20 min stereo float32/96 kHz nära 1 GB på dokumenterad faktisk iPad Pro/iPadOS.
- [ ] Hela flödet i både Safari och installerad PWA.
- [ ] Export till Filer, återöppning, outputhash och sample-payload-hash.
- [ ] Bakgrund/återgång, quota, cancel, partial-cleanup och complete-rensning.
- [ ] Kall offline-start och kontrollerad PWA-uppdatering.
- [ ] Manuell VoiceOver, externt tangentbord, 200/400 procent, kontrast och reduced motion.
- [ ] EBU 68/68, ITU 19/19 och hela fixerade testsuiten mot finala bytes.
- [ ] Ren taggad commit, grön pinned Actions-körning och livekontroll mot exakt commit.

RC-resultat får endast återanvändas för oförändrade bytes. Efter varje kodändring körs berörda och samtliga releasekritiska kontroller om.
