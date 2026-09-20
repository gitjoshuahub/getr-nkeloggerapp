// ====== KONFIGURATION ======
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfx9LSz3QW-pfn5TRkc8QvWIt025rIiKz2QrJLukZ4XytuYaCnAxZSLHBKj9gWLAnj/exec";
// Fester API-Key des Systems (bleibt wie im ESP32-Sketch) -- schuetzt das
// Script generell vor fremden Zugriffen. Die persoenliche Anmeldung
// (Name + Passwort) ist eine ZUSAETZLICHE Schicht darueber.
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

// ====== LOGIN / SESSION ======
const SESSION_KEY = "bier_session"; // { name, pw, rolle }

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

  // Offline-Fallback: wenn keine Verbindung, aber eine gueltige lokale Session
  // fuer genau diesen Namen existiert, direkt einloggen (kein Server-Check moeglich).
  if(!navigator.onLine){
    const cached = getSession();
    if(cached && cached.name.toLowerCase() === name.toLowerCase()){
      enterApp(cached);
      return;
    }
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

  // Admin-Tab nur fuer kassenwart/admin sichtbar
  const isAdmin = session.rolle === "admin" || session.rolle === "kassenwart";
  document.getElementById("tab-admin").style.display = isAdmin ? "" : "none";

  renderCats();
  updateStatus();
  fetchConfig();
  updateQueueBadge();
}

function doLogout(){
  clearSession();
  location.reload();
}

function checkSessionOnLoad(){
  const s = getSession();
  if(s){
    document.getElementById("loginName").value = s.name;
    enterApp(s);
  }
}

// ====== OFFLINE QUEUE ======
const QUEUE_KEY = "bier_offline_queue";
function getQueue(){ return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
function setQueue(q){ localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); updateQueueBadge(); }
function pushQueue(params){ const q = getQueue(); q.push(params); setQueue(q); }
function updateQueueBadge(){
  const n = getQueue().length;
  const b = document.getElementById("queueBadge");
  if(n>0){ b.textContent=n; b.classList.remove("hidden"); } else { b.classList.add("hidden"); }
}

async function trySyncQueue(){
  if(!navigator.onLine) return;
  let q = getQueue();
  if(q.length===0) return;
  const remaining = [];
  for(const params of q){
    const ok = await rawGet(params, true);
    if(!ok) remaining.push(params);
  }
  setQueue(remaining);
  if(remaining.length < q.length) toast(`Sync: ${q.length - remaining.length} Einträge gesendet`);
}

// ====== NETWORK STATUS ======
function updateStatus(){
  const dot = document.getElementById("statusDot");
  const txt = document.getElementById("statusText");
  if(navigator.onLine){ dot.classList.add("online"); txt.textContent="online"; trySyncQueue(); }
  else { dot.classList.remove("online"); txt.textContent="offline"; }
}
window.addEventListener("online", updateStatus);
window.addEventListener("offline", updateStatus);

// ====== HTTP HELPER ======
function buildUrl(params){
  const u = new URL(SCRIPT_URL);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
  u.searchParams.set("key", API_KEY);
  return u.toString();
}

async function rawGet(params, silent){
  try{
    const res = await fetch(buildUrl(params), { method:"GET" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if(!silent) toast(text);
    return true;
  }catch(e){
    return false;
  }
}

async function sendAction(params){
  const session = getSession();
  if(session) params.absender = session.name; // wer hat's gebucht -- fuer Logging
  if(!navigator.onLine){
    pushQueue(params);
    toast("Offline gespeichert – wird später gesendet");
    return;
  }
  const ok = await rawGet(params);
  if(!ok){
    pushQueue(params);
    toast("Fehler – offline gespeichert");
  }
}

// ====== TOAST ======
let toastTimer;
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove("show"), 2500);
}

// ====== CONFIG LADEN ======
async function fetchConfig(){
  try{
    const res = await fetch(buildUrl({action:"getconfig"}));
    const data = await res.json();
    cfg.haus = data.haus || [];
    cfg.nonloci = data.nonloci || [];
    cfg.sorten = data.sorten || [];
    localStorage.setItem("bier_cfg", JSON.stringify(cfg));
    renderSortenSelects();
  }catch(e){
    const cached = localStorage.getItem("bier_cfg");
    if(cached) cfg = JSON.parse(cached);
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
      opt.value = s; opt.textContent = s;
      sel.appendChild(opt);
    });
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
    b.onclick = ()=> selectCat(idx);
    grid.appendChild(b);
  });
}

