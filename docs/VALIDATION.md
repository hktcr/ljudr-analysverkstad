# Valideringsplan för 1.0.0-rc.18

## Status

`1.0.0-rc.18` är en offentlig valideringskandidat. Den får inte beskrivas som produktionsverifierad 1.0.

Loudnessmotorn klarar hela den relevanta filbaserade mono/stereo-delen av EBU Loudness Test Set v5.0: 68 av 68 krav för 62 filer. Den klarar även samtliga 19 relevanta mono/stereo-filer i ITU-R BS.2217-2 inom +/-0,1 LKFS. EBU:s flerkanalsfall och uttryckliga live-mätarfall ligger utanför verktygets filbaserade mono/stereo-scope. Resultaten är verifiering inom dokumenterad scope, inte produktcertifiering.

Maskinläsbar status finns i `validation-manifest.json`. Manifestet binder testinventeringen och de lokala fixturemanifesten med SHA-256. Valideringsskripten skriver filnamn, byteantal och full SHA-256 för varje officiell fixture i sitt JSON-resultat. Den fixerade regressionstestinventeringen finns i `tests/test-inventory.json`. Officiella ljudfixtures lagras lokalt och är ignorerade av Git.

## Obligatoriska automatiska och statiska prov

- gemensam parser för RIFF och WAVE_FORMAT_EXTENSIBLE
- fullständig PCM- och IEEE-float-GUID
- direkt avslag för RF64 och BW64
- diskreta frekvenser 44,1/48/88,2/96/176,4/192 kHz
- PCM16/24/32 och float32, mono/stereo
- vänsterjusterad `validBitsPerSample`-analys med omräkningsspärr
- avklippta chunkar, udda padding, fel blockAlign och okänd GUID
- digital noll, float overrange, NaN och Infinity som regioner
- Integrated, Max Momentary, Max Short-term, LRA, True Peak och PLR
- True Peak-tid korrigerad för FIR-gruppfördröjning
- exakt Beräknat exporturval efter trim/fades/global gain/toppmarginal
- editändring invalidierar regionsanalys
- sample-payload-identisk obruten trim för varje stödformat
- gain/fade/dither/klamprisk med deterministiska referenser
- återöppnad Verifierad exportfil och full outputinspektion
- full filhash och separat sample-payload-hash
- worker-jobb med jobId, cancel och stale-resultatfilter
- OPFS partial-cleanup, complete-lista, quota och uttrycklig rensning
- strikt projektschema, storleksgräns och migreringsfixtures från äldre schema
- full SHA-256 som källidentitet; ändring i filens mitt måste upptäckas
- koordinatpolicy Dold/Avrundad/Exakt
- semantisk HTML/JSON utan `[object Object]` och med HTML-escaping
- PWA-resurser, nät först för appskal, cachefallback, cacheversionsbyte och säker update-UX kontrolleras automatiskt; faktisk offlinekörning och uppgradering i Chrome på iPad ingår i den fysiska matrisen
- canvasens textmotsvarighet och tangentbordskontrakt kontrolleras statiskt; VoiceOver och faktisk tangentbordsoperation ingår i den manuella matrisen
- Minimal exchange saknar ljud, samples, waveform, spektrum, kontinuerlig tidsserie, full källhash, filnamn, fria markertexter och koordinater
- Temporal diagnostik följer minsta intervall, högst 720 segment, tillåtna programmått och deterministisk aggregering
- temporal sample peak beskrivs inte som True Peak; segmentbaserad True Peak redovisas som otillgänglig
- analysisDigest och guidanceDigest klarar kanoniska fixtures i både LjudR och gAIa-flödet
- guidance avvisas vid fel bundle, digest, källkoppling, editidentitet, evidensreferens eller schema
- replay, stale edit, extrema tal, objektdjup, prototype pollution, HTML och prompt injection provas
- dataprofil, frivill metadata och exakt koordinatval har fixerade integritetssnapshots
- guidance kan aldrig automatiskt tillämpa trim, fade, gain, profil eller export
- appens CSP behåller `connect-src 'none'` och export/import initierar ingen nättrafik
- trimstart större än noll provas mot urvalsrelativ markörtid, urvalslängd och bevarad maskintyp
- redaktionell seriekontext och cue sheet valideras separat från objektiva mätmarkörer
- mono fold-down, varaktig negativ korrelation och deterministiskt samplad spektral orientering provas utan automatisk korrigering
- toppguiden skiljer float overrange, leveransmarginal och heuristisk klippindikation samt leder till lyssning eller uttryckliga globala gainval utan automatisk bearbetning
- analysöversikten visar sex avgränsade statusmoduler med text, symbol och färg; full evidens, metod, begränsningar och nästa steg öppnas i en gemensam helskärmsvy
- float overrange visas som information, avsaknad av klippindikation formuleras som resultatet av genomförda tester och manuell redaktionell granskning kan inte bli automatiskt Pass
- säker monitortrim sänker endast lyssningsvägen till orienterande -3 dBTP och uppspelningen stoppas om den behövs men monitorgrafen inte kan starta
- ett eget steg analyserar aktuellt exporturval, visar beräkning separat från utfall och blir uttryckligen inaktuellt efter varje redigering
- ogranskade privacy- och remove-markörer blockerar publiceringsstatus även om den generella integritetsrutan är markerad
- fullständig analysvy skiljer uppmätta fakta, tolkning, begränsningar och nästa kontroll samt länkar redovisade tidsområden till uppspelning
- lokala toppkurvor är stereolänkade, använder minsta envelopp vid överlapp, ingår i medhörning, regionsanalys, projekt, rapport och export samt gör sample-payload-identisk profil otillgänglig
- publiceringskort, verifierad masterhash, avsnittsmanifest och rapportbaserad serieöversikt har fixerade regressionstester

