// ====== VERSION ======
// Bei jeder Aenderung hochzaehlen -> zusammen mit CACHE_NAME in sw.js.
const APP_VERSION = "1.1.0";

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

let cfg = { haus: [], nonloci: [], sorten: [] };
let currentKat = null;
let currentName = null;
let flaschenWert = 1;
let kistenWert = 1;
const FLASCHEN_MAX = 19;
const KISTEN_MAX = 5;

const SESSION_KEY = "bier_session";
let sendingInProgress = false;

// ====== SESSION ======
function getSession(){
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch(e){ return null; }
}
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
    errEl.textContent = "Kein Netz — zum Anmelden brauchst du eine Internetverbindung.";
    errEl.classList.remove("hidden");
    return;
  }

  try{
    const url = new URL(SCRIPT_URL);
    url.searchParams.set("action","login");
    url.searchParams.set("name", name);
    url.searchParams.set("pw", pw);
    url.searchParams.set("key", API_KEY);
    const res = await fetchWithTimeout(url.toString(), 15000);
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
  const adminTab = document.getElementById("tab-admin");
  if(adminTab) adminTab.style.display = isAdmin ? "" : "none";

  renderCats();
  updateStatus();
  fetchConfig();
}

function doLogout(){
  clearSession();
  location.reload();
}

// Session nur online wiederherstellen -> ohne Netz muss man sich neu einloggen.
function checkSessionOnLoad(){
  const s = getSession();
  if(s && navigator.onLine){
    document.getElementById("loginName").value = s.name;
    enterApp(s);
  } else if(s && !navigator.onLine){
    clearSession();
  }
}

// ====== ONLINE-STATUS ======
function updateStatus(){
  const dot = document.getElementById("statusDot");
  const txt = document.getElementById("statusText");
  const banner = document.getElementById("offlineBanner");
  const isOnline = navigator.onLine;

  if(isOnline){
    dot.classList.add("online");
    txt.textContent = "online";
    if(banner) banner.classList.add("hidden");
  } else {
    dot.classList.remove("online");
    txt.textContent = "offline";
    if(banner) banner.classList.remove("hidden");
  }
  setSendButtonsEnabled(isOnline);
}

// Sperrt/entsperrt alle Buchungs-relevanten Buttons zentral.
function setSendButtonsEnabled(enabled){
  document.querySelectorAll(
    "#catGrid button, #nameList button, .stepper-btn, #confirmBuchungBtn, " +
    "#loadStandBtn, #stornoBtn, #loadLagerBtn, #einkaufBtn, #inventurBtn"
  ).forEach(btn => { btn.disabled = !enabled; });
}

window.addEventListener("online", () => {
  updateStatus();
  toast("Wieder online — Loggen ist jetzt moeglich.");
});
window.addEventListener("offline", () => {
  updateStatus();
  toast("Kein Netz — Buchungen sind gesperrt, bis wieder online.");
});
setInterval(updateStatus, 5000);

// ====== NETZWERK-HELPER ======
function buildUrl(params){
  const u = new URL(SCRIPT_URL);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
  u.searchParams.set("key", API_KEY);
  return u.toString();
}

function fetchWithTimeout(url, ms = 15000){
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal, cache: "no-store" }).finally(() => clearTimeout(t));
}

async function rawGet(params, silent){
  try{
    const res = await fetchWithTimeout(buildUrl(params));
    if(!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if(!silent) toast(text);
    return { ok: true, text };
  }catch(e){
    return { ok: false, text: null };
  }
}

function makeReqId(){
  return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

// Zentrale Sende-Funktion: NUR online, keine Warteschlange, kein Retry-Loop,
// keine Mehrfachsendung waehrend eine Anfrage noch laeuft.
async function sendAction(params, silent){
  if(!navigator.onLine){
    toast("Kein Netz — Buchung wurde NICHT gespeichert.");
    updateStatus();
    return { ok: false };
  }
  if(sendingInProgress){
    toast("Bitte warten — vorherige Aktion wird noch gesendet.");
    return { ok: false };
  }

  const session = getSession();
  if(session) params.absender = session.name;
  params.reqId = makeReqId();

  sendingInProgress = true;
  setSendButtonsEnabled(false);
  try{
    const result = await rawGet(params, silent);
    if(!result.ok){
      toast("Fehler beim Senden — bitte erneut versuchen.");
    }
    return result;
  } finally {
    sendingInProgress = false;
    setSendButtonsEnabled(navigator.onLine);
  }
}

// ====== TOAST ======
let toastTimer;
function toast(msg){
  const t = document.getElementById("toast");
  if(!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove("show"), 2500);
}

// ====== KONFIG LADEN (nur online, kein Cache mehr) ======
async function fetchConfig(){
  if(!navigator.onLine){
    toast("Offline — Konfiguration kann nicht geladen werden.");
    renderSortenSelects();
    return;
  }
  try{
    const res = await fetchWithTimeout(buildUrl({action:"getconfig"}));
    const data = await res.json();
    cfg.haus = data.haus || [];
    cfg.nonloci = data.nonloci || [];
    cfg.sorten = data.sorten || [];
    renderSortenSelects();
  }catch(e){
    toast("Konfiguration konnte nicht geladen werden.");
    renderSortenSelects();
  }
}

function renderSortenSelects(){
  ["einkaufSorte","inventurSorte"].forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel) return;
    sel.innerHTML = "";
    cfg.sorten.forEach(s=>{
      const opt = document.createElement("option");
      opt.value = s;
      opt.textContent = s;
      sel.appendChild(opt);
    });
  });
}

