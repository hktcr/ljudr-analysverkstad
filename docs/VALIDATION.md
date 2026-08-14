# Valideringsplan

## Status

Version 0.11.0 är en valideringskandidat. Grundläggande WAV-parsning, sample-exakt trimning, linjära fades, global gain, global toppmarginal, PCM-klamprisk och det regelbaserade förklaringslagret täcks av automatiska regressionstester. Loudness och True Peak är ännu inte certifierade mot hela den officiella testsviten.

Den kontextuella nivåskalan är ett transparent expertsystem utan AI. Den måste provas mot kända exempel inom lågmälda soundscapes, aktiva miljöer, intervjuer och musik. Testningen ska kontrollera både korrekta råd och att systemet avstår från råd när underlaget är otillräckligt.

En lokal referens den 14 augusti 2026 använde 10 sekunder stereo float med 1 kHz sinus. LjudR-motorn och FFmpeg `ebur128` gav samma Integrated loudness efter avrundning till 0,1 LU. Det är en värdefull regression, men inte ett substitut för EBU:s fullständiga testmaterial.

Ett separat blockprov använde 60 sekunder stereo 32 bit float vid 96 kHz, cirka 44 MiB, genom en filbackad Blob. Analysen tog cirka 0,93 sekunder i utvecklingsmiljön och processens högsta observerade RSS var cirka 125 MiB inklusive Node. Resultatet stöder att läsningen är blockbaserad, men säger inte hur snabbt eller minnessnålt samma körning blir i Safari på iPad.

## Referenser

- ITU-R BS.1770-5, Algorithms to measure audio programme loudness and true-peak audio level
- EBU Tech 3341, Loudness Metering
- EBU Tech 3342, Loudness Range
- EBU Loudness Test Set
- ITU-R BS.2217-2, material för True Peak-test

## Obligatoriska signalprov

- digital noll
- 997 Hz och 1 kHz sinus
- fullskalesinus med crest factor omkring 3,0103 dB
- DC 0,001, motsvarande cirka -60 dBFS
- vänster lika med höger, korrelation +1
- höger lika med inverterad vänster, korrelation -1
- okorrelerat brus
- vänster kanal 6 dB starkare än höger
- floatvärden över full skala
- NaN och Infinity i floatfil
- upprepade PCM-rälsvärden
- udda chunkstorlek och padding
- WAVE_FORMAT_EXTENSIBLE med float
- avklippt header och data-block

## Exportprov

För ren trimning ska SHA-256 av exporterad sample-payload vara identisk med SHA-256 av samma byteintervall i källfilen. Testet ska köras för PCM 16, 24 och 32 bit samt IEEE float 32 bit, mono och stereo.

För gain och fade ska filens deklarerade bildrutor, data-storlek, kanaler, samplingsfrekvens och kodning stämma. PCM-proven ska kontrollera klampning och TPDF-dither.

Global toppmarginal ska testas både när den ingriper och när den lämnar signalen oförändrad. Förkontrollen ska använda valt intervall efter fades. När ingen sänkning behövs ska ren trimning fortfarande vara bitidentisk. Positiv gain som skulle klampa PCM ska stoppas innan exportfilen skapas.

## Jämförelsemätning

LUFS-I, max LUFS-M, max LUFS-S, LRA, sample peak och True Peak ska jämföras med minst två etablerade implementationer, där en är EBU:s officiella testresultat. Skillnader ska dokumenteras per signal och får inte döljas genom avrundning. Den nuvarande kubiska True Peak-estimatorn kan underskatta extrema intersample-toppar och får därför inte användas som ensam leveranskontroll.

## iPad-prov

Följande måste provas på Håkans faktiska iPad Pro:

1. 20 minuter stereo 32 bit float vid 96 kHz.
2. Analys i Safari-flik och installerad PWA.
3. Minnesanvändning och temperatur under hela genomgången.
4. Bakgrundning och återgång.
5. OPFS-kvot och felhantering.
6. Export nära 1 GB och sparande till Filer.
7. Uppspelning av original och valt trimintervall.
8. Rapport och projektfil.

Produktionsstatus ges först när dessa prov är dokumenterade med appversion, iPadmodell och iPadOS-version.
