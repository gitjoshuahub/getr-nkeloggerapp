// ====== KONFIGURATION ======
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfx9LSz3QW-pfn5TRkc8QvWIt025rIiKz2QrJLukZ4XytuYaCnAxZSLHBKj9gWLAnj/exec";
const HAUS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzypbqWCy5OsSqblD3KEsqK0RvfxqHnkw2hk_A94IO4ekGP5epvGouAJUwb4iZqr78/exec";
const API_KEY = "bier123";
const KATEGORIEN = [
  { label: "Haus", hasNameList: true, listKey: "haus" },
  { label: "Non Loci", hasNameList: true, listKey: "nonloci" },
  { label: "Philister", hasNameList: false, logName: "Philister" },
  { label: "Institut", hasNameList: false, logName: "Institut" },
  { label: "Couleur", hasNameList: false, logName: "Couleur", fullWidth: true }
];

// Muss mit MONTHS_AHEAD im GAS-Backend übereinstimmen
const MONTHS_AHEAD = 6;

let cfg = { haus: [], nonloci: [] };
let currentKat = null;
let currentName = null;
let flaschenWert = 1;
let kistenWert = 1;
const FLASCHEN_MAX = 19;
const KISTEN_MAX = 5;
const SESSION_KEY = "bier_session";
const CFG_CACHE_KEY = "bier_cfg";
const LAGER_CACHE_KEY = "bier_lager_cache";
const KAL_CACHE_KEY = "bier_kal_cache";
// Separater Cache-Key für Haus-Kalender
const HAUS_KAL_CACHE_KEY = "bier_haus_kal_cache";

let zahlungSelectedName = null;
let strafeSelectedName = null;
let aktuellerBereich = "kalender";

// Merkt sich pro Event den gesetzten Status (nur im RAM, reicht für Session)
let meineStatusMap = {};

// Kalender-Monatsnavigation (geteilt für beide Kalender-Bereiche)
let kalViewDate = new Date();

// ====== EVENT KEY ======
// Robuster Schlüssel: calendar|id|start|title — verhindert Kollisionen
// zwischen Haus- und Allgemein-Terminen mit gleichem Titel/Start
function getEventKey(ev) {
  return [ev.calendar || "", ev.id || "", ev.start || "", ev.title || ""].join("|");
}