// ====== TABS ======
function switchTab(tab){
  ["log","stand","admin"].forEach(t=>{
    const view = document.getElementById("view-" + t);
    const btn = document.getElementById("tab-" + t);
    if(view) view.classList.toggle("hidden", t !== tab);
    if(btn) btn.classList.toggle("active", t === tab);
  });
}

// ====== UI: KATEGORIEN ======
function renderCats(){
  const grid = document.getElementById("catGrid");
  grid.innerHTML = "";
  KATEGORIEN.forEach((k, idx)=>{
    const b = document.createElement("button");
    b.textContent = k.label;
    b.className = "btn-accent";
    b.disabled = !navigator.onLine;
    b.onclick = ()=> selectCat(idx);
    grid.appendChild(b);
  });
}

function selectCat(idx){
  if(!navigator.onLine){ toast("Kein Netz — bitte warten."); return; }
  currentKat = KATEGORIEN[idx];
  if(currentKat.hasNameList){
    showNames();
  } else {
    currentName = currentKat.logName;
    showMenge();
  }
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
    b.disabled = !navigator.onLine;
    b.onclick = ()=>{
      if(!navigator.onLine){ toast("Kein Netz — bitte warten."); return; }
      currentName = name;
      showMenge();
    };
    wrap.appendChild(b);
  });
}

function backFromMenge(){
  if(currentKat && currentKat.hasNameList){
    showNames();
  } else {
    showCats();
  }
}

// ====== UI: MENGE ======
function showMenge(){
  document.getElementById("catCard").classList.add("hidden");
  document.getElementById("nameCard").classList.add("hidden");
  document.getElementById("mengeCard").classList.remove("hidden");
  document.getElementById("mengeTitle").textContent = currentName;
  flaschenWert = 1;
  kistenWert = 1;
  renderMengeSteppers();
}

function renderMengeSteppers(){
  const grid = document.getElementById("mengeGrid");
  grid.innerHTML = "";

  const flWrap = document.createElement("div");
  flWrap.className = "stepper-block";
  flWrap.innerHTML = `
    <div class="stepper-label">Flaschen</div>
    <div class="stepper-row">
      <button class="stepper-btn" id="flMinus">-</button>
      <span class="stepper-value" id="flVal">${flaschenWert}</span>
      <button class="stepper-btn" id="flPlus">+</button>
    </div>
  `;
  grid.appendChild(flWrap);

  const kiWrap = document.createElement("div");
  kiWrap.className = "stepper-block";
  kiWrap.innerHTML = `
    <div class="stepper-label">Kisten</div>
    <div class="stepper-row">
      <button class="stepper-btn" id="kiMinus">-</button>
      <span class="stepper-value" id="kiVal">${kistenWert}</span>
      <button class="stepper-btn" id="kiPlus">+</button>
    </div>
  `;
  grid.appendChild(kiWrap);

  const confirmWrap = document.createElement("button");
  confirmWrap.className = "btn-full btn-accent";
  confirmWrap.id = "confirmBuchungBtn";
  confirmWrap.textContent = "Buchen";
  confirmWrap.onclick = confirmBuchung;
  grid.appendChild(confirmWrap);

  document.getElementById("flMinus").onclick = ()=>{
    flaschenWert = Math.max(0, flaschenWert - 1);
    document.getElementById("flVal").textContent = flaschenWert;
  };
  document.getElementById("flPlus").onclick = ()=>{
    flaschenWert = Math.min(FLASCHEN_MAX, flaschenWert + 1);
    document.getElementById("flVal").textContent = flaschenWert;
  };
  document.getElementById("kiMinus").onclick = ()=>{
    kistenWert = Math.max(0, kistenWert - 1);
    document.getElementById("kiVal").textContent = kistenWert;
  };
  document.getElementById("kiPlus").onclick = ()=>{
    kistenWert = Math.min(KISTEN_MAX, kistenWert + 1);
    document.getElementById("kiVal").textContent = kistenWert;
  };

  const disabled = !navigator.onLine;
  grid.querySelectorAll("button").forEach(b => b.disabled = disabled);
}

