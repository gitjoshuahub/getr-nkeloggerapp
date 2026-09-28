// ====================================================
// kalender-backend.gs
// Diesen Code in ein EIGENES Google Apps Script Projekt
// kopieren (nicht in das Haupt-Bierlogger-Projekt).
// Danach als Web-App deployen:
//   Ausführen als: Ich (dein Google-Konto)
//   Zugriff:       Jeder
// Die resultierende URL in app.js als HAUS_SCRIPT_URL eintragen.
// ====================================================

var MONTHS_AHEAD = 6;


function getSheetByNameOrCreate_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers && headers.length) sh.appendRow(headers);
  }
  return sh;
}


function getConfigValue_(key) {
  var sh = getSheetByNameOrCreate_("einstellungen", ["key", "value"]);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || "").toString().trim() === key) {
      return (data[i][1] || "").toString().trim();
    }
  }
  return "";
}


// Zentrale Kalender-Konfiguration: Key im "einstellungen"-Sheet -> Label im JSON-Output
var CALENDAR_KEYS_ = {
  haus: "haus_calendar_id",
  allgemein: "calendar_id"
};


function getCalendarByKey_(label) {
  var configKey = CALENDAR_KEYS_[label];
  if (!configKey) throw new Error("Unbekanntes Kalender-Label: " + label);

  var calId = getConfigValue_(configKey);
  if (!calId) throw new Error(configKey + " fehlt in 'einstellungen'.");

  var cal = CalendarApp.getCalendarById(calId);
  if (!cal) throw new Error("Kalender nicht gefunden (" + label + "): " + calId);

  return cal;
}


function testKalender() {
  var labels = Object.keys(CALENDAR_KEYS_);
  var start = new Date();
  var end = new Date();
  end.setMonth(end.getMonth() + MONTHS_AHEAD);

  labels.forEach(function(label) {
    try {
      var cal = getCalendarByKey_(label);
      var events = cal.getEvents(start, end);
      Logger.log("[" + label + "] Gefundene Termine: " + events.length);
      events.slice(0, 10).forEach(function(ev) {
        Logger.log("[" + label + "] " + ev.getStartTime() + " | " + ev.getTitle());
      });
    } catch (err) {
      Logger.log("[" + label + "] Fehler: " + err.message);
    }
  });
}


function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


function getEventsForCalendar_(label, start, end) {
  var cal = getCalendarByKey_(label);
  return cal.getEvents(start, end).map(function(ev) {
    return {
      id: ev.getId(),
      title: ev.getTitle(),
      start: ev.getStartTime(),
      end: ev.getEndTime(),
      allDay: ev.isAllDayEvent(),
      location: ev.getLocation(),
      description: ev.getDescription(),
      calendar: label
    };
  });
}


function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var action = (params.action || "").toString().trim();

  try {
    if (action === "getevents") {
      var start = new Date();
      var end = new Date();
      end.setMonth(end.getMonth() + MONTHS_AHEAD);

      var kalenderParam = (params.kalender || "").toString().trim().toLowerCase();
      var labels = (kalenderParam && CALENDAR_KEYS_[kalenderParam])
        ? [kalenderParam]
        : Object.keys(CALENDAR_KEYS_);

      var events = [];
      labels.forEach(function(label) {
        try {
          events = events.concat(getEventsForCalendar_(label, start, end));
        } catch (labelErr) {
          Logger.log("Fehler bei Kalender " + label + ": " + labelErr.message);
        }
      });

      events.sort(function(a, b) { return new Date(a.start) - new Date(b.start); });

      return jsonOutput_({ ok: true, events: events });
    }

    // Health-Check
    if (action === "ping") {
      return jsonOutput_({ ok: true, pong: true, time: new Date().toString() });
    }

    return jsonOutput_({ ok: false, error: "unknown_action: " + action });
  } catch (err) {
    Logger.log("doGet Fehler: " + err.message);
    return jsonOutput_({ ok: false, error: err.message });
  }
}


function getTeilnahmenSheet_() {
  return getSheetByNameOrCreate_("teilnahmen",
    ["event_id", "event_start", "event_title", "name", "status", "kommentar", "updated_at"]);
}


function findTeilnahmeRow_(sheet, eventId, name) {
  var data = sheet.getDataRange().getValues();
  var eventKey = (eventId || "").toString().trim();
  var nameKey = (name || "").toString().trim().toLowerCase();

  for (var i = 1; i < data.length; i++) {
    var rowEventId = (data[i][0] || "").toString().trim();
    var rowName = (data[i][3] || "").toString().trim().toLowerCase();
    if (rowEventId === eventKey && rowName === nameKey) {
      return i + 1;
    }
  }
  return 0;
}


function setAttendance_(payload) {
  var eventId    = (payload.event_id    || "").toString().trim();
  var eventStart = (payload.event_start || "").toString().trim();
  var eventTitle = (payload.event_title || "").toString().trim();
  var name       = (payload.name        || "").toString().trim();
  var status     = (payload.status      || "").toString().trim().toLowerCase();
  var kommentar  = (payload.kommentar   || "").toString().trim();

  if (!eventId) throw new Error("event_id fehlt.");
  if (!name)    throw new Error("name fehlt.");
  if (["dabei", "vielleicht", "abgesagt"].indexOf(status) === -1) {
    throw new Error("status muss dabei, vielleicht oder abgesagt sein.");
  }

  // LockService: verhindert Duplikate bei parallelen Requests
  var lock = LockService.getScriptLock();
  var gotLock = lock.tryLock(10000);
  if (!gotLock) {
    throw new Error("System ist gerade ausgelastet, bitte nochmal versuchen.");
  }

  try {
    var sh  = getTeilnahmenSheet_();
    var row = findTeilnahmeRow_(sh, eventId, name);
    var values = [[eventId, eventStart, eventTitle, name, status, kommentar, new Date()]];

    if (row) {
      sh.getRange(row, 1, 1, 7).setValues(values);
    } else {
      sh.appendRow(values[0]);
    }
  } finally {
    lock.releaseLock();
  }

  return { ok: true, event_id: eventId, name: name, status: status };
}


// WICHTIG: Das Frontend sendet Content-Type: text/plain um CORS-Preflight
// zu vermeiden. GAS liefert den Body in e.postData.contents als String,
// den wir hier als JSON parsen.
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Kein Request-Body erhalten.");
    }

    var body   = JSON.parse(e.postData.contents);
    var action = (body.action || "").toString();

    if (action === "setattendance") {
      return jsonOutput_(setAttendance_(body));
    }

    return jsonOutput_({ ok: false, error: "unknown_action" });
  } catch (err) {
    return jsonOutput_({ ok: false, error: err.message });
  }
}
