// ====== KONFIGURATION ======
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfx9LSz3QW-pfn5TRkc8QvWIt025rIiKz2QrJLukZ4XytuYaCnAxZSLHBKj9gWLAnj/exec";
const API_KEY = "bier123";
const KATEGORIEN = [
  { label: "Haus", hasNameList: true, listKey: "haus" },
  { label: "Non Loci", hasNameList: true, listKey: "nonloci" },
  { label: "Philister", hasNameList: false, logName: "Philister" },
  { label: "Institut", hasNameList: false, logName: "Institut" },
  { label: "Couleur", hasNameList: false, logName: "Couleur", fullWidth: true }
];

let cfg = { haus: [], nonloci: [] };
let currentKat = null;
let currentName = null;
let flaschenWert = 1;
let kistenWert = 1;
const FLASCHEN_MAX = 19;
const KISTEN_MAX = 5;
const SESSION_KEY = "bier_session";

// Admin-Auswahl State
let zahlungSelectedName = null;
let strafeSelectedName = null;

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
  const isAdmin = session.rolle === "admin" || session.rolle === "kassenwart";
  document.getElementById("tab-admin").style.display = isAdmin ? "" : "none";
  renderCats();
  updateStatus();
  fetchConfig();
  updateQueueBadge();
  restoreCachedStand();
  restoreCachedRangliste();
}

function doLogout(){ clearSession(); location.reload(); }

function checkSessionOnLoad(){
  const s = getSession();
  if(s){ document.getElementById("loginName").value = s.name; enterApp(s); }
}

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
    const res = await fetchWithTimeout(buildUrl(params));
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
    toast("Fehler – Buchung wurde NICHT gespeichert. Bitte erneut versuchen.");
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

async function fetchConfig(){
  if(!navigator.onLine){
    const cached = localStorage.getItem("bier_cfg");
    if(cached) cfg = JSON.parse(cached);
    renderAdminNameLists();
    return;
  }
  try{
    const res = await fetchWithTimeout(buildUrl({action:"getconfig"}));
    const data = await res.json();
    cfg.haus = data.haus || [];
    cfg.nonloci = data.nonloci || [];
    localStorage.setItem("bier_cfg", JSON.stringify(cfg));
  }catch(e){
    const cached = localStorage.getItem("bier_cfg");
    if(cached) cfg = JSON.parse(cached);
  }
  renderAdminNameLists();
}

