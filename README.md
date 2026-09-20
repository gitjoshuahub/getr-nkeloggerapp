# KoeWi Bierlogger PWA

Komplettes, lauffaehiges Paket: True-Black-Design, Login (Name+Passwort),
Offline-Faehigkeit, Mengen-Stepper (1-19 Flaschen, 1-5 Kaesten) und euer
echtes Zirkel-Logo als App-Icon.

## Setup (Reihenfolge wichtig)

1. In app.js ganz oben SCRIPT_URL auf eure Apps-Script-Web-App-URL setzen.
2. login-backend-addon.gs und stand-backend-addon.gs Inhalte in euer
   bestehendes Apps-Script-Projekt einbauen (Anleitung steht in den Dateien),
   dann neu deployen.
3. Kompletten Ordnerinhalt auf GitHub Pages / Netlify / Firebase Hosting
   hochladen (HTTPS zwingend erforderlich fuer Service Worker).
4. Auf dem Handy: Seite oeffnen, falls vorher schon mal besucht einmal
   Website-Daten/Cache loeschen, dann "Zum Startbildschirm hinzufuegen"
   bzw. "App installieren".

## Warum vorher Icons/Installation/Offline nicht gingen

- Icons waren nur Platzhalter bzw. das SVG hatte keine Fuellfarbe gesetzt
  und wurde dadurch auf schwarzem Hintergrund unsichtbar gerendert.
- Ohne gueltige Icons bricht die Service-Worker-Installation ab, wodurch
  weder "App installieren" noch Offline-Caching funktionierten.
- Jetzt: echtes Zirkel-Logo in Weiss auf schwarzem Quadrat, korrekt in
  icons/icon-192.png und icons/icon-512.png, von manifest.json und
  index.html referenziert.

## Dateien
- index.html, app.js, sw.js, manifest.json -- die App selbst
- icons/icon-192.png, icons/icon-512.png -- euer Zirkel-Logo
- login-backend-addon.gs -- Name+Passwort-Login fuers Google-Script-Backend
- stand-backend-addon.gs -- noetige Ergaenzung fuer den Stand-Tab
