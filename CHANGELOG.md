# Ändringslogg

## 1.0.0-rc.5, 2026-08-15

- hämtar navigering och versionsbundna programresurser från nätet först när nät finns
- använder den versionsbundna cachen enbart som reserv vid nätfel eller offlinearbete
- registrerar service workern med `updateViaCache: "none"` och kontrollerar uppdatering vid start, återgång och återanslutning
- aktiverar en väntande uppdatering automatiskt endast när inget osparat arbete eller workerjobb pågår
- skjuter upp omladdning tills arbetet är säkert om en ny worker tar kontroll under pågående arbete
- skriver versionsnumret direkt i HTML så att det syns även om JavaScript inte startar

## 1.0.0-rc.4, 2026-08-15

- exporterar ljudfritt analysunderlag enligt `se.gaia.ljudr.analysis-exchange/1`
- erbjuder Minimal utan tidsserie och frivillig Temporal diagnostik med högst 720 grova programsegment
- redovisar temporal sample peak utan att kalla den segmentbaserad True Peak
- håller full källhash lokalt och binder underlaget med slumpmässigt bundleId och analysisDigest
- erbjuder privacyprofilerna Minimal, Redigerad och Exakt med full förhandsgranskning
- importerar strikt validerad guidance enligt `se.gaia.ljudr.guidance/1`
- redovisar gAIa/VEP-, metod-, modell- och promptprovenance när underlaget innehåller den
- märker osignerad guidance som inte kryptografiskt avsändarverifierad
- kräver separat användarbeslut och tillämpar aldrig råd automatiskt
- behåller all apptrafik lokal med `connect-src 'none'`

## 1.0.0-rc.3, 2026-08-15

- samlar analysens regelbaserade förslag i panelen Föreslagna nästa steg
- visar prioriterade åtgärder och förklarar att inget utförs automatiskt
- leder direkt till fynd, markörer och den varsamma åtgärdsverkstaden
- behåller Bevara oförändrat som ett lika synligt huvudval

## 1.0.0-rc.2, 2026-08-15

- visar aktuell programversion tydligt intill LjudR-logotypen
- hämtar versionsetiketten från samma releasekälla som projekt, analys och export
- behåller versionsetiketten synlig även i smal iPad-layout

## 1.0.0-rc.1, 2026-08-15

Offentlig valideringskandidat. Versionsnumret 1.0.0 är blockerat tills den fysiska iPad-matrisen och hela releaseporten är godkända.

### Arkitektur och analys

- sluten mono/stereo WAV-matris med sex diskreta samplingsfrekvenser
- gemensam strikt parser och direkt avslag för RF64/BW64
- adaptiv workerbaserad vågform med detalj- och samplezoom
- separat Källfil, Beräknat exporturval och Verifierad exportfil
- jobId, cancel och stale-resultatfilter för långvariga jobb

### Varsam redigering

- separat Beräkna, Prova och Använd för frivillig serieorientering
- Bevara oförändrat som likvärdigt huvudval
- ingen dold extra toppsänkning
- profilerna Sample-payload-identiskt trimutdrag och Redigerad WAV-master

### Projekt, rapport och integritet

- projektschema 2 med strikt validering och explicit migrering från schema 1
- full lokal inkrementell SHA-256 som säker källidentitet
- edge-hash nedgraderad till snabb förkontroll
- svensk semantisk HTML/JSON-rapport utan förlust av nästlade objekt
- fulla filhashar, sample-payload-hash, metod, releasecommit och valideringsproveniens
- aktiv koordinatpolicy Dold, Avrundad eller Exakt
- OPFS-status, quota, cancel, partial-cleanup samt lista och uttrycklig rensning av complete

### Release

- maskinläsbart validation-manifest och hashbundet buildmanifest
- fixerad regressionstestinventering
- Actions pinnade till fulla commit-SHA och checkout utan kvarlämnade credentials
- PWA-updateflöde och obligatorisk fysisk iPad/VoiceOver-matris

## 0.12.1, 2026-08-14

### Korrigerat

- filbaserad Max Momentary och Max Short-term använder nu 10 ms sökupplösning för att hitta exakta 400 ms- och 3 s-fönster oberoende av signalens startläge
- den publika tidslinjen och Integrated/LRA behåller sina standardenliga 100 ms-block

