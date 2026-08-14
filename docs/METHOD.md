# Metod för varsam soundscape-analys

## Mätning är inte ett omdöme

LjudR Analysverkstad beskriver signalen. Verktyget bedömer inte om ett ljudlandskap är bra, för tyst eller lagom högt. En avlägsen fågel, trafikbrus, tyst skymning och ett plötsligt råmande kan alla vara betydelsefulla delar av samma verk.

Observationer presenteras därför neutralt. En hög topp är en händelse att lyssna på, inte automatiskt ett fel. Ett lågfrekvent parti kan vara vind, handhavande, trafik eller en avsiktlig del av platsen.

## Loudness

- Momentary loudness använder 400 ms fönster.
- Short-term loudness använder 3 sekunders fönster.
- Integrated loudness använder absolut och relativ gating.
- Loudness range bygger på fördelningen av short-term loudness och är instabil under den första minuten.

LUFS-I för ett soundscape behöver inte följa ett talpoddsriktvärde. En möjlig arbetsreferens är -20 till -18 LUFS-I, men materialet kan med goda skäl ligga lägre. Om ett högre mål gör att rummets stillhet försvinner är målet fel för verket.

## Peak och full skala

Sample peak är den högsta lagrade samplingen. True Peak uppskattar toppar mellan samplingarna med 49 taps polyfas FIR-oversampling. Material under 96 kHz mäts fyrfaldigt, 96 till under 192 kHz mäts tvåfaldigt och material vid minst 192 kHz använder sample peak. I 32 bit float kan lagrade värden ligga över 0 dBFS utan att den ursprungliga floatfilen nödvändigtvis är förstörd. Verktyget kallar detta över full skala och redovisar tid och omfattning.

## Trimning

Trimgränserna lagras som heltalsindex för ljudbildrutor i intervallet `[startFrame,endFrame)`. Vid ren trimning kopieras den valda sample-payloaden utan avkodning eller omräkning. WAV-behållaren byggs om så att längd och datastorlek blir korrekta.

Fade är avstängd som standard. Den väljs bara när Håkan själv bedömer att klippunkten behöver det. Fade in och fade out är linjära i amplitud. Export och medhörning använder samma samplebaserade ändpunkter. Om toningarna överlappar används den lägsta av de två linjära envelopperna.

## Gain

Endast en statisk gain för hela verket finns. Ingen lokal gain, automatisk nivåutjämning, kompression, limiter, brusreducering eller EQ ingår. Förhandsvisningen ska skilja tydligt mellan medhörningsvolym och den gain som faktiskt skrivs till exporten. Avkodning, gain och fades beräknas i 64 bit float. Den slutliga filen avrundas först vid kodning till originalets format.

Vid PCM-export med gain eller fade kvantiseras samplingarna på nytt med TPDF-dither. Vid ren trimning sker ingen dither eftersom sample-payloaden inte räknas om.

## Global toppmarginal

Den globala toppmarginalen är avstängd som standard. När den aktiveras gör exportmotorn en extra blockvis förkontroll av det valda intervallet efter fades. Om det orienterande True Peak-estimatet tillsammans med vald gain överstiger taket minskas samma gainvärde för hela urvalet. Intern dynamik och stereorelationer bevaras.

Funktionen är inte limitering, soft clipping eller automatisk normalisering. Den formar inte enskilda toppar och kan inte reparera redan klippt eller distorderat ljud. Förvalt tak är -2 dBTP. FIR-mätningen klarar EBU Tech 3341:s officiella minimikrav för True Peak. Det är ett verifierat testresultat, inte en produktcertifiering eller leveransgaranti. Fysisk iPad-verifiering återstår.

För PCM använder exportmotorn dessutom sample peak som en separat hård säkerhetskontroll. Positiv gain blockeras före omkodning om den skulle orsaka numerisk klampning. Rapporten skiljer mellan rå klamprisk och den mycket mindre marginalrisk som kan uppstå när TPDF-dither läggs till.

## Metadata och spårbarhet

Projektfilen innehåller källfingeravtryck, analys, markörer, trimgränser, gain, fade, global toppmarginal, metadata och motorversion. Den innehåller inga ljudsamplingar. Rapporten beskriver källformat, metod, mätvärden, observationer, redigeringsbeslut och exportvarningar.
