# Releasechecklista

Denna fil beskriver verifieringskedjan för LjudR Analysverkstad. En release är färdig först när både den lokala MASTER-versionen, GitHub-repot och den publika GitHub Pages-versionen har kontrollerats.

## Status före publicering

Kontrollerat lokalt den 14 augusti 2026:

- [x] 39 av 39 automatiska tester godkända, inklusive 35 funktions- och regressionstester samt 4 särskilda releaseprov.
- [x] Syntaxkontroll godkänd för app, WAV-motor, DSP-motor, workers, projektmodul och service worker.
- [x] Samtliga resurser i appskalet svarar med HTTP 200 från lokal webbserver.
- [x] PWA-ikonerna är giltiga PNG-filer i 192 x 192 och 512 x 512 bildpunkter.
- [x] Alla publicerade sökvägar använder ASCII-tecken.
- [x] Releaseversionen 0.10.0 är bekräftad i paketdata, projektmodul, DSP-motor, exportmotor, service worker och dokumentation.
- [x] CSP blockerar externa anslutningar genom `connect-src 'none'`.
- [x] Inga externa script, typsnitt, spårare eller analysverktyg används.
- [x] Inga ljudfiler ingår i den återställda källan.
- [x] Slutkontrollerna nedan har körts mot den färdiga arbetskopian före commit.

Återställd basartefakt från version 0.9.0:

- Fil: `LjudR-Analysverkstad-MASTER-v0.9.0.zip`
- SHA-256: `f59bdcc34baaa0a830034d826032320d298480bd514017b71f0c8c9c31455c8d`
- Arkivkommentar med tidigare commit-id: `e882588b2e3ce26b8400f7a210d737f4a68f5020`

Basartefakten är endast proveniens. Om någon fil ändras ska en ny releaseartefakt skapas och få ett nytt SHA-256-värde.

## Lokal releasekontroll

- [x] Bekräfta att arbetskatalogen är rätt repo.
- [x] Granska `git status --short` och redovisa varje fil som ska ingå.
- [x] Kör samtliga syntaxkontroller som workflowen använder.
- [x] Kör `node --test tests/*.test.mjs`.
- [x] Bekräfta att testresultatet visar noll fel.
- [x] Starta en lokal HTTP-server och kontrollera `index.html`, CSS, manifest, service worker, ikoner och samtliga JavaScript-moduler.
- [x] Bekräfta att arbetskopian och stagingpaketet saknar ljudfiler, projektfiler och analysrapporter, oavsett skiftläge.
- [x] Bekräfta efter releasecommit att ingen sådan fil är spårad av Git.
- [x] Bekräfta att inga nycklar, tokens, lösenord eller lokala projektdata finns i arbetskopian eller stagingpaketet.
- [x] Bekräfta att alla publicerade filnamn kan kodas som ASCII.
- [x] Bekräfta att ingen textfil innehåller U+2013.
- [x] Bekräfta att `.nojekyll` finns i källrepot.
- [x] Bekräfta att `manifest.webmanifest` har relativ `start_url` och relativt `scope`.
- [x] Bekräfta att service workerns cache-id innehåller aktuellt versionsnummer.
- [x] Bekräfta att service workerns lista endast pekar på filer som finns.
- [x] Bekräfta att README, ändringslogg, integritetstext och valideringsstatus motsvarar den kod som ska publiceras.
- [x] Bekräfta att True Peak fortfarande beskrivs som orienterande tills officiell validering är genomförd.
- [x] Bygg `_site` och bekräfta exakt 13 tillåtna, byteidentiska filer utan symlänkar eller förbjudna filtyper.
- [x] Bekräfta att arbetskatalogen är ren efter releasecommit.

Exempel på kontroll av spårade ljudfiler:

```bash
git ls-files -z | rg -z -i '\.(wav|wave|flac|m4a|aac|mp3|aif|aiff|caf|opus|ogg|w64|rf64|bw64|bwf|raw)$'
```

Kommandot ska inte ge någon träff.

## Repo på GitHub