function getSession(){ try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch(e){ return null; } }
function setSession(s){ localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession(){ localStorage.removeItem(SESSION_KEY); }

async function doLogin(){
  const name = document.getElementById("loginName").value.trim();
  const pw = document.getElementById("loginPw").value;
  const errEl = document.getElementById("loginError");
  errEl.classList.add("hidden");
  if(!name || !pw || pw.length < 4){
    errEl.textContent = "Bitte Name eingeben und Passwort mit mind. 4 Zeichen.";
    errEl.classList.remove("hidden");
    return;
  }
  if(!navigator.onLine){
    const cached = getSession();
    if(cached && cached.name.toLowerCase() === name.toLowerCase()){ enterApp(cached); return; }
    errEl.textContent = "Kein Netz -- Erstanmeldung braucht einmalig eine Verbindung.";
    errEl.classList.remove("hidden");
    return;
  }
  try{
    const url = new URL(SCRIPT_URL);
    url.searchParams.set("action","login");
    url.searchParams.set("name", name);
    url.searchParams.set("pw", pw);
    url.searchParams.set("key", API_KEY);
    const res = await fetch(url.toString());
    const data = await res.json();
    if(!data.ok){
      errEl.textContent = data.grund || "Anmeldung fehlgeschlagen.";
      errEl.classList.remove("hidden");
      return;
    }
    const session = { name: name, pw: pw, rolle: data.rolle || "mitglied" };
    setSession(session);
    if(data.neu){ toast("Willkommen " + name + "! Passwort wurde neu angelegt."); }
    enterApp(session);
  }catch(e){
    errEl.textContent = "Server nicht erreichbar. Bitte spaeter erneut versuchen.";
    errEl.classList.remove("hidden");
  }
}

function enterApp(session){
  document.getElementById("loginOverlay").classList.add("hidden");
  document.getElementById("appRoot").classList.remove("app-hidden");
  document.getElementById("loggedInName").textContent = session.name;
  document.getElementById("loggedInName").classList.remove("hidden");
  document.getElementById("logoutBtn").classList.remove("hidden");
  document.getElementById("bottomNav").style.display = "";

  // Admin-Tab
  const isAdmin = session.rolle === "admin" || session.rolle === "kassenwart";
  document.getElementById("tab-admin").style.display = isAdmin ? "" : "none";

  // Haus-Tab: nur für Mitglieder in cfg.haus – prüfen sobald Config geladen
  document.getElementById("nav-haus").style.display = "none";

  renderCats();
  updateStatus();
  loadCachedConfig();
  fetchConfig(true).then(() => applyHausTabVisibility(session));
  updateQueueBadge();
  restoreCachedStand();
  restoreCachedRangliste();
  restoreCachedLager();
  loadLager();
  kalViewDate = new Date();
  restoreCachedKalender();

  // Start auf Kalender
  switchBereich("kalender");
}

function applyHausTabVisibility(session){
  const name = session.name.toLowerCase();
  const istHaus = cfg.haus.some(h => h.toLowerCase() === name);
  document.getElementById("nav-haus").style.display = istHaus ? "" : "none";
}

function doLogout(){ clearSession(); location.reload(); }

function checkSessionOnLoad(){
  const s = getSession();
  if(s){ document.getElementById("loginName").value = s.name; enterApp(s); }
}

// ====== BEREICHE (Bottom-Nav) ======
function switchBereich(bereich){
  aktuellerBereich = bereich;
  ["getraenke","kalender","haus"].forEach(b => {
    document.getElementById("bereich-" + b).classList.toggle("hidden", b !== bereich);
    const btn = document.getElementById("nav-" + b);
    btn.className = b === bereich ? "active-" + b : "";
  });
  document.getElementById("getraenke-header").classList.toggle("hidden", bereich !== "getraenke");
  document.getElementById("kalender-header").classList.toggle("hidden", bereich !== "kalender");
  document.getElementById("haus-header").classList.toggle("hidden", bereich !== "haus");
  const titels = { getraenke: "Getränke", kalender: "Kalender", haus: "Haus" };
  document.getElementById("appTitle").textContent = titels[bereich] || "";
}

// ====== HAUS SUB-TABS ======
function switchHausTab(tab){
  ["kalender","aufgaben"].forEach(t => {
    document.getElementById("hausview-" + t).classList.toggle("hidden", t !== tab);
    document.getElementById("haustab-" + t).classList.toggle("active", t === tab);
  });
}

// ====== KALENDER (Allgemein) ======
function switchKalTab(tab){
  ["termine","meine"].forEach(t => {
    document.getElementById("kalview-" + t).classList.toggle("hidden", t !== tab);
    document.getElementById("kaltab-" + t).classList.toggle("active", t === tab);
  });
  if(tab === "meine") renderMeineZusagen();
}

// Monatsnavigation
function kalPrevMonth(){
  kalViewDate = new Date(kalViewDate.getFullYear(), kalViewDate.getMonth() - 1, 1);
  renderKalMonthNav();
  renderKalenderFromCache();
  renderHausKalenderFromCache();
}
function kalNextMonth(){
  kalViewDate = new Date(kalViewDate.getFullYear(), kalViewDate.getMonth() + 1, 1);
  renderKalMonthNav();
  renderKalenderFromCache();
  renderHausKalenderFromCache();
}
function kalResetMonth(){
  kalViewDate = new Date();
  renderKalMonthNav();
  renderKalenderFromCache();
  renderHausKalenderFromCache();
}

function renderKalMonthNav(){
  const now = new Date();
  const isCurrentMonth = kalViewDate.getFullYear() === now.getFullYear() && kalViewDate.getMonth() === now.getMonth();
  const label = kalViewDate.toLocaleString("de-DE", { month: "long", year: "numeric" });

  // Allgemein-Kalender
  const el = document.getElementById("kalMonthLabel");
  if(el) el.textContent = label;
  const todayBtn = document.getElementById("kalTodayBtn");
  if(todayBtn) todayBtn.style.display = isCurrentMonth ? "none" : "";

  // Haus-Kalender
  const hausEl = document.getElementById("hausMonthLabel");
  if(hausEl) hausEl.textContent = label;
  const hausTodayBtn = document.getElementById("hausTodayBtn");
  if(hausTodayBtn) hausTodayBtn.style.display = isCurrentMonth ? "none" : "";
}

function filterEventsByMonth(events){
  const y = kalViewDate.getFullYear();
  const m = kalViewDate.getMonth();
  return (events || []).filter(ev => {
    if(!ev.start) return false;
    const d = new Date(ev.start);
    return d.getFullYear() === y && d.getMonth() === m;
  });
}

// Filtert auf Kalender "allgemein" und aktuellen Monat
function filterAllgemeinEventsByMonth(events){
  return filterEventsByMonth((events || []).filter(ev => ev.calendar === "allgemein"));
}

// Filtert auf Kalender "haus" und aktuellen Monat
function filterHausEventsByMonth(events){
  return filterEventsByMonth((events || []).filter(ev => ev.calendar === "haus"));
}

function renderKalenderFromCache(){
  try{
    const raw = localStorage.getItem(KAL_CACHE_KEY);
    if(!raw){ renderEventListe([]); return; }
    const data = JSON.parse(raw);
    // Zeige nur allgemein-Termine im Kalender-Tab
    renderEventListe(filterAllgemeinEventsByMonth(data.events || []));
  }catch(e){ renderEventListe([]); }
}

function restoreCachedKalender(){
  try{
    const raw = localStorage.getItem(KAL_CACHE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    renderEventListe(filterAllgemeinEventsByMonth(data.events || []));
    const hint = document.getElementById("kalenderCacheHint");
    if(hint && data.ts) hint.textContent = "Cache: " + formatCacheTime(data.ts.toString()) + " Uhr";
  }catch(e){}
  renderKalMonthNav();
}

async function loadKalender(){
  const liste = document.getElementById("kalenderListe");
  const hint  = document.getElementById("kalenderCacheHint");
  liste.innerHTML = '<div class="kal-loading">⏳ Lade Termine…</div>';
  hint.textContent = "";

  if(!navigator.onLine){
    renderKalenderFromCache();
    if(hint) hint.textContent = "Offline – Cache angezeigt";
    return;
  }

  try{
    const url = new URL(HAUS_SCRIPT_URL);
    url.searchParams.set("action", "getevents");
    // Beide Kalender laden und gemeinsam cachen
    url.searchParams.set("key", API_KEY);
    const res = await fetchWithTimeout(url.toString(), 15000);
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || "Fehler vom Server");
    const events = data.events || [];
    const now = Date.now();
    // Gemeinsamer Cache für beide Kalender
    localStorage.setItem(KAL_CACHE_KEY, JSON.stringify({ events, ts: now }));
    if(hint) hint.textContent = "Geladen: " + formatCacheTime(now.toString()) + " Uhr";
    // Kalender-Tab zeigt nur "allgemein"
    renderEventListe(filterAllgemeinEventsByMonth(events));
  }catch(e){
    liste.innerHTML = '<div class="kal-empty">⚠️ ' + e.message + '</div>';
    renderKalenderFromCache();
  }
}

function renderEventListe(events){
  const liste = document.getElementById("kalenderListe");
  renderKalMonthNav();
  if(!events || events.length === 0){
    liste.innerHTML = '<div class="kal-empty">Keine Termine in diesem Monat.</div>';
    return;
  }
  liste.innerHTML = "";
  events.forEach(ev => {
    const card = document.createElement("div");
    card.className = "event-card";
    const start = ev.start ? new Date(ev.start) : null;
    const when = start ? start.toLocaleString("de-DE", {
      weekday:"short", day:"2-digit", month:"2-digit", year:"2-digit",
      hour:"2-digit", minute:"2-digit"
    }) : "";
    const evKey = getEventKey(ev);
    const currentStatus = meineStatusMap[evKey] || null;
    card.innerHTML = `
      <h3>${escHtml(ev.title || "Ohne Titel")}</h3>
      <div class="event-meta">
        ${when ? '<span>🕐 ' + when + '</span>' : ''}
        ${ev.location ? '<span>📍 ' + escHtml(ev.location) + '</span>' : ''}
        ${ev.description ? '<span style="color:var(--muted);font-size:11px;">' + escHtml(ev.description) + '</span>' : ''}
      </div>
      <div class="event-actions" id="evact-${escHtml(evKey)}">
        <button class="${currentStatus==='dabei'?'status-dabei':''}" onclick="setAttendance(${JSON.stringify(ev)}, 'dabei', this)">✅ Dabei</button>
        <button class="${currentStatus==='vielleicht'?'status-vielleicht':''}" onclick="setAttendance(${JSON.stringify(ev)}, 'vielleicht', this)">❔ Evtl.</button>
        <button class="${currentStatus==='abgesagt'?'status-abgesagt':''}" onclick="setAttendance(${JSON.stringify(ev)}, 'abgesagt', this)">❌ Absage</button>
      </div>
      ${ev.teilnehmer && ev.teilnehmer.length ? '<div class="event-teilnehmer">👥 ' + ev.teilnehmer.map(t=>escHtml(t)).join(', ') + '</div>' : ''}
    `;
    liste.appendChild(card);
  });
}

// ====== HAUS-KALENDER ======
function renderHausKalenderFromCache(){
  try{
    const raw = localStorage.getItem(KAL_CACHE_KEY);
    if(!raw){ renderHausEventListe([]); return; }
    const data = JSON.parse(raw);
    renderHausEventListe(filterHausEventsByMonth(data.events || []));
  }catch(e){ renderHausEventListe([]); }
}

async function loadHausKalender(){
  const liste = document.getElementById("hausKalenderListe");
  const hint  = document.getElementById("hausKalenderCacheHint");
  if(!liste) return;
  liste.innerHTML = '<div class="kal-loading">⏳ Lade Haus-Termine…</div>';
  if(hint) hint.textContent = "";

  if(!navigator.onLine){
    renderHausKalenderFromCache();
    if(hint) hint.textContent = "Offline – Cache angezeigt";
    return;
  }

  try{
    const url = new URL(HAUS_SCRIPT_URL);
    url.searchParams.set("action", "getevents");
    // Nur Haus-Kalender abrufen
    url.searchParams.set("kalender", "haus");
    url.searchParams.set("key", API_KEY);
    const res = await fetchWithTimeout(url.toString(), 15000);
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || "Fehler vom Server");

    // Haus-Events in den gemeinsamen Cache mergen
    // (erhalte allgemein-Events, ersetze haus-Events)
    let allEvents = [];
    try{
      const existing = JSON.parse(localStorage.getItem(KAL_CACHE_KEY) || "{}");
      allEvents = (existing.events || []).filter(ev => ev.calendar !== "haus");
    }catch(e){}
    allEvents = allEvents.concat(data.events || []);
    allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

    const now = Date.now();
    localStorage.setItem(KAL_CACHE_KEY, JSON.stringify({ events: allEvents, ts: now }));
    if(hint) hint.textContent = "Geladen: " + formatCacheTime(now.toString()) + " Uhr";
    renderHausEventListe(filterHausEventsByMonth(data.events || []));
  }catch(e){
    if(liste) liste.innerHTML = '<div class="kal-empty">⚠️ ' + e.message + '</div>';
    renderHausKalenderFromCache();
  }
}

