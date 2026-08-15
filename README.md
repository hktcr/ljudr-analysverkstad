# LjudR Analysverkstad

LjudR är ett lokalt och icke destruktivt verktyg för analys och varsam redigering av fältinspelningar och ljudlandskap. Version `1.0.0-rc.7` är en offentlig valideringskandidat, inte en produktionsverifierad 1.0.

## Integritet och princip

Ljudfilen behandlas lokalt i webbläsaren. Appen innehåller ingen AI, telemetri, annonskod, extern font eller tredjepartsanslutning. Originalfilen skrivs aldrig över. Projekt och rapporter innehåller mätdata och metadata men inga ljudsamplingar.

Alla ändringar är uttryckliga. LjudR använder ingen automatisk nivåändring, lokal gain, kompressor, limiter, EQ, brusreducering eller omsampling. En eventuell gain gäller hela urvalet och måste bekräftas av användaren.

## Sluten formatmatris för 1.0

Följande kombinationer ingår:

- RIFF/WAVE och giltig WAVE_FORMAT_EXTENSIBLE
- mono och stereo
- PCM 16, 24 eller 32 bit samt IEEE float 32 bit
- 44,1, 48, 88,2, 96, 176,4 eller 192 kHz

Extensible kräver fullständigt giltig PCM- eller IEEE-float-GUID. PCM där `validBitsPerSample` skiljer sig från containerbitdjup får analyseras endast när vänsterjusteringen stöds och har verifierats. Obruten sample-payload kan trimmas bitidentiskt, men omräkning av sådana filer blockeras i 1.0.

RF64 och BW64 avvisas som indata. RF64/BW64-export, flerkanal, AAC, MP3, FLAC, omsampling och inbäddning av formulärmetadata i WAV ligger uttryckligen utanför 1.0. En WAV kan föras vidare till Ferrite för codec- och publiceringsarbete.

## Arbetsflöde

1. Öppna en lokal WAV och analysera källfilen.
2. Granska signalmått, observationer, markörer och den adaptiva vågformen.
3. Trimma början och slutet. Fade är frivillig och av från början.
4. Välj antingen att bevara nivån eller beräkna en frivillig serieorientering.
5. Prova resultatet innan en global gain används.
6. Exportera antingen ett sample-payload-identiskt trimutdrag eller en redigerad WAV-master.
7. Låt appen återöppna och verifiera den faktiskt skrivna WAV-filen.
8. Spara projekt och rapport för spårbarhet.

Rapporten skiljer strikt mellan:

- **Källfil**, analys av originalet
- **Beräknat exporturval**, editkedjan före kvantisering
- **Verifierad exportfil**, återöppnad och uppmätt faktisk WAV

## Ljudfritt analysunderlag för gAIa och VEP

LjudR kan skapa ett lokalt JSON-underlag enligt `se.gaia.ljudr.analysis-exchange/1`. Underlaget innehåller tekniska sammanfattningar och maskinella observationer men aldrig ljudsamplingar, waveform, spektrum, binär media eller originalfilens fulla SHA-256. Standardprofilen `Minimal` innehåller ingen kontinuerlig tidsserie och saknar filnamn, fria markörtexter och platskoordinater. Den uttryckliga profilen `Temporal diagnostik` kan lägga till grova programaggregat med minst 5 sekunder per segment och högst 720 segment. Segmenten innehåller sample peak, inte segmentbaserad True Peak, eftersom motorn saknar en verifierad True Peak-tidsserie.

Underlaget visas alltid i sin helhet före kopiering. All frivillig metadata är av från början och väljs fältgrupp för fältgrupp. Exakta koordinater kräver ett uttryckligt exakt integritetsval. LjudR ansluter inte till gAIa eller någon AI-tjänst och behåller `connect-src 'none'`. Användaren kopierar JSON-texten till gAIa och klistrar in vägledningen i verktyget. JSON-fil finns kvar som valfri reserv.

Vägledning kan återimporteras enligt `se.gaia.ljudr.guidance/1`. Den binds till exakt `bundleId` och `analysisDigest`, valideras som obetrodd data och kan aldrig automatiskt ändra trim, fade, gain, profil eller export. Osignerad vägledning märks som integritetskontrollerad men inte kryptografiskt avsändarverifierad. Se [gAIa-flödet](docs/GAIA_ANALYSIS_FLOW.md).