## Fysisk iPad-matris

Följande är blockerande för versionsnumret `1.0.0`:

1. Dokumentera iPad Pro-modell, minne, iPadOS-version och ledigt utrymme.
2. Använd en faktisk 15 till 20 minuter lång stereo float32/96 kHz-fil nära 1 GB.
3. Kör hela flödet i Safari och installerad PWA.
4. Verifiera analys, adaptiv zoom, käll/export-preview och monitor routing.
5. Exportera, lämna över till Filer, återöppna och verifiera WAV samt hash.
6. Testa bakgrund/återgång under analys och export.
7. Testa quota-fel, manuellt cancel och cleanup av partial.
8. Verifiera lista, återhämtning och explicit rensning av complete i OPFS.
9. Verifiera kall offline-start och uppdatering från föregående version.
10. Kör VoiceOver, externt tangentbord, 200/400 procents zoom, kontrast och reduced motion.
11. Skapa Minimal underlag, kontrollera exakt preview, kopiera texten, klistra in matchande guidance och verifiera att inget råd tillämpas automatiskt.
12. Logga tid, maximal observerbar minnesbelastning, temperaturvarning och varje fel.

Kontrollera dessutom i stående och liggande iPad-läge att A/B-fönstret är synligt i analys, trimning och export, att den expanderade tidslinjen går att öppna och stänga och att sidan kan rullas när fönstret är låst. Verifiera hela följden med finger och Apple Pencil: lås upp, flytta fönstret utan ändrad längd, flytta A och B separat, använd samtliga lyssningskontroller, lås, provlyssna igen och välj sedan antingen att tillämpa trimurvalet eller återgå.

## Releaseport

1.0.0 kräver noll öppna P0/P1-fel, ren taggad commit, konsekvent version och commit i app/workers/projekt/rapport/PWA/buildmanifest, hela fixerade testsuiten, EBU 68/68, ITU 19/19, fysisk iPad-matris, manuell WCAG 2.2 AA-matris, pinned GitHub Actions, grön deploy och livekontroll mot exakt releasecommit.

RC-resultat får endast återanvändas för oförändrade bytes. Varje kodändring kräver omkörning av berörda och releasekritiska kontroller.
