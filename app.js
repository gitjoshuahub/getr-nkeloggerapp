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
    errEl.textContent = "Server nicht erreichbar. Bitte später erneut versuchen.";
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

// Session nur wiederherstellen, wenn online — sonst muss man sich neu einloggen,
// sobald wieder Netz da ist (verhindert offline-Zugriff komplett)
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
  const appRoot = document.getElementById("appRoot");
  const isOnline = navigator.onLine;

  if(isOnline){
    dot.classList.add("online");
    txt.textContent = "online";
    if(banner) banner.classList.add("hidden");
    if(appRoot) appRoot.classList.remove("locked");
    setSendButtonsEnabled(true);
  } else {
    dot.classList.remove("online");
    txt.textContent = "offline";
    if(banner) banner.classList.remove("hidden");
    if(appRoot) appRoot.classList.add("locked");
    setSendButtonsEnabled(false);
    toast("Kein Netz — Loggen erst wieder möglich, wenn online.");
  }
}

// Sperrt/entsperrt alle Buchungs-Buttons zentral
function setSendButtonsEnabled(enabled){
  document.querySelectorAll(".btn-accent, .stepper-btn, #confirmBtn, .name-btn")
    .forEach(btn => { btn.disabled = !enabled; });
}

window.addEventListener("online", () => {
  updateStatus();
  toast("Wieder online — Loggen ist jetzt möglich.");
});
window.addEventListener("offline", updateStatus);
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
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(t));
}

async function rawGet(params, silent){
  try{
    const res = await fetchWithTimeout(buildUrl(params));
    if(!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if(!silent) toast(text);
    return true;
  }catch(e){
    return false;
  }
}

// Zentrale Sende-Funktion: NUR online, keine Warteschlange, kein Retry-Loop.
// Jede Buchung bekommt eine eindeutige reqId (falls das Google-Script sie
// nutzen möchte, um versehentliche Doppelklicks zu erkennen).
function makeReqId(){
  return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

let sendingInProgress = false;

async function sendAction(params){
  if(!navigator.onLine){
    toast("Kein Netz — Buchung wurde NICHT gespeichert.");
    updateStatus();
    return false;
  }

  if(sendingInProgress){
    toast("Bitte warten — vorherige Buchung wird noch gesendet.");
    return false;
  }

  const session = getSession();
  if(session) params.absender = session.name;
  params.reqId = makeReqId();

  sendingInProgress = true;
  setSendButtonsEnabled(false);
  try{
    const ok = await rawGet(params);
    if(!ok){
      toast("Fehler beim Senden — bitte erneut versuchen.");
    }
    return ok;
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

// ====== KONFIG LADEN (nur online) ======
async function fetchConfig(){
  if(!navigator.onLine){
    toast("Offline — Konfiguration kann nicht geladen werden.");
    return;
  }
  try{
    const res = await fetchWithTimeout(buildUrl({action:"getconfig"}));
    const data = await res.json();
    cfg.haus = data.haus || [];
    cfg.nonloci = data.nonloci || [];
  }catch(e){
    toast("Konfiguration konnte nicht geladen werden.");
  }
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
    b.className = "name-btn";
    b.disabled = !navigator.onLine;
    b.onclick = ()=>{
      if(!navigator.onLine){ toast("Kein Netz — bitte warten."); return; }
      currentName = name;
      showMenge();
    };
    wrap.appendChild(b);
  });
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
      <span class="stepper-val" id="flVal">${flaschenWert}</span>
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
      <span class="stepper-val" id="kiVal">${kistenWert}</span>
      <button class="stepper-btn" id="kiPlus">+</button>
    </div>
  `;
  grid.appendChild(kiWrap);

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

  const btns = grid.querySelectorAll(".stepper-btn");
  btns.forEach(b => b.disabled = !navigator.onLine);
}

async function confirmBuchung(){
  if(!navigator.onLine){
    toast("Kein Netz — Buchung wurde NICHT gespeichert.");
    return;
  }
  if(flaschenWert === 0 && kistenWert === 0){
    toast("Bitte mindestens 1 Flasche oder Kiste wählen.");
    return;
  }

  const ok = await sendAction({
    action: "log",
    name: currentName,
    kategorie: currentKat.label,
    flaschen: flaschenWert,
    kisten: kistenWert
  });

  if(ok){
    toast(`Gebucht: ${currentName} — ${flaschenWert} Flasche(n), ${kistenWert} Kiste(n)`);
    showCats();
  }
}

// ====== INIT ======
document.addEventListener("DOMContentLoaded", () => {
  checkSessionOnLoad();
  updateStatus();

  const loginBtn = document.getElementById("loginBtn");
  if(loginBtn) loginBtn.onclick = doLogin;

  const logoutBtn = document.getElementById("logoutBtn");
  if(logoutBtn) logoutBtn.onclick = doLogout;

  const confirmBtn = document.getElementById("confirmBtn");
  if(confirmBtn) confirmBtn.onclick = confirmBuchung;

  const backToCatsBtn = document.getElementById("backToCatsBtn");
  if(backToCatsBtn) backToCatsBtn.onclick = showCats;

  const backToCatsBtn2 = document.getElementById("backToCatsBtn2");
  if(backToCatsBtn2) backToCatsBtn2.onclick = showCats;
});

// Service Worker NICHT für das Cachen von API-Aufrufen nutzen —
// nur für App-Shell (HTML/CSS/JS/Icons), damit Buchungen niemals aus dem Cache
// beantwortet werden können.
if("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  });
}
