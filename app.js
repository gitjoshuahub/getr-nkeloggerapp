// ====== KONFIGURATION ======
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfx9LSz3QW-pfn5TRkc8QvWIt025rIiKz2QrJLukZ4XytuYaCnAxZSLHBKj9gWLAnj/exec";
const API_KEY = "bier123";
const KATEGORIEN = [
  { label: "Haus", hasNameList: true, listKey: "haus" },
  { label: "Non Loci", hasNameList: true, listKey: "nonloci" },
  { label: "Philister", hasNameList: false, logName: "Philister" },
  { label: "Institut", hasNameList: false, logName: "Institut" },
  { label: "Couleur", hasNameList: false, logName: "Couleur" }
];

let cfg = { haus: [], nonloci: [] };
let currentKat = null;
let currentName = null;
let flaschenWert = 1;
let kistenWert = 1;
const FLASCHEN_MAX = 19;
const KISTEN_MAX = 5;
const SESSION_KEY = "bier_session";

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

function fetchWithTimeout(url, ms = 6000){
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
}

function renderCats(){
  const grid = document.getElementById("catGrid");
  grid.innerHTML = "";
  KATEGORIEN.forEach((k, idx)=>{
    const b = document.createElement("button");
    b.textContent = k.label;
    b.className = "btn-accent";
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
}

function showNames(){
  document.getElementById("catCard").classList.add("hidden");
  document.getElementById("nameCard").classList.remove("hidden");
  document.getElementById("mengeCard").classList.add("hidden");
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

function backFromMenge(){ if(currentKat.hasNameList){ showNames(); } else { showCats(); } }

async function logBuchung(anzahl, typ){
  const ok = await sendAction({ name: currentName, menge: anzahl, typ: typ });
  if(ok){
    showCats();
  }
}

const STAND_CACHE_KEY = "bier_stand_cache";

function restoreCachedStand(){
  const cached = localStorage.getItem(STAND_CACHE_KEY);
  if(cached){
    const div = document.getElementById("standResult");
    if(div) div.textContent = cached + "\n\n(zuletzt gespeicherter Stand)";
  }
}

async function loadStand(){
  const div = document.getElementById("standResult");
  div.textContent = "Lade...";
  if(!navigator.onLine){
    const cached = localStorage.getItem(STAND_CACHE_KEY);
    div.textContent = cached ? cached + "\n\n(offline, zuletzt gespeicherter Stand)" : "Kein Netz und kein gespeicherter Stand vorhanden.";
    return;
  }
  try{
    const res = await fetchWithTimeout(buildUrl({action:"stand"}), 8000);
    if(!res.ok){ div.textContent = "Serverfehler (HTTP " + res.status + "). Ist die Action 'stand' im Backend eingerichtet?"; return; }
    const text = await res.text();
    if(!text || text.trim().length === 0){ div.textContent = "Server hat leere Antwort geschickt. Bitte pruefen, ob action=stand im doGet existiert."; return; }
    div.textContent = text;
    localStorage.setItem(STAND_CACHE_KEY, text);
  }catch(e){
    const cached = localStorage.getItem(STAND_CACHE_KEY);
    if(e.name === "AbortError"){
      div.textContent = "Zeitüberschreitung beim Laden." + (cached ? "\n\n" + cached + "\n(zuletzt gespeicherter Stand)" : "");
    } else {
      div.textContent = "Fehler beim Laden." + (cached ? "\n\n" + cached + "\n(zuletzt gespeicherter Stand)" : "");
    }
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
