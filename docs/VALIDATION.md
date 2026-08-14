# Valideringsplan

## Status

Version 0.12.1 klarar hela den relevanta filbaserade mono/stereo-delen av EBU Loudness Test Set v5.0 och ITU-R BS.2217-2. WAV-parsning, sample-exakt trimning, linjära fades, 64 bitars intern bearbetning, global gain, global toppmarginal, PCM-klamprisk och det regelbaserade förklaringslagret täcks dessutom av 48 automatiska regressionstester. Testresultatet är inte en produktcertifiering eller garanti för varje möjlig signal. Fysisk långfilsverifiering på iPad Pro återstår.

Den kontextuella nivåskalan är ett transparent expertsystem utan AI. Den måste provas mot kända exempel inom lågmälda soundscapes, aktiva miljöer, intervjuer och musik. Testningen ska kontrollera både korrekta råd och att systemet avstår från råd när underlaget är otillräckligt.

En lokal referens den 14 augusti 2026 använde 10 sekunder stereo float med 1 kHz sinus. LjudR-motorn och FFmpeg `ebur128` gav samma Integrated loudness efter avrundning till 0,1 LU. Det är en värdefull regression, men inte ett substitut för EBU:s fullständiga testmaterial.

True Peak-motorn använder 49 taps polyfas FIR-oversampling. Ett periodiskt extremprov med samplingarna +0,99, +0,99, -0,99, -0,99 gav cirka +3,03 dBTP. Ett analytiskt 18 kHz sinusprov vid 48 kHz och amplituden 0,9 återgav den kontinuerliga signalens topp inom 0,05 dB.

Den 14 augusti 2026 kördes det officiella EBU Loudness Test Set v5.0. Kontrollen omfattade 62 relevanta filbaserade mono/stereo-filer och 68 separata krav för Integrated, Max Momentary, Max Short-term, LRA och True Peak. Samtliga 68 krav godkändes. Största absoluta avvikelsen var -0,1814 dB i True Peak-fall 22, inom EBU:s tillåtna intervall -0,4 till +0,2 dBTP. Flerkanalsfall 6 och live-mätarfallen 11 och 14 ligger uttryckligen utanför LjudR:s filbaserade mono/stereo-omfattning.

Samma datum kördes ITU-R BS.2217-2:s samtliga 19 mono/stereo-filer: absoluta och relativa gateprov, frekvenssvep, tolv frekvensprov samt fyra mono/stereo-prov med tal och musik. Samtliga godkändes inom rapportens tolerans ±0,1 LKFS. Största absoluta avvikelsen var -0,0721 LU i det relativa gateprovet. Valideringsskripten skriver ut varje oavrundat mätvärde och dess avvikelse.

Ett separat långfilsprov den 14 augusti 2026 använde en virtuell 20 minuters stereo WAV i 32 bit float vid 96 kHz. Motorn behandlade 115 200 000 ljudbildrutor, motsvarande cirka 879 MiB sample-payload, på 25,19 sekunder i utvecklingsmiljön. Processens RSS steg från cirka 56,5 till 223,9 MiB. Den virtuella filen skapade varje block vid läsning och tvingade därför motorn att genomföra samma block-, sample- och FIR-beräkningar som en faktisk fil utan att reservera hela ljudfilen i minnet. Resultatet stöder storfilsarkitekturen, men ersätter inte fysisk verifiering i Safari och installerad PWA på Håkans iPad Pro.

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

För gain och fade ska filens deklarerade bildrutor, data-storlek, kanaler, samplingsfrekvens och kodning stämma. PCM-proven ska kontrollera klampning och TPDF-dither. PCM32-avkodning ska bevara även de lägsta heltalsbitarna i 64 bitars arbetsbuffert. Float32-export ska motsvara den samplebaserade gain- och fadeformeln exakt efter den enda slutliga float32-avrundningen.

Global toppmarginal ska testas både när den ingriper och när den lämnar signalen oförändrad. Förkontrollen ska använda valt intervall efter fades. När ingen sänkning behövs ska ren trimning fortfarande vara bitidentisk. Positiv gain som skulle klampa PCM ska stoppas innan exportfilen skapas.

## Jämförelsemätning

LUFS-I, max LUFS-M, max LUFS-S, LRA och True Peak är jämförda med EBU:s och ITU:s officiella förväntade resultat inom verktygets filbaserade mono/stereo-omfattning. Skillnaderna redovisas per signal utan dold avrundning. Den tidigare kubiska True Peak-estimatorn är borttagen. Att minimikraven klaras får beskrivas som verifierat, men inte som extern produktcertifiering eller som garanti för varje möjlig signal och leveranskedja.

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
