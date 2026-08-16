# LjudR Analysverkstad

LjudR är ett lokalt och icke destruktivt verktyg för analys och varsam redigering av fältinspelningar och ljudlandskap. Version `1.0.0-rc.18` är en offentlig valideringskandidat, inte en produktionsverifierad 1.0.

## Integritet och princip

Ljudfilen behandlas lokalt i webbläsaren. Appen innehåller ingen AI, telemetri, annonskod, extern font eller tredjepartsanslutning. Originalfilen skrivs aldrig över. Projekt och rapporter innehåller mätdata och metadata men inga ljudsamplingar.

Alla ändringar är uttryckliga. LjudR använder ingen automatisk nivåändring, kompressor, limiter, EQ, brusreducering eller omsampling. Gain kan gälla hela urvalet eller bestå av synliga, stereolänkade lokala kurvor som användaren skapar, provlyssnar och bekräftar. Inget förslag appliceras automatiskt.

## Sluten formatmatris för 1.0

Följande kombinationer ingår:

- RIFF/WAVE och giltig WAVE_FORMAT_EXTENSIBLE
- mono och stereo
- PCM 16, 24 eller 32 bit samt IEEE float 32 bit
- 44,1, 48, 88,2, 96, 176,4 eller 192 kHz

Extensible kräver fullständigt giltig PCM- eller IEEE-float-GUID. PCM där `validBitsPerSample` skiljer sig från containerbitdjup får analyseras endast när vänsterjusteringen stöds och har verifierats. Obruten sample-payload kan trimmas bitidentiskt, men omräkning av sådana filer blockeras i 1.0.

RF64 och BW64 avvisas som indata. RF64/BW64-export, flerkanal, AAC, MP3, FLAC, omsampling och inbäddning av formulärmetadata i WAV ligger uttryckligen utanför 1.0. En WAV kan föras vidare till Ferrite för codec- och publiceringsarbete.

## Arbetsflöde

1. Öppna en lokal WAV och kör en grundkontroll som bygger stor tvåkanalig vågform och säker medhörning.
2. Lyssna, placera A och B och klipp bort allt utanför det material som ska användas.
3. Analysera det valda materialet separat och se resultatet i en ny tvåkanalig vågform.
4. Granska signalmått, observationer, markörer och relevanta fyndlager över vågformen. Bygg vid behov ett lokalt tvåkanaligt spektrogram för det synliga området.
5. Bevara nivån eller använd uttrycklig global gain, toningar och synliga lokala toppkurvor.
6. Analysera det valda materialet igen efter varje signaländring. Leveransstatus blir Pass först efter en färsk omräkning.
7. Exportera antingen ett sample-payload-identiskt trimutdrag eller en redigerad WAV-master.
8. Låt appen återöppna och verifiera den faktiskt skrivna WAV-filen.
9. Spara projekt och rapport för spårbarhet.

Toppguiden efter huvudvärdena svarar i ordning på vad som mättes, vad resultatet betyder, om det finns en faktisk eller endast möjlig klippindikation och vad som händer vid export. Fyra synliga diagnoskategorier skiljer bevarad floatnivå, möjlig digital klippning, möjlig analog överstyrning och risk vid uppspelning eller export. Analog överstyrning redovisas uttryckligen som något filanalysen inte säkert kan avgöra. Knappar leder till högsta toppen, visade floatregioner, valbar negativ global gain och en lokal toppverkstad. Lokala kurvor påverkar vänster och höger kanal lika, kan förbigås för A/B-lyssning och verifieras med en ny analys av hela exporturvalet. Ingen åtgärd appliceras automatiskt.

Efter toppanalysen använder uppspelningen en separat säker monitortrim om den valda käll- eller exportförhandsvisningen annars kan överskrida -3 dBTP. Sänkningen visas i spelaren, påverkar aldrig analys eller export och hindrar lyssningskedjans mättnad från att förväxlas med skada i inspelningen. Om den säkra monitorgrafen inte kan starta stoppas uppspelningen.

Efter analysen visar en kompakt modulöversikt status för fil och signalintegritet, toppar, loudness, dynamik, stereo och mono samt mänsklig granskning. Pass betyder bara att det namngivna maskinella testet är uppfyllt. Granska betyder att lyssning eller ett mänskligt beslut återstår. Stopp används endast när data eller ett uttryckligt leveranskrav blockerar fortsatt bearbetning. Information och Kan inte avgöras hålls separata från felstatus. Betydelsen visas alltid med text och symbol, inte enbart med färg.

Knappen Expandera hela analysen visar en rullbar helskärmsgenomgång av topparter, loudness, dynamik, stereo och mono, signalintegritet, kanalvärden, viktiga tidsområden, rekommenderade nästa steg och analysens uttryckliga begränsningar. Den interna avsnittsnavigeringen leder direkt från varje kompakt statuskort till rätt evidens.

Det aktuella A/B-fönstret ligger kvar synligt genom analys, trimning och export. Fönstret är låst från början. Efter ett uttryckligt upplåsningsval kan det placeras med finger, penna, mus, knappar eller tangentbord och provlyssnas med bibehållen längd. Det låses sedan för slutlig lyssning. Först ett separat val gör A/B till aktivt trimurval och tar bort omgivande ljud vid export. Tidslinjen kan expanderas och visa vågform, loudness, sample peak, stereokorrelation och markörer som separata lager.

Trim, kanttoningar och global gain har en gemensam ångra- och gör om-historik. Den lokala toppverkstaden behåller sin egen detaljerade kurvhistorik. Kanalbalans mäts och kan provlyssnas kanalvis, men LjudR gör inte separat automatisk vänster- eller högergain eftersom det skulle förändra stereobilden.