async function confirmBuchung(){
  if(!navigator.onLine){
    toast("Kein Netz — Buchung wurde NICHT gespeichert.");
    return;
  }
  if(flaschenWert === 0 && kistenWert === 0){
    toast("Bitte mindestens 1 Flasche oder Kiste waehlen.");
    return;
  }

  const result = await sendAction({
    action: "log",
    name: currentName,
    kategorie: currentKat.label,
    flaschen: flaschenWert,
    kisten: kistenWert
  });

  if(result.ok){
    toast(`Gebucht: ${currentName} — ${flaschenWert} Flasche(n), ${kistenWert} Kiste(n)`);
    showCats();
  }
}

// ====== STAND / STORNO ======
async function loadStand(){
  if(!navigator.onLine){ toast("Kein Netz — Stand kann nicht geladen werden."); return; }
  const el = document.getElementById("standResult");
  el.textContent = "Lade...";
  const result = await rawGet({ action: "stand" }, true);
  el.textContent = result.ok ? result.text : "Fehler beim Laden.";
}

async function doStorno(){
  if(!navigator.onLine){ toast("Kein Netz — Storno nicht moeglich."); return; }
  const result = await sendAction({ action: "storno" });
  if(result.ok) loadStand();
}

// ====== ADMIN: LAGER / EINKAUF / INVENTUR ======
async function loadLager(){
  if(!navigator.onLine){ toast("Kein Netz — Lagerstand kann nicht geladen werden."); return; }
  const el = document.getElementById("lagerResult");
  el.textContent = "Lade...";
  const result = await rawGet({ action: "lager" }, true);
  el.textContent = result.ok ? result.text : "Fehler beim Laden.";
}

async function doEinkauf(){
  if(!navigator.onLine){ toast("Kein Netz — Einkauf wurde NICHT gebucht."); return; }
  const sorteEl = document.getElementById("einkaufSorte");
  const kistenEl = document.getElementById("einkaufKisten");
  const sorte = sorteEl ? sorteEl.value : "";
  const kisten = kistenEl ? parseInt(kistenEl.value, 10) : 0;

  if(!kisten || kisten < 1){
    toast("Bitte gueltige Anzahl Kisten eingeben.");
    return;
  }

  const result = await sendAction({ action: "einkauf", sorte, kisten });
  if(result.ok){
    toast(`Einkauf gebucht: ${kisten} Kiste(n) ${sorte}`);
    if(kistenEl) kistenEl.value = "";
  }
}

async function doInventur(){
  if(!navigator.onLine){ toast("Kein Netz — Inventur wurde NICHT gebucht."); return; }
  const sorteEl = document.getElementById("inventurSorte");
  const flEl = document.getElementById("inventurFlaschen");
  const sorte = sorteEl ? sorteEl.value : "";
  const flaschen = flEl ? parseInt(flEl.value, 10) : NaN;

  if(isNaN(flaschen) || flaschen < 0){
    toast("Bitte gueltige Flaschenzahl eingeben.");
    return;
  }

  const result = await sendAction({ action: "inventur", sorte, flaschen });
  if(result.ok){
    toast(`Inventur gebucht: ${flaschen} Flaschen ${sorte}`);
    if(flEl) flEl.value = "";
  }
}

// ====== VERSION ANZEIGEN ======
function showVersion(){
  const hint = document.getElementById("loginHint");
  if(hint){
    const v = document.createElement("div");
    v.style.marginTop = "8px";
    v.style.opacity = "0.6";
    v.style.fontSize = "11px";
    v.textContent = "Version " + APP_VERSION;
    hint.appendChild(v);
  }
}

// ====== INIT ======
document.addEventListener("DOMContentLoaded", () => {
  showVersion();
  checkSessionOnLoad();
  updateStatus();
});

// Service Worker: nur App-Shell cachen, Buchungen laufen nie ueber den Cache
// (script.google.com wird im sw.js explizit ausgeschlossen).
if("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(reg=>{
      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        newWorker.addEventListener("statechange", () => {
          if(newWorker.state === "activated"){
            toast("Neue Version geladen — bitte App einmal neu oeffnen.");
          }
        });
      });
    }).catch(()=>{});
  });
}