function renderHausEventListe(events){
  const liste = document.getElementById("hausKalenderListe");
  if(!liste) return;
  renderKalMonthNav();
  if(!events || events.length === 0){
    liste.innerHTML = '<div class="kal-empty">Keine Haus-Termine in diesem Monat.</div>';
    return;
  }
  liste.innerHTML = "";
  events.forEach(ev => {
    const card = document.createElement("div");
    card.className = "event-card";
    const start = ev.start ? new Date(ev.start) : null;
    const when = start ? start.toLocaleString("de-DE", {
      weekday:"short", day:"2-digit", month:"2-digit", year:"2-digit",
      hour:"2-digit", minute:"2-digit"
    }) : "";
    const evKey = getEventKey(ev);
    const currentStatus = meineStatusMap[evKey] || null;
    card.innerHTML = `
      <h3>${escHtml(ev.title || "Ohne Titel")}</h3>
      <div class="event-meta">
        ${when ? '<span>🕐 ' + when + '</span>' : ''}
        ${ev.location ? '<span>📍 ' + escHtml(ev.location) + '</span>' : ''}
        ${ev.description ? '<span style="color:var(--muted);font-size:11px;">' + escHtml(ev.description) + '</span>' : ''}
      </div>
      <div class="event-actions" id="evact-haus-${escHtml(evKey)}">
        <button class="${currentStatus==='dabei'?'status-dabei':''}" onclick="setAttendance(${JSON.stringify(ev)}, 'dabei', this)">✅ Dabei</button>
        <button class="${currentStatus==='vielleicht'?'status-vielleicht':''}" onclick="setAttendance(${JSON.stringify(ev)}, 'vielleicht', this)">❔ Evtl.</button>
        <button class="${currentStatus==='abgesagt'?'status-abgesagt':''}" onclick="setAttendance(${JSON.stringify(ev)}, 'abgesagt', this)">❌ Absage</button>
      </div>
    `;
    liste.appendChild(card);
  });
}