## Frivillig serieorientering

Serien kan använda -19 LUFS-I som redaktionell orientering, intervallet -20 till -18 LUFS-I som frivillig arbetsreferens och -2 dBTP som frivill topporientering. Detta är inte en teknisk acceptansgräns eller ett kvalitetsbetyg. Flödet är separat: **Beräkna**, **Prova**, **Använd**. Bevara oförändrat är ett likvärdigt huvudval. Om toppmarginalen begränsar gain visas att loudnessreferensen inte nås. Ingen dold extra sänkning används.

## Projekt, hash och koordinater

Projektformatet har strikt schema och migrering från tidigare schema. Full SHA-256 över hela källfilens bytes är säker identitet. En snabb hash av filkanterna får endast användas som förkontroll. Äldre projekt utan full hash kräver ny analys innan sparad analys kan återanvändas.

Projektfilen kan behålla privata exakta koordinater. Publika rapporter följer ett aktivt val:

- `Dold`: latitud och longitud utelämnas
- `Avrundad`: tre decimaler, ungefär 110 meter i latitud
- `Exakt`: exakta koordinater tas med och märks som aktivt val

## OPFS och stora exporter

Stora exporter kan använda webbläsarens privata lokala filsystem, OPFS. En partiell arbetsfil stängs och raderas vid fel eller avbrott. En slutförd fil behålls lokalt när webbläsaren inte kan bekräfta att filen verkligen sparats till Filer. Appen listar därför slutförda arbetsfiler med status, storlek och tid. De kan hämtas igen eller rensas uttryckligen.

## Offline och uppdateringar

När nät finns hämtar service workern navigering och versionsbundna programresurser från nätet först. Den lokala versionscachen används som reserv om nätåtkomsten misslyckas. Appen kontrollerar en ny service worker vid start, när nätet återkommer och när appen blir synlig efter bakgrundsläge. En väntande version aktiveras automatiskt endast när inget osparat arbete eller workerjobb pågår. Annars visas uppdateringspanelen och omladdning skjuts upp tills användarens arbete är säkert. Versionsnumret står direkt i HTML och kan därför läsas även om JavaScript inte startar.

Offline kan appen endast använda den senast fullständigt cachade versionen. Ingen webbapp kan hämta en ännu opublicerad eller nätberoende uppdatering utan fungerande anslutning.

## Mätstatus

Mätmotorn är kontrollerad mot den relevanta filbaserade mono/stereo-delen av EBU Loudness Test Set v5.0: 68 av 68 krav för 62 filer. Samtliga 19 relevanta mono/stereo-filer i ITU-R BS.2217-2 klaras inom rapportens tolerans på +/-0,1 LKFS. Detta är verifiering inom dokumenterad scope, inte extern produktcertifiering eller garanti för varje signal eller leveranskedja.

Se [valideringsplanen](docs/VALIDATION.md), [metoden](docs/METHOD.md), [gAIa-flödet](docs/GAIA_ANALYSIS_FLOW.md), [integritetstexten](PRIVACY.md) och [releasechecklistan](RELEASE_CHECKLIST.md).

## Releaseport

`1.0.0-rc.7` får publiceras som valideringskandidat. Versionsnumret `1.0.0` är förbjudet tills hela den fixerade testsuiten, EBU 68/68, ITU 19/19 och den fysiska iPad-matrisen är godkända. Matrisen omfattar en 15 till 20 minuter lång stereo float32/96 kHz-fil nära 1 GB i både Safari och installerad PWA, inklusive kopiera och klistra in flödet, export, Filer-handoff, bakgrund/återgång, quota, avbrott, OPFS-städning, offline och uppdatering.

## Lokal utveckling

```bash
npm run check
npm test
npm run build
python3 -m http.server 8080
```

Det officiella EBU- och ITU-materialet lagras aldrig i repot. Lokala fixtures kan kontrolleras med `npm run validate:ebu` och `npm run validate:itu`. Maskinläsbar status finns i `validation-manifest.json`; Pages-bygget skapar även `build-manifest.json` med releasecommit och SHA-256 för varje publik fil.

Koden publiceras under MIT-licens. Ljudfiler, privata projekt och lokala rapporter ingår aldrig i kodarkivet.