function renderCats(){
  const grid = document.getElementById("catGrid");
  grid.innerHTML = "";
  KATEGORIEN.forEach((k, idx)=>{
    const b = document.createElement("button");
    b.textContent = k.label;
    // Haus & Non Loci: ausgefüllt (btn-accent)
    // Philister, Institut, Couleur: nur Rahmen (btn-outline)
    if(k.hasNameList){
      b.className = "btn-accent";
    } else {
      b.className = "btn-outline";
    }
    // Couleur nimmt zwei Spalten ein
    if(k.fullWidth){
      b.style.gridColumn = "1 / -1";
    }
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
  // Storno-Karte immer sichtbar
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
  list.forEach(name=>{
    const b = document.createElement("button");
    b.textContent = name;
    b.onclick = ()=>{ currentName = name; showMenge(); };
    wrap.appendChild(b);
  });
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
  flLabel.className = "stepper-label";
  flLabel.textContent = "Flaschen";
  flWrap.appendChild(flLabel);
  flWrap.appendChild(buildAnzahlGrid(FLASCHEN_MAX, "flasche"));
  grid.appendChild(flWrap);

  const kiWrap = document.createElement("div");
  kiWrap.className = "stepper-block";
  const kiLabel = document.createElement("div");
  kiLabel.className = "stepper-label";
  kiLabel.textContent = "Kästen";
  kiWrap.appendChild(kiLabel);
  kiWrap.appendChild(buildAnzahlGrid(KISTEN_MAX, "kasten"));
  grid.appendChild(kiWrap);
}

function buildAnzahlGrid(max, typ){
  const wrap = document.createElement("div");
  wrap.className = "anzahl-grid";
  for(let i = 1; i <= max; i++){
    const b = document.createElement("button");
    b.textContent = i;
    b.className = "anzahl-btn";
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

// ====== ADMIN: Nameslisten rendern ======
function renderAdminNameLists(){
  const allePersonen = [...cfg.haus, ...cfg.nonloci];

  const zahlungList = document.getElementById("zahlungNameList");
  if(zahlungList){
    zahlungList.innerHTML = "";
    allePersonen.forEach(name => {
      const b = document.createElement("button");
      b.textContent = name;
      b.onclick = () => selectAdminName("zahlung", name, b);
      zahlungList.appendChild(b);
    });
  }

  const strafeList = document.getElementById("strafeNameList");
  if(strafeList){
    strafeList.innerHTML = "";
    allePersonen.forEach(name => {
      const b = document.createElement("button");
      b.textContent = name;
      b.onclick = () => selectAdminName("strafe", name, b);
      strafeList.appendChild(b);
    });
  }
}

function selectAdminName(typ, name, btn){
  const listId = typ === "zahlung" ? "zahlungNameList" : "strafeNameList";
  const badgeId = typ === "zahlung" ? "zahlungSelectedBadge" : "strafeSelectedBadge";
  document.getElementById(listId).querySelectorAll("button").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");
  const badge = document.getElementById(badgeId);
  badge.textContent = "✓ " + name;
  badge.classList.remove("hidden");
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
    document.getElementById("zahlungSelectedBadge").classList.add("hidden");
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
    document.getElementById("strafeSelectedBadge").classList.add("hidden");
    strafeSelectedName = null;
  }
}

// ====== STAND-TAB: Sub-Tabs ======
const STAND_CACHE_KEY = "bier_stand_cache";
const STAND_CACHE_TIME_KEY = "bier_stand_cache_time";
const RANGLISTE_CACHE_KEY = "bier_rangliste_cache";
const RANGLISTE_CACHE_TIME_KEY = "bier_rangliste_cache_time";

function formatCacheTime(tsStr){
  if(!tsStr) return "";
  const d = new Date(parseInt(tsStr));
  if(isNaN(d)) return "";
  return d.toLocaleString("de-DE", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function switchStandTab(tab){
  ["abrechnung","rangliste"].forEach(t=>{
    document.getElementById("subview-"+t).classList.toggle("hidden", t!==tab);
    document.getElementById("subtab-"+t).classList.toggle("active", t===tab);
  });
}

function restoreCachedStand(){
  const cached = localStorage.getItem(STAND_CACHE_KEY);
  const ts = localStorage.getItem(STAND_CACHE_TIME_KEY);
  const div = document.getElementById("standResult");
  const hint = document.getElementById("standCacheHint");
  if(cached && div){
    div.textContent = cached;
    if(hint) hint.textContent = "Geladen: " + formatCacheTime(ts);
  }
}

function restoreCachedRangliste(){
  const cached = localStorage.getItem(RANGLISTE_CACHE_KEY);
  const ts = localStorage.getItem(RANGLISTE_CACHE_TIME_KEY);
  const div = document.getElementById("ranglisteResult");
  const hint = document.getElementById("ranglisteCacheHint");
  if(cached && div){
    div.textContent = cached;
    if(hint) hint.textContent = "Geladen: " + formatCacheTime(ts);
  }
}

async function loadStand(){
  const div = document.getElementById("standResult");
  const hint = document.getElementById("standCacheHint");
  div.textContent = "Lade...";
  hint.textContent = "";
  if(!navigator.onLine){
    const cached = localStorage.getItem(STAND_CACHE_KEY);
    const ts = localStorage.getItem(STAND_CACHE_TIME_KEY);
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
    const ts = localStorage.getItem(STAND_CACHE_TIME_KEY);
    div.textContent = (e.name==="AbortError" ? "Zeitüberschreitung." : "Fehler beim Laden.") +
      (cached ? "\n\n" + cached : "");
    if(cached && hint) hint.textContent = "Offline – zuletzt geladen: " + formatCacheTime(ts);
  }
}

async function loadRangliste(){
  const div = document.getElementById("ranglisteResult");
  const hint = document.getElementById("ranglisteCacheHint");
  div.textContent = "Lade... (kann bis zu 45 Sek. dauern)";
  hint.textContent = "";
  if(!navigator.onLine){
    const cached = localStorage.getItem(RANGLISTE_CACHE_KEY);
    const ts = localStorage.getItem(RANGLISTE_CACHE_TIME_KEY);
    div.textContent = cached || "Kein Netz und keine gespeicherte Rangliste vorhanden.";
    if(cached && hint) hint.textContent = "Offline – zuletzt geladen: " + formatCacheTime(ts);
    return;
  }
  try{
    // Rangliste braucht länger – Timeout auf 45s erhöht
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
    const ts = localStorage.getItem(RANGLISTE_CACHE_TIME_KEY);
    div.textContent = (e.name==="AbortError" ? "Zeitüberschreitung – Server zu langsam." : "Fehler beim Laden.") +
      (cached ? "\n\nZuletzt gespeichert:\n" + cached : "");
    if(cached && hint) hint.textContent = "Offline – zuletzt geladen: " + formatCacheTime(ts);
  }
}

async function doStorno(){
  if(!navigator.onLine){ toast("Kein Netz -- Storno nicht möglich."); return; }
  try{
    const res = await fetchWithTimeout(buildUrl({action:"storno"}));
    toast(await res.text());
  }catch(e){ toast("Kein Netz -- Storno nicht möglich."); }
}

async function loadLager(){
  const div = document.getElementById("lagerResult");
  div.textContent = "Lade...";
  if(!navigator.onLine){ div.textContent = "Kein Netz – nicht abrufbar."; return; }
  try{
    const res = await fetchWithTimeout(buildUrl({action:"getlager"}));
    const data = await res.json();
    div.textContent = "Gesamtbestand: " + data.bestand + " Flaschen";
  }catch(e){ div.textContent = "Kein Netz – nicht abrufbar."; }
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

function switchTab(tab){
  ["log","stand","admin"].forEach(t=>{
    document.getElementById("view-"+t).classList.toggle("hidden", t!==tab);
    document.getElementById("tab-"+t).classList.toggle("active", t===tab);
  });
}

checkSessionOnLoad();

if("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")
      .then(reg => console.log("SW registriert", reg.scope))
      .catch(err => console.error("SW Registrierung fehlgeschlagen", err));
  });
}