// ====== SETATTENDANCE ======
// WICHTIG: GAS Web-Apps antworten auf /exec mit 302-Redirect.
// Browser wandeln POST->GET um und verlieren dabei den Body.
// Deshalb: GET mit Query-Parametern verwenden (wie der Rest der App auch).
async function setAttendance(ev, status, btn){
  const session = getSession();
  if(!session){ toast("Bitte erst anmelden."); return; }

  const evKey = getEventKey(ev);

  // Buttons im Block sofort markieren (optimistic UI)
  const actionsDiv = btn.closest(".event-actions");
  if(actionsDiv){
    actionsDiv.querySelectorAll("button").forEach(b => b.className = "");
    const cls = status === "dabei" ? "status-dabei" : status === "vielleicht" ? "status-vielleicht" : "status-abgesagt";
    btn.className = cls;
  }
  meineStatusMap[evKey] = status;

  if(!navigator.onLine){
    toast("Offline – Status wird beim nächsten Sync gespeichert");
    return;
  }

  try{
    const url = new URL(HAUS_SCRIPT_URL);
    url.searchParams.set("action", "setattendance");
    url.searchParams.set("event_id", ev.id || "");
    url.searchParams.set("event_start", ev.start ? ev.start.toString() : "");
    url.searchParams.set("event_title", ev.title || "");
    url.searchParams.set("kalender", ev.calendar || "");
    url.searchParams.set("name", session.name);
    url.searchParams.set("status", status);
    url.searchParams.set("key", API_KEY);

    const res = await fetchWithTimeout(url.toString(), 15000);
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || "Fehler");
    toast("✓ Status gespeichert");
  }catch(e){
    toast("⚠️ " + e.message);
  }
}