- [ ] Skapa det publika repot `hktcr/ljudr-analysverkstad`.
- [ ] Använd `main` som standardgren.
- [ ] Lägg till repot som `origin` och kontrollera den exakta adressen med `git remote -v`.
- [ ] Skapa en avsiktlig releasecommit med tydligt commitmeddelande.
- [ ] Spara lokalt commit-id och tree-id före push.
- [ ] Pusha exakt den granskade committen till `origin/main`.
- [ ] Öppna GitHub och kontrollera att commit-id på `main` är identiskt med det lokala.
- [ ] Kontrollera att GitHub inte visar någon spårad ljudfil eller hemlighet.
- [ ] Aktivera relevanta säkerhetsfunktioner som är tillgängliga för det publika repot.

Förväntad repoadress, som måste öppnas och verifieras:

`https://github.com/hktcr/ljudr-analysverkstad`

## GitHub Actions och Pages

- [x] Workflow-filen ligger i `.github/workflows/pages.yml`.
- [x] Workflow triggas av push till `main` och kan startas manuellt.
- [x] Test och deploy ligger i separata jobb med minsta nödvändiga rättigheter.
- [x] Syntaxkontroll och alla tester måste slutföras före staging och paketering.
- [x] Actionversionerna är `checkout@v6`, `setup-node@v6`, `upload-pages-artifact@v5`, `configure-pages@v5` och `deploy-pages@v4`.
- [x] Endast `_site` skickas till Pages-artefakten.
- [x] Deployjobbet använder miljön `github-pages`.
- [ ] Pages ska ha `GitHub Actions` som källa under Settings och Pages.
- [ ] Öppna den faktiska workflow-körningen och kontrollera att varje steg är grönt.
- [ ] Kontrollera att deploy-steget anger den slutliga sidans URL.
- [ ] Spara workflow run-id, commit-id, starttid, sluttid och resultat.

En grön lokal testkörning räcker inte som deploykvitto. En grön Actions-körning räcker inte heller utan kontroll av den levande sidan.

## Kontroll av den levande sidan

- [ ] Öppna den URL som deploy-steget faktiskt rapporterar.
- [ ] Bekräfta att sidan svarar utan omdirigeringsfel eller 404.
- [ ] Bekräfta att sidans commit motsvarar releasecommitten.
- [ ] Kontrollera startsidan visuellt i bred och smal vy.
- [ ] Kontrollera konsolen och nätverksloggen utan oväntade fel.
- [ ] Bekräfta att inga förfrågningar görs till tredje part.
- [ ] Öppna en liten, icke privat WAV-testfil och kör hela flödet.
- [ ] Kontrollera analys, uppspelning, trimning, gain, intoning, uttoning och WAV-export.
- [ ] Kontrollera att ren trimning markeras som bitidentisk sample-payload.
- [ ] Kontrollera att gain eller toning markeras som omräkning med dither för PCM.
- [ ] Spara och öppna en projektfil.
- [ ] Skapa både HTML-rapport och JSON-rapport.
- [ ] Ladda om sidan, stäng nätverket och verifiera appskalet offline.
- [ ] Installera som PWA och kontrollera ikon, namn, startadress och scope.
- [ ] Kontrollera på fysisk iPad Pro enligt `docs/VALIDATION.md` innan produktionsstatus används.

Förväntad Pages-adress, som inte får redovisas som färdig innan den har öppnats och verifierats:

`https://hktcr.github.io/ljudr-analysverkstad/`

## Slutligt deploykvitto

Följande uppgifter ska dokumenteras i gAIa efter verifierad publicering:

- Reponamn och exakt repoadress.
- Standardgren.
- Releaseversion.
- Lokalt commit-id.
- GitHub commit-id.
- Git tree-id.
- Workflow run-id och länk till körningen.
- Pages-adress från deploysteget.
- Tidpunkt för publicering i Europe/Stockholm.
- Resultat från syntaxkontroll och tester.
- Resultat från kontroll av spårade ljudfiler.
- Resultat från säkerhets- och integritetskontroll.
- Resultat från livekontroll i bred och smal vy.
- Resultat från PWA- och offlinekontroll.
- Kända begränsningar, särskilt True Peak-validering och fysisk storfilskontroll på iPad.
- SHA-256 för den nya releaseartefakten.

Status får anges som `deployad och verifierad` först när samtliga obligatoriska punkter ovan är uppfyllda. Om fysisk iPad-validering återstår ska statusen i stället vara `publik valideringskandidat`.
