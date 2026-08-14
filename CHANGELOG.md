# Ändringslogg

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