function renderMeineZusagen(){
  const liste = document.getElementById("meineZusagenListe");
  try{
    const raw = localStorage.getItem(KAL_CACHE_KEY);
    if(!raw){ liste.innerHTML = '<div class="kal-empty">Termine noch nicht geladen.</div>'; return; }
    const { events } = JSON.parse(raw);
    const meine = (events || []).filter(ev => {
      const k = getEventKey(ev);
      return meineStatusMap[k] === "dabei" || meineStatusMap[k] === "vielleicht";
    });
    if(!meine.length){ liste.innerHTML = '<div class="kal-empty">Noch keine Zusagen.</div>'; return; }
    liste.innerHTML = "";
    meine.forEach(ev => {
      const start = ev.start ? new Date(ev.start) : null;
      const when = start ? start.toLocaleString("de-DE", { weekday:"short", day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" }) : "";
      const evKey = getEventKey(ev);
      const s = meineStatusMap[evKey];
      const badge = s === "dabei" ? "<span style='color:var(--ok);font-size:12px;'>✅ Dabei</span>" : "<span style='color:#ffd;font-size:12px;'>❔ Vielleicht</span>";
      const calBadge = ev.calendar === "haus" ? " <span style='font-size:10px;color:var(--muted);'>🏠</span>" : "";
      const d = document.createElement("div");
      d.className = "event-card";
      d.innerHTML = `<h3>${escHtml(ev.title||'')}${calBadge}</h3><div class="event-meta"><span>🕐 ${when}</span></div>${badge}`;
      liste.appendChild(d);
    });
  }catch(e){
    liste.innerHTML = '<div class="kal-empty">Fehler beim Laden.</div>';
  }
}

function escHtml(s){
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ====== STATUS / OFFLINE ======
function updateQueueBadge(){
  const b = document.getElementById("queueBadge");
  if(b) b.classList.add("hidden");
}

function updateStatus(){
  const dot = document.getElementById("statusDot");
  const txt = document.getElementById("statusText");
  const banner = document.getElementById("offlineBanner");
  const isOnline = navigator.onLine;
  if(isOnline){
    dot.classList.add("online"); txt.textContent="online";
    if(banner) banner.classList.add("hidden");
  } else {
    dot.classList.remove("online"); txt.textContent="offline";
    if(banner) banner.classList.remove("hidden");
  }
}
window.addEventListener("online", updateStatus);
window.addEventListener("offline", updateStatus);
setInterval(updateStatus, 15000);

// ====== HTTP HELPERS ======
function buildUrl(params){
  const u = new URL(SCRIPT_URL);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
  u.searchParams.set("key", API_KEY);
  return u.toString();
}

function fetchWithTimeout(url, ms = 15000){
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(t));
}

async function rawGet(params, silent){
  try{
    const res = await fetch(buildUrl(params), { method:"GET" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if(!silent) toast(text);
    return true;
  }catch(e){ return false; }
}

let sendingInProgress = false;
async function sendAction(params){
  if(sendingInProgress){
    toast("Bitte warten – vorherige Buchung läuft noch");
    return false;
  }
  sendingInProgress = true;
  setSendButtonsEnabled(false);
  const session = getSession();
  params.panel = (session ? session.name : "Unbekannt") + "PWA";
  try{
    const res = await fetchWithTimeout(buildUrl(params), 15000);
    if(!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    toast(text || "Gebucht!");
    return true;
  }catch(e){
    if(e.name === "AbortError"){
      toast("⏰ Zeitüberschreitung – Aktion wurde evtl. trotzdem gespeichert. Bitte prüfen!");
    } else {
      toast("⚠️ Verbindungsfehler – Aktion wurde evtl. trotzdem gespeichert. Bitte prüfen!");
    }
    return false;
  } finally {
    sendingInProgress = false;
    setSendButtonsEnabled(true);
  }
}

function setSendButtonsEnabled(enabled){
  document.querySelectorAll(".btn-accent, .anzahl-btn, .name-btn, .btn-ok")
    .forEach(btn => { btn.disabled = !enabled; });
}

let toastTimer;
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove("show"), 2500);
}

function formatCacheTime(tsStr){
  if(!tsStr) return "";
  const d = new Date(parseInt(tsStr));
  if(isNaN(d)) return "";
  return d.toLocaleString("de-DE", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}

// ====== CONFIG ======
function loadCachedConfig(){
  try{
    const raw = localStorage.getItem(CFG_CACHE_KEY);
    if(!raw) return false;
    const data = JSON.parse(raw);
    cfg.haus    = Array.isArray(data.haus)    ? data.haus    : [];
    cfg.nonloci = Array.isArray(data.nonloci) ? data.nonloci : [];
    const tsEl = document.getElementById("cfgTimestamp");
    if(tsEl && data.ts) tsEl.textContent = "Zuletzt aktualisiert: " + formatCacheTime(data.ts.toString()) + " Uhr";
    renderAdminNameLists();
    return true;
  }catch(e){ return false; }
}

async function fetchConfig(background = false){
  if(!navigator.onLine){ loadCachedConfig(); return; }
  try{
    const res = await fetchWithTimeout(buildUrl({action:"getconfig"}), 10000);
    const data = await res.json();
    cfg.haus    = Array.isArray(data.haus)    ? data.haus    : [];
    cfg.nonloci = Array.isArray(data.nonloci) ? data.nonloci : [];
    const now = Date.now();
    localStorage.setItem(CFG_CACHE_KEY, JSON.stringify({ haus: cfg.haus, nonloci: cfg.nonloci, ts: now }));
    const tsEl = document.getElementById("cfgTimestamp");
    if(tsEl) tsEl.textContent = "Zuletzt aktualisiert: " + formatCacheTime(now.toString()) + " Uhr";
    renderAdminNameLists();
    if(currentKat && currentKat.hasNameList) showNames();
  }catch(e){
    if(!background) loadCachedConfig();
  }
}

// ====== GETRÄNKE: KATEGORIEN & BUCHEN ======
function renderCats(){
  const grid = document.getElementById("catGrid");
  grid.innerHTML = "";
  KATEGORIEN.forEach((k, idx)=>{
    const b = document.createElement("button");
    b.textContent = k.label;
    if(k.hasNameList){ b.className = "btn-accent"; } else { b.className = "btn-outline"; }
    if(k.fullWidth){ b.style.gridColumn = "1 / -1"; }
    b.onclick = ()=> selectCat(idx);
    grid.appendChild(b);
  });
}

function selectCat(idx){
  currentKat = KATEGORIEN[idx];
  if(currentKat.hasNameList){ showNames(); } else { currentName = currentKat.logName; showMenge(); }
}

function showCats(){
  document.getElementById("catCard").classList.remove("hidden");
  document.getElementById("nameCard").classList.add("hidden");
  document.getElementById("mengeCard").classList.add("hidden");
  document.getElementById("stornoCard").classList.remove("hidden");
}

function showNames(){
  document.getElementById("catCard").classList.add("hidden");
  document.getElementById("nameCard").classList.remove("hidden");
  document.getElementById("mengeCard").classList.add("hidden");
  document.getElementById("stornoCard").classList.add("hidden");
  document.getElementById("nameCardTitle").textContent = currentKat.label + " – wer?";
  const list = currentKat.listKey === "haus" ? cfg.haus : cfg.nonloci;
  const wrap = document.getElementById("nameList");
  wrap.innerHTML = "";
  if(!list || list.length === 0){
    wrap.innerHTML = "<p style='color:var(--muted);font-size:.85rem;padding:.5rem 0'>Keine Namen im Cache – wird geladen…</p>";
  } else {
    list.forEach(name=>{
      const b = document.createElement("button");
      b.textContent = name;
      b.onclick = ()=>{ currentName = name; showMenge(); };
      wrap.appendChild(b);
    });
  }
  const tsEl = document.getElementById("cfgTimestamp");
  if(tsEl && !tsEl.textContent){
    try{
      const raw = localStorage.getItem(CFG_CACHE_KEY);
      if(raw){ const d = JSON.parse(raw); if(d.ts) tsEl.textContent = "Zuletzt aktualisiert: " + formatCacheTime(d.ts.toString()) + " Uhr"; }
    }catch(e){}
  }
}

function showMenge(){
  document.getElementById("catCard").classList.add("hidden");
  document.getElementById("nameCard").classList.add("hidden");
  document.getElementById("mengeCard").classList.remove("hidden");
  document.getElementById("stornoCard").classList.add("hidden");
  document.getElementById("mengeTitle").textContent = currentName;
  flaschenWert = 1; kistenWert = 1;
  renderMengeSteppers();
}

function renderMengeSteppers(){
  const grid = document.getElementById("mengeGrid");
  grid.innerHTML = "";
  const flWrap = document.createElement("div");
  flWrap.className = "stepper-block";
  const flLabel = document.createElement("div");
  flLabel.className = "stepper-label"; flLabel.textContent = "Flaschen";
  flWrap.appendChild(flLabel);
  flWrap.appendChild(buildAnzahlGrid(FLASCHEN_MAX, "flasche"));
  grid.appendChild(flWrap);
  const kiWrap = document.createElement("div");
  kiWrap.className = "stepper-block";
  const kiLabel = document.createElement("div");
  kiLabel.className = "stepper-label"; kiLabel.textContent = "Kästen";
  kiWrap.appendChild(kiLabel);
  kiWrap.appendChild(buildAnzahlGrid(KISTEN_MAX, "kasten"));
  grid.appendChild(kiWrap);
}

function buildAnzahlGrid(max, typ){
  const wrap = document.createElement("div");
  wrap.className = "anzahl-grid";
  for(let i = 1; i <= max; i++){
    const b = document.createElement("button");
    b.textContent = i; b.className = "anzahl-btn";
    b.onclick = () => logBuchung(i, typ);
    wrap.appendChild(b);
  }
  return wrap;
}

function backFromMenge(){
  if(currentKat.hasNameList){ showNames(); } else { showCats(); }
}

async function logBuchung(anzahl, typ){
  const ok = await sendAction({ name: currentName, menge: anzahl, typ: typ });
  if(ok){ showCats(); }
}

// ====== ADMIN: NAMENSLISTEN ======
function renderAdminNameLists(){
  const allePersonen = [...cfg.haus, ...cfg.nonloci];
  ["zahlungNameList","strafeNameList"].forEach(listId => {
    const el = document.getElementById(listId);
    if(!el) return;
    el.innerHTML = "";
    const typ = listId.startsWith("zahlung") ? "zahlung" : "strafe";
    allePersonen.forEach(name => {
      const b = document.createElement("button");
      b.textContent = name;
      b.onclick = () => selectAdminName(typ, name, b);
      el.appendChild(b);
    });
  });
}

function selectAdminName(typ, name, btn){
  const listId = typ === "zahlung" ? "zahlungNameList" : "strafeNameList";
  document.getElementById(listId).querySelectorAll("button").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  if(typ === "zahlung") zahlungSelectedName = name;
  else strafeSelectedName = name;
}

async function doZahlung(){
  if(!zahlungSelectedName){ toast("Bitte zuerst eine Person auswählen."); return; }
  const betragRaw = document.getElementById("zahlungBetrag").value.replace(",",".");
  const betrag = parseFloat(betragRaw);
  if(!betrag || betrag <= 0){ toast("Bitte einen gültigen Betrag eingeben."); return; }
  if(!navigator.onLine){ toast("Kein Netz – Zahlung nicht möglich."); return; }
  const ok = await sendAction({ action:"zahlung", name: zahlungSelectedName, betrag: betrag });
  if(ok){
    document.getElementById("zahlungBetrag").value = "";
    document.getElementById("zahlungNameList").querySelectorAll("button").forEach(b => b.classList.remove("selected"));
    zahlungSelectedName = null;
  }
}

async function doStrafe(){
  if(!strafeSelectedName){ toast("Bitte zuerst eine Person auswählen."); return; }
  const betragRaw = document.getElementById("strafeBetrag").value.replace(",",".");
  const betrag = parseFloat(betragRaw);
  if(!betrag || betrag <= 0){ toast("Bitte einen gültigen Betrag eingeben."); return; }
  const grund = document.getElementById("strafeGrund").value.trim();
  if(!navigator.onLine){ toast("Kein Netz – Strafe nicht möglich."); return; }
  const params = { action:"strafe", name: strafeSelectedName, betrag: betrag };
  if(grund) params.grund = grund;
  const ok = await sendAction(params);
  if(ok){
    document.getElementById("strafeBetrag").value = "";
    document.getElementById("strafeGrund").value = "";
    document.getElementById("strafeNameList").querySelectorAll("button").forEach(b => b.classList.remove("selected"));
    strafeSelectedName = null;
  }
}

// ====== STAND & RANGLISTE ======
const STAND_CACHE_KEY          = "bier_stand_cache";
const STAND_CACHE_TIME_KEY     = "bier_stand_cache_time";
const RANGLISTE_CACHE_KEY      = "bier_rangliste_cache";
const RANGLISTE_CACHE_TIME_KEY = "bier_rangliste_cache_time";

function switchStandTab(tab){
  ["abrechnung","rangliste"].forEach(t=>{
    document.getElementById("subview-"+t).classList.toggle("hidden", t!==tab);
    document.getElementById("subtab-"+t).classList.toggle("active", t===tab);
  });
}

function restoreCachedStand(){
  const cached = localStorage.getItem(STAND_CACHE_KEY);
  const ts     = localStorage.getItem(STAND_CACHE_TIME_KEY);
  const div    = document.getElementById("standResult");
  const hint   = document.getElementById("standCacheHint");
  if(cached && div){
    div.textContent = cached;
    if(hint) hint.textContent = "Geladen: " + formatCacheTime(ts);
  }
}

function restoreCachedRangliste(){
  const cached = localStorage.getItem(RANGLISTE_CACHE_KEY);
  const ts     = localStorage.getItem(RANGLISTE_CACHE_TIME_KEY);
  const div    = document.getElementById("ranglisteResult");
  const hint   = document.getElementById("ranglisteCacheHint");
  if(cached && div){
    div.textContent = cached;
    if(hint) hint.textContent = "Geladen: " + formatCacheTime(ts);
  }
}

async function loadStand(){
  const div  = document.getElementById("standResult");
  const hint = document.getElementById("standCacheHint");
  div.textContent = "Lade..."; hint.textContent = "";
  if(!navigator.onLine){
    const cached = localStorage.getItem(STAND_CACHE_KEY);
    const ts     = localStorage.getItem(STAND_CACHE_TIME_KEY);
    div.textContent = cached || "Kein Netz und kein gespeicherter Stand vorhanden.";
    if(cached && hint) hint.textContent = "Offline – zuletzt geladen: " + formatCacheTime(ts);
    return;
  }
  try{
    const res = await fetchWithTimeout(buildUrl({action:"stand"}), 15000);
    if(!res.ok){ div.textContent = "Serverfehler (HTTP " + res.status + ")."; return; }
    const text = await res.text();
    if(!text || text.trim().length === 0){ div.textContent = "Server hat leere Antwort geschickt."; return; }
    div.textContent = text;
    const now = Date.now().toString();
    localStorage.setItem(STAND_CACHE_KEY, text);
    localStorage.setItem(STAND_CACHE_TIME_KEY, now);
    if(hint) hint.textContent = "Geladen: " + formatCacheTime(now);
  }catch(e){
    const cached = localStorage.getItem(STAND_CACHE_KEY);
    const ts     = localStorage.getItem(STAND_CACHE_TIME_KEY);
    div.textContent = (e.name==="AbortError" ? "Zeitüberschreitung." : "Fehler beim Laden.") +
      (cached ? "\n\n" + cached : "");
    if(cached && hint) hint.textContent = "Offline – zuletzt geladen: " + formatCacheTime(ts);
  }
}

async function loadRangliste(){
  const div  = document.getElementById("ranglisteResult");
  const hint = document.getElementById("ranglisteCacheHint");
  div.textContent = "Lade... (kann bis zu 45 Sek. dauern)"; hint.textContent = "";
  if(!navigator.onLine){
    const cached = localStorage.getItem(RANGLISTE_CACHE_KEY);
    const ts     = localStorage.getItem(RANGLISTE_CACHE_TIME_KEY);
    div.textContent = cached || "Kein Netz und keine gespeicherte Rangliste vorhanden.";
    if(cached && hint) hint.textContent = "Offline – zuletzt geladen: " + formatCacheTime(ts);
    return;
  }
  try{
    const res = await fetchWithTimeout(buildUrl({action:"semester"}), 45000);
    if(!res.ok){ div.textContent = "Serverfehler (HTTP " + res.status + ")."; return; }
    const text = await res.text();
    if(!text || text.trim().length === 0){ div.textContent = "Server hat leere Antwort geschickt."; return; }
    div.textContent = text;
    const now = Date.now().toString();
    localStorage.setItem(RANGLISTE_CACHE_KEY, text);
    localStorage.setItem(RANGLISTE_CACHE_TIME_KEY, now);
    if(hint) hint.textContent = "Geladen: " + formatCacheTime(now);
  }catch(e){
    const cached = localStorage.getItem(RANGLISTE_CACHE_KEY);
    const ts     = localStorage.getItem(RANGLISTE_CACHE_TIME_KEY);
    div.textContent = (e.name==="AbortError" ? "Zeitüberschreitung – Server zu langsam." : "Fehler beim Laden.") +
      (cached ? "\n\nZuletzt gespeichert:\n" + cached : "");
    if(cached && hint) hint.textContent = "Offline – zuletzt geladen: " + formatCacheTime(ts);
  }
}

// ====== STORNO ======
async function doStorno(){
  if(!navigator.onLine){ toast("Kein Netz -- Storno nicht möglich."); return; }
  try{
    const res = await fetchWithTimeout(buildUrl({action:"storno"}), 15000);
    if(!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    toast(text || "Storno verarbeitet.");
  }catch(e){
    if(e.name === "AbortError"){
      toast("⏰ Zeitüberschreitung – Storno wurde evtl. trotzdem ausgeführt. Bitte Stand prüfen!");
    } else {
      toast("⚠️ Verbindungsfehler beim Storno – bitte Stand prüfen, es könnte trotzdem geklappt haben.");
    }
  }
}

// ====== LAGER ======
function restoreCachedLager(){
  try{
    const raw = localStorage.getItem(LAGER_CACHE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    const numEl = document.getElementById("lagerBestandNum");
    const tsEl  = document.getElementById("lagerTimestamp");
    if(numEl) numEl.textContent = data.bestand ?? "–";
    if(tsEl && data.ts) tsEl.textContent = "Cache: " + formatCacheTime(data.ts.toString()) + " Uhr";
  }catch(e){}
}

async function loadLager(){
  const numEl = document.getElementById("lagerBestandNum");
  const tsEl  = document.getElementById("lagerTimestamp");
  if(numEl) numEl.textContent = "…";
  if(tsEl)  tsEl.textContent  = "Lädt…";
  if(!navigator.onLine){
    restoreCachedLager();
    if(tsEl) tsEl.textContent += " (offline)";
    return;
  }
  try{
    const res  = await fetchWithTimeout(buildUrl({action:"getlager"}), 15000);
    const data = await res.json();
    const now  = Date.now();
    localStorage.setItem(LAGER_CACHE_KEY, JSON.stringify({ bestand: data.bestand, ts: now }));
    if(numEl) numEl.textContent = data.bestand ?? "–";
    if(tsEl)  tsEl.textContent  = "Aktualisiert: " + formatCacheTime(now.toString()) + " Uhr";
  }catch(e){
    restoreCachedLager();
    if(tsEl) tsEl.textContent += " (Fehler – Cache)";
  }
}

async function doEinkauf(){
  const kisten = document.getElementById("einkaufKisten").value;
  if(!kisten || kisten <= 0){ toast("Bitte Anzahl Kisten eingeben"); return; }
  await sendAction({ action:"einkauf", menge:kisten, typ:"kasten" });
}

async function doInventur(){
  const flaschen = document.getElementById("inventurFlaschen").value;
  if(!flaschen){ toast("Bitte Flaschenzahl eingeben"); return; }
  await sendAction({ action:"inventur", menge:flaschen });
}

// ====== GETRÄNKE: INTERNER TAB-WECHSEL ======
function switchTab(tab){
  ["log","stand","admin"].forEach(t=>{
    document.getElementById("view-"+t).classList.toggle("hidden", t!==tab);
    document.getElementById("tab-"+t).classList.toggle("active", t===tab);
  });
  if(tab === "admin") restoreCachedLager();
}

// ====== INIT ======
checkSessionOnLoad();

if("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")
      .then(reg => console.log("SW registriert", reg.scope))
      .catch(err => console.error("SW Registrierung fehlgeschlagen", err));
  });
}
