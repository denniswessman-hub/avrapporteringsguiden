# Avrapporteringsguiden

[Öppna webbplatsen](https://denniswessman-hub.github.io/avrapporteringsguiden/)

Version 1.0.0. Svenskt studiestöd inför examination i DUR två, DAF och Formulärportalen: sju dokumentdelar, sex arbetsgångar, tolv skrivmallar, 62 källanknutna regler och en lokal textgranskare.

## Textgranskning

Lägg in originalcaset separat och välj mellan PM, DAF-ingripandegrund, DAF-händelse, portalgrund, fritextanmälan och misstankeförhör. Flera handlingar kan granskas tillsammans. Verktyget visar kontrollfrågor, jämför utvalda citerade sakuppgifter och låter dig acceptera eller avvisa avgränsade formatförslag. Originaltexten bevaras. Kopiering, textexport och rensning finns.

Ingen AI-tjänst är ansluten. Fri löptext förstås inte fullständigt och uppgifternas eller juridikens riktighet godkänns inte automatiskt. Manuell kontroll behövs. Texterna behandlas i webbläsarens minne, skickas inte för analys och sparas inte automatiskt mellan besök. Export sparas först efter användarens val.

## Källor och begränsningar

Källor, datum, rättelser och systemversioner visas i manualen. Grundgranskningen är daterad 9 november 2026. Aktuell examinationsmatris, systemändringar och vissa specialfall behöver fortfarande verifieras. Webbplatsen är självständigt studiestöd. Exempel är fiktiva; inga original-PDF:er, interna systembilder eller privata caseuppgifter publiceras.

## Källkod och underhåll

De körbara webbplatsfilerna ligger i repots rot och publiceras från `main` med GitHub Pages. `release.json` anger version och SHA-256 för sju körbara filer.

[Hämta det redigerbara källkodspaketet](./avrapporteringsguiden-source-1.0.0.zip). Paketet innehåller `src`, `content`, `scripts`, tester och `package.json`. Packa upp det i en egen mapp. Node.js krävs för byggning; inga externa paket behövs.

```text
node scripts/build.mjs
node --test --test-isolation=none tests/*.test.mjs
node scripts/serve.mjs
```

Ändra innehåll i `content/manual.json` och gränssnitt i `src`. Byggningen skapar `dist` och en fristående HTML-fil i `output`. Publicera filerna från `dist` till repots rot och verifiera den publika versionen mot `release.json`. Uppdatera även källkodspaketet när koden ändras.

Den lokala releasen har testats med 73 kodtester. De offentliga testerna använder fiktiva data; privata söktermer från lokala integritetskontroller har utelämnats i paketet. Kodtester ersätter inte källgranskning och visuell kontroll i webbläsare.