LjudR gör inte interna klipp mitt i en tagning. För att ta bort en bil, hostning eller annan händelse markerar du tiderna i LjudR, gör montaget i Ferrite, exporterar en ny WAV och öppnar den som ny källa i LjudR. Därefter körs grundkontroll, analys av exporturval och verifierad WAV-export på nytt. På så sätt blir Ferrite-filen en tydligt ny källa och verifieringskedjan fortsätter utan att en gammal analys återanvänds.

Spektrogrammet skapas endast på begäran för synligt tidsområde, separat för vänster och höger kanal. Det använder Hann-fönster och visar sin tids- och frekvensupplösning. Vyn lämnar aldrig enheten och ingår inte i gAIa-underlaget. Den är visuell evidens för fortsatt lyssning, inte automatisk identifiering av vind, arter, trafik eller tekniskt fel.

Rapporten skiljer strikt mellan:

- **Källfil**, analys av originalet
- **Beräknat exporturval**, editkedjan före kvantisering
- **Verifierad exportfil**, återöppnad och uppmätt faktisk WAV

## Ljudfritt analysunderlag för gAIa och VEP

LjudR kan skapa ett lokalt JSON-underlag enligt `se.gaia.ljudr.analysis-exchange/2`. Underlaget innehåller tekniska sammanfattningar och maskinella observationer men aldrig ljudsamplingar, vågform, spektrum, binär media eller originalfilens fulla SHA-256. Signalsteget anges som källfil, beräknat exporturval eller verifierad WAV. Twenty Minutes Here-kontexten är ett separat redaktionellt lager. Standardprofilen `Minimal` innehåller ingen kontinuerlig tidsserie och saknar filnamn, fria markörtexter och platskoordinater. Ett redaktionellt cue sheet kräver ett eget aktivt val. Den uttryckliga profilen `Temporal diagnostik` kan lägga till grova programaggregat med minst 5 sekunder per segment och högst 720 segment. Segmenten innehåller sample peak, inte segmentbaserad True Peak, eftersom motorn saknar en verifierad True Peak-tidsserie.

Poddflödet har ett lokalt publiceringskort, serieöversikt från verifierade rapporter och ett kompakt avsnittsmanifest med masterhash. Den frivilliga serieorienteringen är versionsstyrd och är inte en Spotify-standard. Spotify for Creators kan ta emot den verifierade WAV-mastern direkt. Ferrite används fortsatt för montage, interna klipp och separat codec-export, följt av ny analys och verifiering i LjudR när filen ska bli masterkälla.

Underlaget visas alltid i sin helhet före kopiering. All frivillig metadata är av från början och väljs fältgrupp för fältgrupp. Exakta koordinater kräver ett uttryckligt exakt integritetsval. LjudR ansluter inte till gAIa eller någon AI-tjänst och behåller `connect-src 'none'`. Användaren kopierar JSON-texten till gAIa och klistrar in vägledningen i verktyget. JSON-fil finns kvar som valfri reserv.

Vägledning kan återimporteras enligt `se.gaia.ljudr.guidance/1`. Den binds till exakt `bundleId` och `analysisDigest`, valideras som obetrodd data och kan aldrig automatiskt ändra trim, fade, gain, profil eller export. Osignerad vägledning märks som integritetskontrollerad men inte kryptografiskt avsändarverifierad. Se [gAIa-flödet](docs/GAIA_ANALYSIS_FLOW.md).

## Frivillig serieorientering

Serien kan använda -19 LUFS-I som redaktionell orientering, intervallet -20 till -18 LUFS-I som frivillig arbetsreferens och -2 dBTP som frivill topporientering. Detta är inte en teknisk acceptansgräns eller ett kvalitetsbetyg. Flödet är separat: **Beräkna**, **Prova**, **Använd**. Bevara oförändrat är ett likvärdigt huvudval. Om toppmarginalen begränsar gain visas att loudnessreferensen inte nås. Ingen dold extra sänkning används.

## Projekt, hash och koordinater

Projektformatet har strikt schema och migrering från tidigare schema. Full SHA-256 över hela källfilens bytes är säker identitet. En snabb hash av filkanterna får endast användas som förkontroll. Äldre projekt utan full hash kräver ny analys innan sparad analys kan återanvändas.

Projektfilen kan behålla privata exakta koordinater. Publika rapporter använder `Dold` som förval och följer därefter ett aktivt val:

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

`1.0.0-rc.18` får publiceras som valideringskandidat. Versionsnumret `1.0.0` är förbjudet tills hela den fixerade testsuiten, EBU 68/68, ITU 19/19 och den fysiska iPad-matrisen är godkända. Matrisen omfattar en 15 till 20 minuter lång stereo float32/96 kHz-fil nära 1 GB i både Safari och installerad PWA, inklusive kopiera och klistra in flödet, export, Filer-handoff, bakgrund/återgång, quota, avbrott, OPFS-städning, offline och uppdatering.

## Lokal utveckling

```bash
npm run check
npm test
npm run build
python3 -m http.server 8080
```

Det officiella EBU- och ITU-materialet lagras aldrig i repot. Lokala fixtures kan kontrolleras med `npm run validate:ebu` och `npm run validate:itu`. Maskinläsbar status finns i `validation-manifest.json`; Pages-bygget skapar även `build-manifest.json` med releasecommit och SHA-256 för varje publik fil.

Koden publiceras under MIT-licens. Ljudfiler, privata projekt och lokala rapporter ingår aldrig i kodarkivet.
