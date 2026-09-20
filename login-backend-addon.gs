
// ============================================================
// LOGIN-SYSTEM (Name + Passwort) fuer die PWA
// Ergaenzung zum bestehenden Bierlogger-Script.
// Einfach diesen Block irgendwo in euer Apps-Script-Projekt einfuegen
// und den Aufruf in doGet() ergaenzen (siehe unten).
// ============================================================

// Sheet fuer Zugangsdaten anlegen/holen
function holeOderErstelleAuthSheet(ss) {
  var sheet = ss.getSheetByName("Zugangsdaten");
  if (!sheet) {
    sheet = ss.insertSheet("Zugangsdaten");
    sheet.appendRow(["Name", "PasswortHash", "Rolle", "ErstelltAm", "LetzterLogin"]);
    sheet.getRange("A1:E1").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Passwort als SHA-256 Hash speichern, nie im Klartext
function hashPasswort(pw) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pw, Utilities.Charset.UTF_8);
  return bytes.map(function(b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

// Login pruefen ODER beim allerersten Mal Passwort neu setzen
// Rueckgabe: { ok: true/false, neu: true/false, rolle: "...", grund: "..." }
function pruefeLogin(ss, name, pw) {
  if (!name || !pw || pw.length < 4) {
    return { ok: false, grund: "Name fehlt oder Passwort zu kurz (min. 4 Zeichen)." };
  }
  var sheet = holeOderErstelleAuthSheet(ss);
  var data = sheet.getDataRange().getValues();
  var hash = hashPasswort(pw);

  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString().trim().toLowerCase() === name.trim().toLowerCase()) {
      // Person bereits registriert -> Passwort vergleichen
      if (data[i][1] === hash) {
        sheet.getRange(i + 1, 5).setValue(new Date());
        return { ok: true, neu: false, rolle: data[i][2] || "mitglied" };
      } else {
        return { ok: false, grund: "Falsches Passwort." };
      }
    }
  }

  // Person noch nie eingeloggt -> Passwort wird JETZT gesetzt (Erstregistrierung)
  sheet.appendRow([name, hash, "mitglied", new Date(), new Date()]);
  return { ok: true, neu: true, rolle: "mitglied" };
}

// Optional: Rolle eines Kassenwarts/Admins von Hand im Zugangsdaten-Sheet
// in Spalte C auf "kassenwart" oder "admin" setzen, damit die Person in der
// PWA auch den Admin-Tab (Lager/Einkauf/Inventur) sehen darf.

// ============================================================
// EINBAU IN doGet(e):
// Direkt am Anfang von doGet(), NACH der Key-Pruefung, ergaenzen:
//
//   if (action === "login") {
//     var res = pruefeLogin(ss, e.parameter.name, e.parameter.pw);
//     return ContentService.createTextOutput(JSON.stringify(res))
//       .setMimeType(ContentService.MimeType.JSON);
//   }
//
// ============================================================
