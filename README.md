# KoeWi Bierlogger PWA (mit Login)

Progressive Web App als grafisches Frontend fuer euer Google Apps Script Backend.
Jede Person meldet sich einmalig mit Name + selbst gewaehltem Passwort an;
danach bleibt sie auf ihrem Handy eingeloggt (Session wird lokal gespeichert).

## Wie das Login funktioniert

1. Beim ALLERERSTEN Login tippt die Person ihren Namen und ein selbst
   gewaehltes Passwort (min. 4 Zeichen) ein.
2. Das Script prueft: Name noch nie gesehen? -> Passwort wird jetzt fest
   als Hash im neuen Sheet "Zugangsdaten" hinterlegt. Login gilt sofort.
3. Bei jedem weiteren Login auf DIESEM Geraet: automatisch, da Name+Passwort
   im Browser (localStorage) gespeichert bleiben -- keine erneute Eingabe.
4. Bei einem NEUEN Geraet: einmal Name + das schon vergebene Passwort
   eingeben, dann pruefts der Server gegen den gespeicherten Hash.
5. Passwoerter werden NIE im Klartext gespeichert, nur als SHA-256 Hash
   im Sheet "Zugangsdaten".

## Setup (4 Schritte)

1. `login-backend-addon.gs` Inhalt in euer bestehendes Apps-Script-Projekt
   kopieren (neue Datei anlegen oder unten anhaengen).
2. In eurer `doGet(e)`-Funktion direkt nach der Key-Pruefung den Login-Block
   einfuegen (Code-Kommentar in der .gs-Datei zeigt genau wo).
3. In `app.js` die Variable `SCRIPT_URL` auf eure Web-App-URL setzen.
4. Icons in `icons/icon-192.png` und `icons/icon-512.png` ablegen, dann den
   Ordner auf GitHub Pages / Netlify / Firebase Hosting hochladen (HTTPS!).

## Rollen / Admin-Rechte

Im neu angelegten Sheet "Zugangsdaten" gibt es eine Spalte "Rolle".
Standardmaessig bekommt jeder "mitglied". Wer den Admin-Tab (Lager, Einkauf,
Inventur) sehen soll, muss dort von Hand auf "kassenwart" oder "admin"
gesetzt werden -- danach sieht die Person diesen Tab beim naechsten Login.

## Sicherheitshinweis

Das ist ein einfacher, praktikabler Schutz fuer den internen Gebrauch --
kein hochsicheres Verfahren wie bei einer Bank. Fuer eine Studenten-/Haus-
verwaltung reicht das aber vollkommen: Passwoerter sind gehasht, jede
Buchung wird mit dem angemeldeten Namen mitgeloggt (Parameter "absender"),
und ohne korrektes Passwort kommt niemand hinein.
