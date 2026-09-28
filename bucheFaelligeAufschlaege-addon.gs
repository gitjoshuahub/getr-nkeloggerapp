// ====== ADDON: bucheFaelligeAufschlaege ======
// Dieses Addon ersetzt die Aufschlag-Logik, die bisher direkt in
// trageUebertraege() eingebaut war. Dort wird die folgende Zeile ENTFERNT:
//
//   if (uebertrag >= cfg.schuldenGrenze) uebertrag *= cfg.aufschlag;
//
// Stattdessen wird bucheFaelligeAufschlaege() per Zeit-Trigger aufgerufen
// (z. B. monatlich am 15.), NACHDEM das Zahlungsziel abgelaufen ist.
// Das verhindert, dass der Aufschlag sofort beim Monatsübertrag angewendet
// wird, sondern erst wenn die Frist wirklich verstrichen ist.
//
// ====== EINBAU ======
// 1. Zeile  `if (uebertrag >= cfg.schuldenGrenze) uebertrag *= cfg.aufschlag;`
//    aus trageUebertraege() im Haupt-Script entfernen.
// 2. Diese Funktion bucheFaelligeAufschlaege() direkt unterhalb von
//    trageUebertraege() ins Haupt-Script einfügen.
// 3. Trigger anlegen: Apps Script → Trigger → bucheFaelligeAufschlaege
//    → Zeitgesteuert → Monatlich → z. B. 15. des Monats.
//
// ====== VORAUSSETZUNGEN ======
// Folgende Funktionen müssen im Haupt-Script existieren:
//   ladeKonfig()         → gibt cfg-Objekt zurück (schuldenGrenze, aufschlag)
//   getSheetNames(date)  → gibt { abr, log } zurück
//   holeOderErstelleLogSheet(ss, name) → gibt Log-Sheet zurück
//   sendeAnAdmin(msg)    → sendet Fehlermeldung an Admin
//   sendeAnGruppeUndKassenwart(msg) → sendet Info-Nachricht
//   ABRECHNUNGSFREI      → Array mit Namen, die ausgenommen sind

function bucheFaelligeAufschlaege() {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var cfg = ladeKonfig();
  var now = new Date();

  // Nur ab dem 15. des Monats ausführen (Zahlungsziel-Puffer)
  if (now.getDate() < 15) {
    Logger.log("Noch nicht faellig – Zahlungsziel noch nicht erreicht.");
    return;
  }

  var names    = getSheetNames(now);
  var abrSheet = ss.getSheetByName(names.abr);
  var logSheet = holeOderErstelleLogSheet(ss, names.log);

  if (!abrSheet) {
    sendeAnAdmin("❌ Kein Abrechnungssheet für fällige Aufschläge gefunden: " + names.abr);
    return;
  }

  var data    = abrSheet.getDataRange().getValues();
  var logData = logSheet.getDataRange().getValues();
  var gebucht = [];

  for (var i = 1; i < data.length; i++) {
    var person = (data[i][0] || "").toString().trim();
    if (!person || ABRECHNUNGSFREI.indexOf(person) >= 0) continue;

    var uebertrag = parseFloat(data[i][1]) || 0;   // Spalte B: Übertrag/Schulden
    var strafen   = parseFloat(data[i][5]) || 0;   // Spalte F: bestehende Strafen

    // Nur bei Schulden über der Grenze
    if (uebertrag < cfg.schuldenGrenze) continue;

    // Idempotenz-Check: wurde der Aufschlag für diesen Monat schon gebucht?
    var marker      = "AUFSCHLAG_" + names.abr + "_" + person;
    var schonGebucht = false;
    for (var l = 1; l < logData.length; l++) {
      if ((logData[l][5] || "").toString().indexOf(marker) >= 0) {
        schonGebucht = true;
        break;
      }
    }
    if (schonGebucht) continue;

    // Aufschlag berechnen (nur der Aufpreis, nicht der Gesamtbetrag)
    var aufschlagBetrag = Math.round((uebertrag * (cfg.aufschlag - 1)) * 100) / 100;
    if (aufschlagBetrag <= 0) continue;

    // In Strafenspalte addieren
    abrSheet.getRange(i + 1, 6).setValue(Math.round((strafen + aufschlagBetrag) * 100) / 100);

    // Im Log vermerken (inkl. Marker für Idempotenz)
    logSheet.appendRow([
      new Date(),          // Datum
      person,              // Name
      aufschlagBetrag,     // Betrag
      "strafe",            // Typ
      "System",            // Gebucht von
      "Zahlungsziel-Aufschlag " + marker,  // Notiz (enthält Marker!)
      Date.now()           // Timestamp als Tiebreaker
    ]);

    gebucht.push(person + ": " + aufschlagBetrag.toFixed(2).replace(".", ",") + " €");
  }

  if (gebucht.length) {
    sendeAnGruppeUndKassenwart(
      "⚠️ Zahlungsziel erreicht – folgende Aufschläge wurden gebucht:\n" +
      gebucht.join("\n")
    );
  } else {
    Logger.log("Keine fälligen Aufschläge zu buchen.");
  }
}
