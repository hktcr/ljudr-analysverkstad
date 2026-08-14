# Metod för varsam soundscape-analys

## Mätning, observation och beslut

LjudR skiljer mellan signalmätning, teknisk observation och konstnärligt beslut. Låg loudness, hög dynamik eller en plötslig topp är inte automatiskt ett fel. Verktyget ändrar aldrig ljud när det analyseras och använder ingen AI.

## Tre mätstadier

1. **Källfil** är blockvis analys av originalets samples.
2. **Beräknat exporturval** simulerar exakt vald trimregion efter fades, synlig bekräftad global gain och eventuell global toppmarginal, men före kvantisering och dither.
3. **Verifierad exportfil** återöppnar den faktiskt skrivna WAV-filen och kontrollerar container, invalid floats och signalmått.

Ett beräknat värde får inte beskrivas som verifierat. Varje editändring invalidierar tidigare regionsanalys.

## Loudness och toppar

- Momentary loudness använder 400 ms fönster.
- Short-term loudness använder 3 sekunders fönster.
- Integrated loudness använder absolut och relativ gating.
- Loudness range bygger på short-term-fördelningen och är instabil för kort material.
- Sample peak är den högsta lagrade samplingen.
- True Peak använder 49 taps polyfas FIR inom dokumenterad samplingsfrekvensmatris.
- PLR är skillnaden mellan True Peak och Integrated loudness när båda finns.

True Peak-tid redovisas med kanal och tidskonvention. FIR-filtrets gruppfördröjning korrigeras innan tidpunkten visas. NaN och Infinity i floatmaterial redovisas som regioner. Severity beskriver endast teknisk kontrollprioritet, aldrig estetisk kvalitet.

## Serieorientering

-19 LUFS-I, intervallet -20 till -18 LUFS-I och -2 dBTP är frivill redaktionell vägledning. Flödet är **Beräkna**, **Prova**, **Använd**. Bevara oförändrat är likvärdigt. Om topporienteringen kräver lägre gain visas att loudnessreferensen inte nås. Det finns ingen dold extra toppsänkning, limiter eller automatisk normalisering.

## Editkedja

Trimgränser lagras som heltalsbildrutor i intervallet `[startFrame,endFrame)`. Fade är avstängd från början och linjär i amplitud. Vid överlapp används den lägsta av de två envelopperna. Endast en statisk global gain finns. Preview A spelar källans valda utsnitt. Preview B spelar samma utsnitt med valda fades och effektiv global gain. Stereo, Vänster, Höger, Mono, medhörningsvolym och level match är monitorfunktioner och påverkar aldrig export eller mätvärden.

## Exportprofiler

**Sample-payload-identiskt trimutdrag** kopierar ett obrutet sampleintervall utan fade, gain, toppmarginal, omkodning eller formatändring. Identiteten gäller sample-payload, inte hela ombyggda RIFF-filen eller samtliga metadatachunkar.

**Redigerad WAV-master** redovisar trim, fades, avsedd gain, eventuell global toppsänkning, effektiv gain, dither, invalid-float-policy samt varje bevarad, uppdaterad eller borttagen chunk. PCM som räknas om använder TPDF-dither. Formulärmetadata ligger i projekt och rapport om inte en framtida funktion uttryckligen bäddar in och verifierar den i WAV.

Efter skrivning kontrolleras header, chunkgränser, frameCount, format och dataBytes genom den gemensamma parsern. Full filhash och sample-payload-hash har olika betydelse och redovisas separat.

## Format

1.0 omfattar RIFF/WAVE och giltig WAVE_FORMAT_EXTENSIBLE, mono/stereo, PCM16/24/32 eller float32 vid 44,1/48/88,2/96/176,4/192 kHz. RF64 och BW64 avvisas direkt. Extensible kräver exakt PCM- eller float-GUID. PCM med avvikande valid bits analyseras endast med korrekt vänsterjusterad avkodning; omräkning blockeras i 1.0. Övriga format ligger utanför scope.

## Identitet och reproducerbarhet

Full lokal inkrementell SHA-256 över hela originalfilens bytes är projektets säkra källidentitet. Den beräknas blockvis utan helfilsbuffert och verifieras mot standardvektorer och oberoende verktyg. Edge-hash är endast snabb förkontroll. Exportens fulla hash beräknas över exakt skrivna bytes. Projekt, rapport och buildmanifest anger appversion, motorversion, metodversion, releasecommit och valideringsstatus när underlaget finns.
