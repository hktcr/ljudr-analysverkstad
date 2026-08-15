# Ljudfritt analysflöde för gAIa och VEP

## Ansvarsgräns

LjudR analyserar ljudet lokalt. Appen anropar ingen gAIa-, VEP- eller AI-tjänst och dess CSP behåller `connect-src 'none'`. Användaren kan uttryckligen exportera ett ljudfritt JSON-underlag, behandla det i ett separat system och därefter importera en separat guidancefil.

LjudR:s mätvärden, gAIa/VEP:s tolkning och användarens beslut är tre skilda lager. Importerad vägledning är aldrig ett verifierat mätresultat och tillämpas aldrig automatiskt.

## Analysunderlag schema 1

Formatet heter `se.gaia.ljudr.analysis-exchange/1`. Varje export får ett slumpmässigt `bundleId`. `analysisDigest` är SHA-256 över den dokumenterade kanoniska representationen av schema, bundleId och payload. Samma bundleId och digest måste återkomma i guidance.

Projektet behåller lokalt kopplingen mellan:

- bundleId och analysisDigest
- originalfilens fulla SHA-256
- analys-, app- och metodversion
- aktuell editidentitet
- privacyprofil och exporttid

Originalfilens fulla SHA-256 lämnar inte enheten i analysunderlaget. Digest visar att samma JSON-underlag avses men bevisar inte vem som har skapat en fil.

### Dataprofiler och grova tidsserier

`Minimal` är standard och innehåller ingen kontinuerlig tidsserie. `Temporal diagnostik` får lägga till endast aggregerade, numeriska programserier:

- relativa tidsintervall
- minst 5 sekunder per intervall
- högst 720 intervall
- deterministiskt större intervallbredd i steg om 5 sekunder för längre material
- Momentary p10, median och max
- Short-term median och max
- maximal sample peak för programmet
- låg-nivåandel och stereokorrelationens median och minimum
- `null` när ett värde inte kan beräknas

Segmentbaserad True Peak redovisas som otillgänglig eftersom motorn saknar en verifierad True Peak-tidsserie. Underlaget får aldrig innehålla samples, waveform, spektrum, kanalnivåserier, RMS-arrayer, binär media, Blob-, data- eller object-URL:er eller exakta samplepositioner. Maskinella observationer får innehålla kontrollerad typ, severity och tidsintervall men inte fri text från markörer.

## Integritetsval

### Minimal

Standardläget innehåller tekniska sammanfattningar och maskinella observationer. Filnamn, full källhash, egna markertexter, anteckningar och koordinater utelämnas.

### Frivillig metadata

Användaren väljer uttryckligen fältgrupper för titel och session, filnamn, plats, anteckningar eller skapare. Fri markörtext exporteras inte i schema 1. En förhandsgranskning visar den exakta JSON-texten före kopiering. Vägledning klistras in som text och valideras med samma strikta schema som filimporten.

### Exakta koordinater

Exakta koordinater kräver både aktivt platsval och exakt koordinatprecision. Exakt är en disclosure-nivå, inte ett påstående om mätprecision.

Även ljudfria data kan avslöja inspelningens längd, aktivitet, dynamik eller händelsetider. Underlaget ska därför granskas innan det delas.

## Guidance schema 1

Återimport använder `se.gaia.ljudr.guidance/1`. Filen behandlas som obetrodd data och måste:

- vara högst 1 MiB
- använda exakt stödd huvudversion och strikt tillåtna fält
- ha begränsat objektdjup, textlängd och antal rekommendationer
- endast innehålla ändliga tal inom dokumenterade intervall
- matcha lokalt bundleId, analysisDigest, källidentitet och editidentitet
- referera till evidens-ID som finns i det exporterade underlaget
- sakna HTML, körbara uttryck och aktiva URL:er
- avvisa `__proto__`, `constructor` och `prototype` på alla nivåer

Varje rekommendation börjar som `unreviewed`. Användaren kan acceptera eller avvisa den, men varje faktisk trim-, fade-, gain-, profil- eller exportändring kräver ett separat uttryckligt beslut i LjudR.

## Provenance och tillit

Guidance ska redovisa system, komponentversion, metod, VEP-perspektiv och, när det finns, modell-, prompt- och körningsidentifierare. Modellbaserad text får inte beskrivas som deterministisk.

`guidanceDigest` skyddar kopplingen till filens innehåll. Utan en verifierad digital signatur visas statusen `integritetskontrollerad men inte kryptografiskt avsändarverifierad`.

Projektets audit trail sparar export, import, digestar, provenance, accepterade och avvisade råd samt edit före och efter användarbeslut. Historiken ger spårbarhet och kan indikera manipulering, men är inte ett externt avsändarbevis.

## Hotmodell

Validering och testning ska särskilt hantera:

- oavsiktligt läckage av ljud, full filhash eller privat metadata
- prompt injection i metadata eller markörtext
- guidance för fel bundle, ändrad analys eller gammal edit
- manipulerad digest eller evidensreferens
- replay av äldre guidance
- HTML-, URL- och prototype pollution-angrepp
- extrema tal, djupa objekt och resurskrävande listor
- sammanblandning av mätvärde, extern tolkning och användarbeslut

## Versionering

Schema-ID byts vid varje brytande ändring. Okänd huvudversion avvisas. Migration ska vara explicit, enkelriktad och fixturetestad. Originalrepresentation och migreringsproveniens bevaras i det lokala revisionsspåret.
