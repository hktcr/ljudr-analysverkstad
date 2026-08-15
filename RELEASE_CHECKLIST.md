# Releasechecklista för 1.0.0-rc.5

Status: offentlig valideringskandidat. Inte produktionsverifierad 1.0.

## Förverifiering 15 augusti 2026

- [x] Fixerad testsuite: 96 av 96 tester, inventering SHA-256 `fcb89013d2b4a458d92b2a199ede6ba94b17af0ebac73462e9635c748e615ec6`.
- [x] EBU Loudness Test Set v5.0: 68 av 68 krav för 62 relevanta filer.
- [x] ITU-R BS.2217-2: 19 av 19 relevanta filer inom +/-0,1 LKFS.
- [x] Syntaxkontroll och `git diff --check` godkända för rc.4.
- [x] Pagespaket innehåller 18 filer: 17 uttryckligen tillåtna resurser plus hashbundet buildmanifest.
- [x] Samtliga 18 publika resurser ger HTTP 200 från lokal server.
- [x] Inga spårade ljudfiler, rapporter, projekt, uppenbara hemligheter eller U+2013 hittas.
- [ ] Commit-, Actions-, artifact- och livekvitton fylls efter publicering.

## Lokal kandidat

- [ ] Varje releasefil är avsiktligt inkluderad och det publicerade GitHub-trädet matchar det lokalt beräknade trädet exakt.
- [x] Versionen `1.0.0-rc.5` är konsekvent i paket, app, workers, projekt, rapport, dokumentation, PWA-cache och validation-manifest.
- [x] Syntaxkontroll, hela fixerade testsuiten med 96 av 96 och `git diff --check` passerar.
- [x] EBU visar 68/68 och ITU visar 19/19 för exakt releasekod.
- [x] Build skapar endast den uttryckliga allowlisten och `build-manifest.json`.
- [x] Varje publik fil har SHA-256 i buildmanifestet.
- [x] Inga ljudfiler, projekt, rapporter, credentials, hemligheter eller U+2013 finns i releasepaketet.
- [x] Alla publicerade sökvägar är ASCII.
- [x] Privacy, metod, formatmatris och kända begränsningar motsvarar koden.
- [x] Schema 1 för exchange och guidance motsvarar dokumenterade fält, gränser och digestregler.

## Säkerhet och integritet

- [x] CSP blockerar tredjepartsanslutningar; statisk nätgranskning visar inga appinitierade tredjepartsanrop.
- [x] Full SHA-256, inte edge-hash, krävs innan sparad analys återanvänds.
- [x] Projektimport har schema-, typ-, storleks- och intervallvalidering.
- [x] Rapporten redigerar koordinater enligt Dold/Avrundad/Exakt.
- [x] OPFS partial tas bort vid fel/cancel; complete listas och rensas uttryckligen.
- [x] Cache, repo, Pages-artefakt och rapport saknar ljudsamplingar.
- [x] Minimal exchange saknar ljud, samples, waveform, spektrum, full källhash, filnamn, fria markertexter och koordinater.
- [x] Preview visar exakt exporterad JSON och export/import initierar ingen nättrafik.
- [x] Guidanceimport avvisar fel schema, bundle, digest, källa, edit, evidens, storlek, djup och farliga nycklar.
- [x] Osignerad guidance märks tydligt och inga råd tillämpas automatiskt.
- [x] Audit trail binder exchange, guidance, provenance och användarens accept/reject utan att påstå avsändarbevis.

## GitHub och Pages

- [x] Repo är publikt på `https://github.com/hktcr/ljudr-analysverkstad` med `main` som standardgren.
- [x] Actions är pinnade till granskade fulla commit-SHA.
- [x] Checkout använder `persist-credentials: false`.
- [x] Test/build och deploy har separata jobb och minsta rättigheter.
- [ ] Spara releasecommit, tree-id, Actions run-id, artifact digest och tidsstämplar.
- [ ] GitHub `main` och buildmanifestets commit är exakt releasecommitten.
- [x] Pages använder GitHub Actions.
- [x] Appskalet använder nät först när nät finns, cache endast som reserv och `updateViaCache: none` för service workern.
- [x] Automatisk aktivering och omladdning blockeras av osparat arbete eller pågående workerjobb.
- [ ] Liveversionen på `https://hktcr.github.io/ljudr-analysverkstad/` visar `1.0.0-rc.5` och matchar releasecommitten.

## Live smoke

- [ ] Bred och smal layout, Safari och aktuell Chromium.
- [ ] Konsol och nätlogg utan oväntade fel.
- [ ] Öppna, analysera, adaptiv zoom, markörer, preview och monitor routing.
- [ ] Sample-payload-identiskt trimutdrag verifieras med hash.
- [ ] Redigerad WAV-master återöppnas och får verifierade signalmått/containerdata.
- [ ] Projekt sparas, migreras, öppnas och matchas med full källhash.
- [ ] HTML/JSON innehåller Källfil, Beräknat exporturval och Verifierad exportfil.
- [ ] Minimal exchange preview och nedladdning är identiska och saknar förbjudna fält.
- [ ] Matchande guidance importeras som `unreviewed`; felaktig och gammal guidance avvisas.
- [ ] Accept/reject loggas och faktisk edit kräver ett separat uttryckligt val.
- [ ] Offline cold start och update från föregående cacheversion.
- [ ] Inga ljudbytes finns i Cache Storage eller nättrafik.

## RC-kvitto

- Releaseversion: `1.0.0-rc.5`
- Releasecommit: _fylls efter commit_
- Tree-id: _fylls efter commit_
- Actions run-id: _fylls efter grön körning_
- Artifact digest: _fylls efter grön körning_
- Pages-URL: `https://hktcr.github.io/ljudr-analysverkstad/`
- Buildmanifest SHA-256: _fylls efter bygg från releasecommit_
- Livekontroll: _fylls efter publicering_
- Fixerad testsuite: `96/96`, inventory SHA-256 `fcb89013d2b4a458d92b2a199ede6ba94b17af0ebac73462e9635c748e615ec6`
- EBU/ITU: `68/68 respektive 19/19`
- Validation-manifest SHA-256: `fc6e8f2152bd331ed29e8f3e51437008a29d969c99125a074e9202055b2423c7`
- Status: `GO för commit och publicering som publik valideringskandidat`; deploy- och livekvitton återstår.

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