function selectCat(idx){
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
    b.onclick = ()=>{ currentName = name; showMenge(); };
    wrap.appendChild(b);
  });
}

function showMenge(){
  document.getElementById("catCard").classList.add("hidden");
  document.getElementById("nameCard").classList.add("hidden");
  document.getElementById("mengeCard").classList.remove("hidden");
  document.getElementById("mengeTitle").textContent = currentName;
  const grid = document.getElementById("mengeGrid");
  grid.innerHTML = "";
  for(let i=1;i<=6;i++){
    const b = document.createElement("button");
    b.textContent = i + " Flasche" + (i>1?"n":"");
    b.onclick = ()=> logBuchung(i, "flasche");
    grid.appendChild(b);
  }
  for(let i=1;i<=2;i++){
    const b = document.createElement("button");
    b.textContent = i + " Kasten" + (i>1?"en":"");
    b.className = "btn-accent";
    b.onclick = ()=> logBuchung(i, "kasten");
    grid.appendChild(b);
  }
}

function backFromMenge(){
  if(currentKat.hasNameList) showNames();
  else showCats();
}

function logBuchung(anzahl, typ){
  sendAction({ name: currentName, menge: anzahl, typ: typ, panel: "PWA" });
  toast(`${currentName}: ${anzahl}x ${typ} gebucht`);
  showCats();
}

// ====== STAND ======
async function loadStand(){
  const div = document.getElementById("standResult");
  div.textContent = "Lade...";
  try{
    const res = await fetch(buildUrl({action:"stand"}));
    div.textContent = await res.text();
  }catch(e){
    div.textContent = "Kein Netz – nicht abrufbar.";
  }
}

async function doStorno(){
  try{
    const res = await fetch(buildUrl({action:"storno"}));
    toast(await res.text());
  }catch(e){
    toast("Kein Netz -- Storno nicht möglich.");
  }
}

// ====== ADMIN: LAGER / EINKAUF / INVENTUR ======
async function loadLager(){
  const div = document.getElementById("lagerResult");
  div.textContent = "Lade...";
  try{
    const res = await fetch(buildUrl({action:"getlager"}));
    const data = await res.json();
    let txt = `Gesamtbestand: ${data.bestand} Flaschen\n`;
    if(data.proSorte){
      txt += "\nSorten:\n";
      Object.entries(data.proSorte).forEach(([s,v])=>{ txt += `${s}: ${v ?? "unbekannt"}\n`; });
    }
    div.textContent = txt;
  }catch(e){
    div.textContent = "Kein Netz – nicht abrufbar.";
  }
}

function doEinkauf(){
  const sorte = document.getElementById("einkaufSorte").value;
  const kisten = document.getElementById("einkaufKisten").value;
  if(!kisten || kisten<=0){ toast("Bitte Anzahl Kisten eingeben"); return; }
  sendAction({ action:"einkauf", menge:kisten, typ:"kasten", sorte });
  toast(`Einkauf: ${kisten} Kisten ${sorte}`);
}

function doInventur(){
  const sorte = document.getElementById("inventurSorte").value;
  const flaschen = document.getElementById("inventurFlaschen").value;
  if(flaschen === ""){ toast("Bitte Flaschenzahl eingeben"); return; }
  sendAction({ action:"inventur", menge:flaschen, sorte });
  toast(`Inventur: ${flaschen} Flaschen ${sorte}`);
}

// ====== TABS ======
function switchTab(tab){
  ["log","stand","admin"].forEach(t=>{
    document.getElementById("view-"+t).classList.toggle("hidden", t!==tab);
    document.getElementById("tab-"+t).classList.toggle("active", t===tab);
  });
}

// ====== INIT ======
checkSessionOnLoad();

// Service Worker registrieren
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("sw.js").catch(console.warn);
  });
}
