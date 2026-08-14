# LjudR Analysverkstad

Ett lokalt och icke destruktivt analysverktyg för fältinspelningar och ljudlandskap. Appen är byggd för långa WAV-filer från bland annat Tascam-inspelare, inklusive stereo 32 bit float vid 96 kHz.

## Grundprincip

Ljudfilen lämnar inte enheten. Den väljs lokalt och läses i små block i en separat worker. Koden innehåller ingen analys, telemetri, extern font eller nätanslutning till tredje part. Endast filer som användaren själv exporterar lämnar verktyget.

Analysen får vara rik, men varje ljudingrepp måste vara uttryckligt. Originalfilen ändras aldrig.

## Funktioner

- RIFF/WAVE och WAVE_FORMAT_EXTENSIBLE
- PCM 16, 24 och 32 bit
- IEEE float 32 bit, inklusive värden över full skala
- mono och stereo, 44,1 till 192 kHz
- blockbaserad analys utan helfilsavkodning i minnet
- stereovågform och synkroniserade mättidslinjer
- LUFS-I, LUFS-M, LUFS-S och LRA
- sample peak och högupplöst True Peak-estimering
- RMS, crest factor, DC-offset, stereobalans, korrelation samt Mid/Side-energi
- observationer för över full skala, ogiltiga floatvärden, digital noll, låg nivå, diskontinuiteter och möjlig flat-topping
- markörer med teknisk, beskrivande eller egen typ
- sample-exakt trimning av början och slutet
- valfri gemensam gain för hela verket
- flexibla linjära fade in och fade out, avstängda som standard
- medhörning med samma fadekurva och globala nivå som exporten
- valfri global toppmarginal som bara kan sänka hela urvalet
- blockvis toppförkontroll av det valda intervallet efter fades
- spärr mot positiv gain som skulle klampa PCM-samplingar
- WAV-export i originalets kodning och samplingsfrekvens
- bitidentisk sample-payload när endast trimgränser används
- TPDF-dither när PCM-samplingar måste räknas om
- projektfil utan ljuddata
- reproducerbar HTML- och JSON-rapport
- PWA och offlinecache av appskalet
- regelbaserad första reflektion utifrån inspelningstyp och användning
- klickbara informationsrutor för samtliga mätvärden, bearbetningar och exportval
- aktuella värden jämförda med relaterade mått och tydligt redovisade begränsningar

## Vetenskaplig status

Beräkningarna är utformade efter ITU-R BS.1770-5 och EBU Tech 3341/3342. Verktyget skiljer därför på mätresultat, observationer och konstnärliga val.

Version 0.11.0 är en valideringskandidat, inte en certifierad loudnessmätare. LUFS, LRA och True Peak ska jämföras med EBU Loudness Test Set och ITU:s testmaterial innan statusen ändras till verifierad. True Peak-värdet och den globala toppmarginalen är därför orienterande, inte leveransgarantier. Varje rapport innehåller motorversion och aktuell valideringsstatus.

Den första reflektionen är ett lokalt och deterministiskt expertsystem. Ingen AI används. Referensintervallen är dokumenterad vägledning och får inte förväxlas med plattformsstandarder eller kvalitetsbetyg. Varje informationsruta redovisar aktuellt värde, relevant jämförelse, rekommendation och begränsning.

Se [Validering](docs/VALIDATION.md) och [Metod](docs/METHOD.md).

## Varsamt soundscape-flöde

1. Öppna WAV-originalet.
2. Kör analysen och läs observationerna neutralt.
3. Trimma bara handhavandeljud i början och slutet.
4. Låt fade vara av om klippunkten redan är ren.
5. Bedöm eventuell gain för hela verket med öronen och mätningen tillsammans.
6. Aktivera bara global toppmarginal om hela verket får sänkas för att skapa marginal.
7. Exportera en ny WAV. Originalet påverkas inte.
8. Spara projektfil och rapport för spårbarhet.

Ett riktvärde som exempelvis -20 till -18 LUFS-I är ett lyssningsreferensvärde, inte ett krav. Tystnad och dynamik kan motivera en lägre integrerad nivå. Verktyget normaliserar aldrig automatiskt.

Den globala toppmarginalen är av som standard och använder -2 dBTP som försiktigt grundvärde. Om förkontrollen bedömer att marginalen överskrids minskas samma gainvärde över hela urvalet. Funktionen är inte en limiter och kan inte reparera ljud som redan är klippt eller distorderat.

## iPad

Öppna webbappen i Safari och välj Lägg till på hemskärmen för en mer app-lik miljö. Lägg gärna stora original under På min iPad eller på ett anslutet lagringsmedium. Om filen ligger i iCloud kan iPad först behöva hämta den från Apple.

Håll appen i förgrunden under en lång analys eller export. iPadOS kan pausa webbarbete i bakgrunden. Överlämningen av exporter nära 1 GB måste verifieras praktiskt på den aktuella iPaden innan den betraktas som produktionssäker.

## Format som inte aktiverats

FLAC, AAC/M4A och MP3 är inte aktiverade i denna version. WAV-exporten är säkrare för stora filer och bevarar originalets format utan onödig omsampling. En distributionskopia kan tills vidare skapas i Ferrite efter WAV-export. Codecs aktiveras först när strömning, metadata, dither, omsampling och storfilshantering är verifierade på iPad.

## Lokal utveckling

```bash
python3 -m http.server 8080
```

Öppna sedan `http://localhost:8080`. Tester körs med:

```bash
node --test tests/*.test.mjs
```

## Projekt

LjudR Analysverkstad utvecklas inom gAIa-projektet LjudR och publiceringsserien Twenty Minutes Here. Koden är offentlig under MIT-licens. Ljudfiler och privata projektfiler ingår aldrig i kodarkivet.
