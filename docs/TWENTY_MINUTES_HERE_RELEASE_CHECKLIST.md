# Checklista för Twenty Minutes Here

Denna checklista är bindande för LjudR:s poddspecifika arbetsflöde. Den skiljer mellan objektiv mätning, redaktionell kontext och användarens beslut. Inget redaktionellt råd får beskrivas som ett mätresultat eller ändra ljudet automatiskt.

## P0 korrekthet

- [x] Maskinella markörer hämtas från samma analysstadium som tidsserierna.
- [x] Markörer för ett trimmat urval är nollbaserade inom urvalet.
- [x] Markörer utanför urvalet följer inte med.
- [x] Källtid behålls endast lokalt och blandas inte med urvalstid.
- [x] Markörens maskintyp bevaras från analysmotorn till utbytesformatet.
- [x] Validering stoppar markörer som ligger utanför analysstadiets längd.
- [x] Integrationstest täcker trimstart större än noll och appformad markör.

## Analysstadier

- [x] Källfil kan exporteras som eget analysunderlag.
- [x] Beräknat exporturval kan exporteras som eget analysunderlag.
- [x] Verifierad WAV kan exporteras som eget analysunderlag.
- [x] Stadiet anges maskinläsbart och synligt för användaren.
- [x] Synliga beslutsmått använder aktuellt exporturval när detta är färdigberäknat.
- [x] Inaktuella urvalsmått visas inte som aktuella efter en redigering.

## Redaktionell kontext

- [x] Twenty Minutes Here har ett versionsstyrt serie-ID och en motivering till nivåorienteringen.
- [x] Mållängd, tolerans, syfte och kontinuitetspolicy följer med som redaktionell kontext.
- [x] Nivå- och topporientering märks som redaktionell och frivillig.
- [x] Valda redaktionella markörer kan delas separat och endast efter aktivt val.
- [x] Fri markörtext ingår aldrig i Minimal utan detta aktiva val.

## Publiceringsflöde

- [x] Publiceringskort visar aktuell verifierad WAV och avsedd längd.
- [x] Kritiska ogranskade markörer synliggörs.
- [x] Manuell kontroll finns för hel genomlyssning, kanter, stereo, mono och integritet.
- [x] Avvikelser kan motiveras utan automatiskt kvalitetsbetyg.
- [x] Ett kompakt avsnittsmanifest kan exporteras för projektarkiv och webbplats.
- [x] Manifestet innehåller verifierad masterhash, längd, metadata, koordinatpolicy och rapportreferens.
- [x] Spotifyfält är ett överlämningsfält och LjudR publicerar inte till Spotify.

## Seriekonsekvens

- [x] Tidigare verifierade JSON-rapporter kan läsas in lokalt.
- [x] Översikten visar median och spridning för längd, LUFS-I, dBTP, LRA, PLR och kanalbalans.
- [x] Serienormalisering sker aldrig automatiskt.

## Mono och spektral orientering

- [x] Aktuellt urval redovisar mono fold-downs nivådelta och peak.
- [x] Varaktigt negativ korrelation blir navigerbara granskningspunkter.
- [x] Frivillig spektral diagnostik samplar deterministiska fönster för rumble och 50 Hz-brum.
- [x] Spektrala resultat beskrivs som orientering, inte som fel eller automatisk EQ-grund.

## Avgränsningar

- [x] Ingen kompressor, limiter eller automatisk normalisering.
- [x] Ingen automatisk EQ, brusreducering eller stereokorrigering.
- [x] Inget automatiskt kvalitetsbetyg.
- [x] Ingen ljuduppladdning till AI.
- [x] Ingen fullständig montageeditor eller Spotifyklient.

## Releaseport

- [ ] Alla automatiska tester passerar.
- [ ] Bygget skapar exakt det tillåtna webbpaketet.
- [ ] VEP granskar hela diffen och ger PASS utan öppet P0-fel.
- [ ] Commit och buildmanifest pekar på samma källversion.
- [ ] GitHub Actions är grön.
- [ ] GitHub Pages visar rätt version och grundflödet verifieras live.
- [ ] Fysisk iPad-matris är fortsatt separat blockerare för versionsnumret 1.0.0.