### Validerat

- 68 av 68 krav godkända för 62 relevanta mono/stereo-filer i EBU Loudness Test Set v5.0
- 19 av 19 relevanta mono/stereo-filer godkända i ITU-R BS.2217-2 med toleransen ±0,1 LKFS
- EBU:s flerkanalsfall och uttryckliga live-mätarfall redovisas som utanför verktygets filbaserade mono/stereo-omfattning
- 49 automatiska regressionstester godkända

## 0.12.0, 2026-08-14

### Tillagt

- 64 bit float som intern arbetsprecision för gain och fades
- 49 taps polyfas FIR-mätning för True Peak
- analytiska regressionstest för högfrekvent sinus och kraftig intersample-topp
- kontroll att PCM32:s lägsta bitar bevaras i bearbetningsbufferten
- sampleexakt referenstest för kombinationen global gain och linjära fades
- lokalt valideringsskript för EBU:s officiella testfiler

### Förtydligat

- ren trimning är fortsatt bitidentisk
- FIR-mätningen är starkare men kallas inte formellt verifierad innan hela EBU- och ITU-materialet har körts
- fysisk långfilsverifiering på iPad Pro återstår

## 0.11.0, 2026-08-14

### Tillagt

- regelbaserad första reflektion för soundscape, evenemang, intervju, musik och annan inspelning
- separat bedömning för publicering respektive original eller arkivmaster
- femgradig nivåorientering med tydliga metodbegränsningar
- informationsrutor för samtliga fördjupade mätvärden
- informationsrutor och rekommendationer för toningar, gain, toppmarginal och medhörning
- informationsrutor för exportprofiler, teknisk status och exportkontroll
- aktuellt värde ställt i relation till andra relevanta mått i varje informationsruta
- större och mer yteffektiv hjälpdialog för bred skärm och iPad
- 44 automatiska regressionstester

### Förtydligat

- vägledningen är deterministisk och använder ingen AI
- referensintervallen är vägledning, inte standarder eller kvalitetsbetyg
- varje rekommendation kräver lyssning innan ljudet ändras

## 0.10.0, 2026-08-14

Första planerade publika valideringskandidaten.

### Tillagt

- flexibla linjära fade in och fade out med snabbval och numerisk inställning
- jämn Web Audio-medhörning med samma fadegeometri som exporten
- global toppmarginal som endast kan sänka hela det valda urvalet
- blockvis toppförkontroll av valt intervall efter fades
- separat PCM-kontroll som stoppar positiv gain med klamprisk
- spårbar rapportering av avsedd gain, extra sänkning och effektiv gain
- projektlagring av toppmarginal med bakåtkompatibla standardvärden
- säkrare import av markörer från projektfiler
- Pages-bygg från en uttrycklig lista med publika filer
- 39 automatiska regressionstester

### Förtydligat

- toppmarginalen är av som standard och är inte en limiter
- True Peak är orienterande och inte en leveransgaranti
- redan klippt eller distorderat ljud kan inte repareras av toppmarginalen
- fysisk iPad Pro-verifiering och full standardvalidering återstår

## 0.9.0, 2026-08-14

Första lokala valideringskandidaten.

### Tillagt

- blockbaserad lokal WAV-analys
- stöd för PCM 16, 24 och 32 bit samt IEEE float 32 bit
- stöd för mono, stereo och WAVE_FORMAT_EXTENSIBLE
- loudness, peak, råstatistik, stereoanalys och observationer
- responsiva analys- och trimtidslinjer
- start- och sluttrimning med bildrutenoggrannhet
- statisk gain för hela verket och valfria kanttoningar
- bitidentisk sample-payload vid ren trimning
- OPFS-baserad storfilsexport när webbläsaren stöder det
- projektfil, källfingeravtryck samt HTML- och JSON-rapport
- PWA-appskal med lokal cache och strikt nätspärr
- 23 automatiska regressionstester

### Valideringsgräns

True Peak är ett orienteringsestimat. Full kontroll mot EBU:s och ITU:s officiella testmaterial samt fysisk iPad-verifiering återstår.
