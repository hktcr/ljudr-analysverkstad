# Integritet

LjudR Analysverkstad behandlar vald ljudfil lokalt i webbläsaren. Appens kod skickar inte ljud, analys, metadata eller användningsstatistik till en server. Ingen AI, telemetri, extern font, annons eller tredjepartsspårare används.

GitHub Pages levererar appens offentliga kod och kan därför behandla vanliga webbserveruppgifter när sidan hämtas. Efter offlinecache behövs ingen anslutning för lokalt arbete. Projekt, rapporter och exporter lämnar enheten först när användaren själv väljer att dela eller flytta dem.

## Ljudfritt analysunderlag

Appen kan skapa ett lokalt analysunderlag för ett separat gAIa/VEP-flöde. LjudR skickar inte filen och ansluter inte till någon extern tjänst. Underlaget hämtas endast när användaren väljer det.

Dataprofilen `Minimal` innehåller inga ljudsamplingar, waveform, spektrum, binär media, filnamn, fria markörtexter, koordinater, kontinuerliga tidsserier eller originalfilens fulla SHA-256. Den kan ändå innehålla inspelningens längd, tekniska sammanfattningar och händelseintervall. Sådana uppgifter kan vara känsliga och ska granskas före delning.

Dataprofilen `Temporal diagnostik` lägger till grova programaggregat med minst 5 sekunder per segment och högst 720 segment. Den innehåller ingen waveform, kanalnivåserie, RMS-array eller segmentbaserad True Peak. Frivillig metadata är av från början och väljs fältgrupp för fältgrupp. Identifierande uppgifter och exakta koordinater tas med först efter aktiva val. Appen visar den exakta JSON-filen före hämtning.

Återimporterad guidance behandlas som obetrodd data. Den får aldrig automatiskt ändra ljud, redigering eller export. En digest kontrollerar innehållskopplingen, men osignerad guidance är inte kryptografiskt avsändarverifierad.

## Lokala filer

- Originalfilen öppnas genom webbläsarens filväljare och skrivs aldrig över.
- Projekt och rapporter innehåller inga ljudsamplingar, men kan innehålla filnamn, mätdata, markörer, anteckningar och platsmetadata.
- Ett lokalt projekt får behålla privata exakta koordinater.
- En rapport utelämnar koordinater vid `Dold`, avrundar till tre decimaler vid `Avrundad` och tar endast med exakta koordinater efter aktivt val av `Exakt`.
- Kontrollera alltid en rapport innan den delas.

## OPFS

För stora exporter kan appen använda Origin Private File System, OPFS, som lokal arbetsyta:

- en fil med status `partial` är ofullständig
- `partial` stängs och raderas vid fel eller avbrott
- en fil med status `complete` är färdig men ligger fortfarande i appens lokala lagring
- webbläsaren ger inget tillförlitligt kvitto på att en download eller share verkligen sparats till Filer
- därför behålls `complete` efter handoff och visas med status, storlek och tid
- användaren kan hämta filen igen, radera en fil eller rensa alla arbetsfiler

Appen får inte beskriva en slutförd OPFS-fil som automatiskt raderad. Service workern cachar endast offentlig appkod, ikoner och maskinläsbar valideringsinformation, aldrig vald ljudfil, projekt, rapport, analysunderlag eller guidance.
