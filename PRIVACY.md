# Integritet

LjudR Analysverkstad behandlar ljud lokalt i webbläsaren.

- Ingen ljudfil laddas upp av appen.
- Ingen analys, metadata eller användningsstatistik skickas till en server.
- Inga externa typsnitt, script, annonser eller spårare används.
- Appen försöker inte läsa andra filer än dem användaren själv väljer.
- Projekt- och rapportfiler innehåller inga ljudsamplingar.
- OPFS används endast som lokal, tillfällig arbetsyta för stor export när webbläsaren stöder det.
- Service workern cachar endast appens offentliga kod och grafiska resurser.

GitHub Pages levererar de offentliga appfilerna. GitHub kan därför behandla vanliga webbserveruppgifter när själva webbplatsen hämtas. När appen väl är offlinecachelagrad behövs ingen anslutning för att analysera en lokal fil.
