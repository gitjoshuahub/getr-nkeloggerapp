// ====== KONFIGURATION ======
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwfx9LSz3QW-pfn5TRkc8QvWIt025rIiKz2QrJLukZ4XytuYaCnAxZSLHBKj9gWLAnj/exec';
const HAUS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzypbqWCy5OsSqblD3KEsqK0RvfxqHnkw2hk_A94IO4ekGP5epvGouAJUwb4iZqr78/exec';
const API_KEY = 'bier123';
const KATEGORIEN = [
  { label: 'Haus', hasNameList: true, listKey: 'haus' },
  { label: 'Non Loci', hasNameList: true, listKey: 'nonloci' },
  { label: 'Philister', hasNameList: false, logName: 'Philister' },
  { label: 'Institut', hasNameList: false, logName: 'Institut' },
  { label: 'Couleur', hasNameList: false, logName: 'Couleur', fullWidth: true }
];

// Muss mit MONTHS_AHEAD im GAS-Backend übereinstimmen
const MONTHS_AHEAD = 6;

// Termine, deren Titel dieses Muster enthält, sind reine Erinnerungen (nur 'Erledigt' statt Zusage/Absage)
const REMINDER_PATTERN = /\bAWB\b/i;

let cfg = { haus: [], nonloci: [] };
let currentKat = null;
let currentName = null;
let flaschenWert = 1;
let kistenWert = 1;
const FLASCHEN_MAX = 19;
const KISTEN_MAX = 5;
const SESSION_KEY = 'bier_session';
const CFG_CACHE_KEY = 'bier_cfg';
const LAGER_CACHE_KEY = 'bier_lager_cache';
const KAL_CACHE_KEY = 'bier_kal_cache';
const MEINE_STATUS_CACHE_KEY = 'bier_meine_status';
const PUTZ_CACHE_KEY = 'bier_putz_cache';

let zahlungSelectedName = null;
let strafeSelectedName = null;
let aktuellerBereich = 'kalender';
let meineStatusMap = {};
let kalViewDate = new Date();

// ====== EVENT KEY ======
function getEventKey(ev) {
  return [ev.calendar || '', ev.id || '', ev.start || '', ev.title || ''].join('|');
}

function isReminderEvent(ev){
  return REMINDER_PATTERN.test((ev && ev.title) || '');
}

function getSession(){ try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch(e){ return null; } }
function setSession(s){ localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession(){ localStorage.removeItem(SESSION_KEY); }

async function doLogin(){
  const name = document.getElementById('loginName').value.trim();
  const pw = document.getElementById('loginPw').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  if(!name || !pw || pw.length < 4){
    errEl.textContent = 'Bitte Name eingeben und Passwort mit mind. 4 Zeichen.';
    errEl.classList.remove('hidden');
    return;
  }
  if(!navigator.onLine){
    const cached = getSession();
    if(cached && cached.name.toLowerCase() === name.toLowerCase()){ enterApp(cached); return; }
    errEl.textContent = 'Kein Netz -- Erstanmeldung braucht einmalig eine Verbindung.';
    errEl.classList.remove('hidden');
    return;
  }
  try{
    const url = new URL(SCRIPT_URL);
    url.searchParams.set('action','login');
    url.searchParams.set('name', name);
    url.searchParams.set('pw', pw);
    url.searchParams.set('key', API_KEY);
    const res = await fetch(url.toString());
    const data = await res.json();
    if(!data.ok){
      errEl.textContent = data.grund || 'Anmeldung fehlgeschlagen.';
      errEl.classList.remove('hidden');
      return;
    }
    const session = { name: name, pw: pw, rolle: data.rolle || 'mitglied' };
    setSession(session);
    if(data.neu){ toast('Willkommen ' + name + '! Passwort wurde neu angelegt.'); }
    enterApp(session);
  }catch(e){
    errEl.textContent = 'Server nicht erreichbar. Bitte spaeter erneut versuchen.';
    errEl.classList.remove('hidden');
  }
}

function isHauswartRole(session){
  const r = String((session && session.rolle) || '').toLowerCase();
  return r === 'hauswart' || r === 'admin';
}

function enterApp(session){
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('appRoot').classList.remove('app-hidden');
  document.getElementById('loggedInName').textContent = session.name;
  document.getElementById('loggedInName').classList.remove('hidden');
  document.getElementById('logoutBtn').classList.remove('hidden');
  document.getElementById('bottomNav').style.display = '';

  const isAdmin = session.rolle === 'admin' || session.rolle === 'kassenwart';
  document.getElementById('tab-admin').style.display = isAdmin ? '' : 'none';

  // Hauswart-Tab (dritter Tab unter Haus) nur für Hauswart und Admin
  if(isHauswartRole(session)) ensureHauswartTab();

  // Haus-Tab: erst aus Cache entscheiden, nach Config-Reload synchronisieren
  document.getElementById('nav-haus').style.display = 'none';
  try{
    const raw = localStorage.getItem(CFG_CACHE_KEY);
    if(raw){
      const data = JSON.parse(raw);
      const n = session.name.toLowerCase();
      const istHaus = (Array.isArray(data.haus) ? data.haus : []).some(h => h.toLowerCase() === n);
      if(istHaus) document.getElementById('nav-haus').style.display = '';
    }
  }catch(e){}

  restoreMeineStatus();
  renderCats();
  updateStatus();
  loadCachedConfig();
  fetchConfig(true).then(() => applyHausTabVisibility(session));
  updateQueueBadge();
  restoreCachedStand();
  restoreCachedRangliste();
  restoreCachedLager();
  kalViewDate = new Date();
  restoreCachedKalender();
  switchBereich('kalender');

  // Alles aus dem Cache anzeigen, im Hintergrund neu laden
  loadLager();
  loadKalender();
  loadStand(true);
  loadRangliste(true);

  // Putzplan: Cache sofort zeigen, für Hausmitglieder im Hintergrund aktualisieren
  renderPutzAufgaben();
  if(document.getElementById('nav-haus').style.display !== 'none') loadPutzplan();
}

function restoreMeineStatus(){
  try{
    const raw = localStorage.getItem(MEINE_STATUS_CACHE_KEY);
    meineStatusMap = raw ? JSON.parse(raw) : {};
  }catch(e){ meineStatusMap = {}; }
}

function saveMeineStatus(){
  try{ localStorage.setItem(MEINE_STATUS_CACHE_KEY, JSON.stringify(meineStatusMap)); }catch(e){}
}

function applyHausTabVisibility(session){
  const n = session.name.toLowerCase();
  const istHaus = cfg.haus.some(h => h.toLowerCase() === n);
  document.getElementById('nav-haus').style.display = istHaus ? '' : 'none';
}

function doLogout(){ clearSession(); location.reload(); }

function checkSessionOnLoad(){
  const s = getSession();
  if(s){ document.getElementById('loginName').value = s.name; enterApp(s); }
}

// ====== BEREICHE (Bottom-Nav) ======
function switchBereich(bereich){
  aktuellerBereich = bereich;
  ['getraenke','kalender','haus'].forEach(b => {
    document.getElementById('bereich-' + b).classList.toggle('hidden', b !== bereich);
    const btn = document.getElementById('nav-' + b);
    btn.className = b === bereich ? 'active-' + b : '';
  });
  document.getElementById('getraenke-header').classList.toggle('hidden', bereich !== 'getraenke');
  document.getElementById('kalender-header').classList.toggle('hidden', bereich !== 'kalender');
  document.getElementById('haus-header').classList.toggle('hidden', bereich !== 'haus');
  const titels = { getraenke: 'Getränke', kalender: 'Kalender', haus: 'Haus' };
  document.getElementById('appTitle').textContent = titels[bereich] || '';
  if(bereich === 'haus'){ loadPutzplan(); }
}

function switchHausTab(tab){
  ['kalender','aufgaben','hauswart'].forEach(t => {
    const v = document.getElementById('hausview-' + t);
    const b = document.getElementById('haustab-' + t);
    if(v) v.classList.toggle('hidden', t !== tab);
    if(b) b.classList.toggle('active', t === tab);
  });
  if(tab === 'aufgaben'){
    renderPutzAufgaben();
    loadPutzplan();
  }
  if(tab === 'hauswart'){
    renderHauswart();
    loadPutzplan().then(loadHauswart);
  }
}

function switchKalTab(tab){
  ['termine','meine'].forEach(t => {
    document.getElementById('kalview-' + t).classList.toggle('hidden', t !== tab);
    document.getElementById('kaltab-' + t).classList.toggle('active', t === tab);
  });
  if(tab === 'meine') renderMeineZusagen();
}

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
  const label = kalViewDate.toLocaleString('de-DE', { month: 'long', year: 'numeric' });

  const el = document.getElementById('kalMonthLabel');
  if(el) el.textContent = label;
  const todayBtn = document.getElementById('kalTodayBtn');
  if(todayBtn) todayBtn.style.display = isCurrentMonth ? 'none' : '';

  const hausEl = document.getElementById('hausMonthLabel');
  if(hausEl) hausEl.textContent = label;
  const hausTodayBtn = document.getElementById('hausTodayBtn');
  if(hausTodayBtn) hausTodayBtn.style.display = isCurrentMonth ? 'none' : '';
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

function filterAllgemeinEventsByMonth(events){
  return filterEventsByMonth((events || []).filter(ev => ev.calendar === 'allgemein'));
}

function filterHausEventsByMonth(events){
  return filterEventsByMonth((events || []).filter(ev => ev.calendar === 'haus'));
}

// ====== KALENDER: CACHE + LADEN ======
function readKalCache(){
  try{
    const raw = localStorage.getItem(KAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

function renderKalenderFromCache(){
  const data = readKalCache();
  renderEventListe(filterAllgemeinEventsByMonth(data ? data.events : []));
}

function renderHausKalenderFromCache(){
  const data = readKalCache();
  renderHausEventListe(filterHausEventsByMonth(data ? data.events : []));
}

function restoreCachedKalender(){
  const data = readKalCache();
  if(data){
    const hint = document.getElementById('kalenderCacheHint');
    if(hint && data.ts) hint.textContent = 'Cache: ' + formatCacheTime(data.ts.toString()) + ' Uhr';
    const hh = document.getElementById('hausKalenderCacheHint');
    if(hh && data.ts) hh.textContent = 'Cache: ' + formatCacheTime(data.ts.toString()) + ' Uhr';
  }
  renderKalMonthNav();
  renderKalenderFromCache();
  renderHausKalenderFromCache();
}

// Übernimmt den eigenen Status vom Server (teilnahmen-Sheet) in meineStatusMap
function syncStatusFromEvents(events){
  const session = getSession();
  if(!session) return;
  const me = session.name.toLowerCase();
  (events || []).forEach(ev => {
    const own = (ev.teilnahmen || []).find(t => (t.name || '').toLowerCase() === me);
    if(own && own.status) meineStatusMap[getEventKey(ev)] = own.status;
  });
  saveMeineStatus();
}

// Schreibt den eigenen Status in die gecachten Teilnahmen (status=null entfernt ihn)
function applyOwnStatusToCache(ev, name, status){
  const data = readKalCache();
  if(!data) return;
  const key = getEventKey(ev);
  const me = (name || '').toLowerCase();
  (data.events || []).forEach(e => {
    if(getEventKey(e) !== key) return;
    const list = (e.teilnahmen || []).filter(t => (t.name || '').toLowerCase() !== me);
    if(status) list.push({ name: name, status: status });
    e.teilnahmen = list;
    e.teilnehmer = list.filter(t => t.status === 'dabei').map(t => t.name);
  });
  try{ localStorage.setItem(KAL_CACHE_KEY, JSON.stringify(data)); }catch(e){}
}

function findCachedEvent(ev){
  const data = readKalCache();
  if(!data) return null;
  const key = getEventKey(ev);
  return (data.events || []).find(e => getEventKey(e) === key) || null;
}

async function fetchKalenderEvents(kalender){
  const url = new URL(HAUS_SCRIPT_URL);
  url.searchParams.set('action', 'getevents');
  if(kalender) url.searchParams.set('kalender', kalender);
  url.searchParams.set('key', API_KEY);
  const res = await fetchWithTimeout(url.toString(), 20000);
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Fehler vom Server');
  return data.events || [];
}

// Lädt beide Kalender im Hintergrund, aktualisiert Cache + beide Ansichten
async function loadKalender(){
  const hint = document.getElementById('kalenderCacheHint');
  const hausHint = document.getElementById('hausKalenderCacheHint');
  if(!navigator.onLine){
    if(hint) hint.textContent = 'Offline – Cache angezeigt';
    if(hausHint) hausHint.textContent = 'Offline – Cache angezeigt';
    return;
  }
  try{
    const events = await fetchKalenderEvents(null);
    const now = Date.now();
    localStorage.setItem(KAL_CACHE_KEY, JSON.stringify({ events: events, ts: now }));
    syncStatusFromEvents(events);
    const txt = 'Geladen: ' + formatCacheTime(now.toString()) + ' Uhr';
    if(hint) hint.textContent = txt;
    if(hausHint) hausHint.textContent = txt;
    renderEventListe(filterAllgemeinEventsByMonth(events));
    renderHausEventListe(filterHausEventsByMonth(events));
  }catch(e){
    if(hint) hint.textContent = 'Fehler – Cache angezeigt';
    if(hausHint) hausHint.textContent = 'Fehler – Cache angezeigt';
  }
}

// Haus-Tab: nur Haus-Termine neu laden, allgemein-Termine im Cache erhalten
async function loadHausKalender(){
  const hint = document.getElementById('hausKalenderCacheHint');
  if(!document.getElementById('hausKalenderListe')) return;
  if(!navigator.onLine){
    if(hint) hint.textContent = 'Offline – Cache angezeigt';
    return;
  }
  try{
    const hausEvents = await fetchKalenderEvents('haus');
    const existing = readKalCache();
    let all = ((existing && existing.events) || []).filter(ev => ev.calendar !== 'haus').concat(hausEvents);
    all.sort((a, b) => new Date(a.start) - new Date(b.start));
    const now = Date.now();
    localStorage.setItem(KAL_CACHE_KEY, JSON.stringify({ events: all, ts: now }));
    syncStatusFromEvents(hausEvents);
    if(hint) hint.textContent = 'Geladen: ' + formatCacheTime(now.toString()) + ' Uhr';
    renderHausEventListe(filterHausEventsByMonth(all));
  }catch(e){
    if(hint) hint.textContent = 'Fehler – Cache angezeigt';
  }
}

// ====== EVENT-KARTEN (DOM, keine onclick-Strings) ======
function statusLabel(s){
  return s === 'dabei' ? '✅ Dabei' : s === 'vielleicht' ? '❔ Vielleicht' : '❌ Abgesagt';
}

function makeBtn(label, handler){
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', function(e){ e.stopPropagation(); handler(); });
  return b;
}

function styleGhostBtn(b){
  Object.assign(b.style, {
    flex: '0 0 auto', width: 'auto', minWidth: '0', margin: '0',
    padding: '4px 12px', fontSize: '12px', lineHeight: '1.2',
    background: 'transparent', border: '1px solid var(--muted, #888)',
    borderRadius: '8px', color: 'var(--muted, #aaa)', cursor: 'pointer'
  });
}

function styleStatusRow(box){
  box.className = 'event-status-row';
  Object.assign(box.style, {
    display: 'flex', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: '8px', marginTop: '8px'
  });
}

function makeBadge(text, color){
  const badge = document.createElement('span');
  badge.className = 'event-status-badge';
  Object.assign(badge.style, {
    display: 'inline-flex', alignItems: 'center', margin: '0', padding: '0',
    position: 'static', transform: 'none', fontSize: '13px', lineHeight: '1.2',
    color: color
  });
  badge.textContent = text;
  return badge;
}

// Erinnerungs-Termine (z.B. AWB): nur 'Erledigt' abhaken, für alle sichtbar.
// Nutzt intern den Status 'dabei'; 'rückgängig' löscht die eigene Zeile per removeattendance.
function renderReminderControls(box, ev){
  const session = getSession();
  const me = session ? session.name.toLowerCase() : '';
  const done = ev.teilnehmer || [];

  if(!done.length){
    box.className = 'event-actions';
    box.appendChild(makeBtn('✓ Erledigt', function(){ setAttendance(ev, 'dabei'); }));
    return;
  }

  styleStatusRow(box);
  box.appendChild(makeBadge('✓ Erledigt von ' + done.join(', '), 'var(--ok, #4caf50)'));
  if(done.some(n => (n || '').toLowerCase() === me)){
    const undo = makeBtn('rückgängig', function(){ removeAttendance(ev); });
    styleGhostBtn(undo);
    box.appendChild(undo);
  }
}

// Zeigt entweder die 3 Buttons oder (wenn Status existiert) Badge + 'ändern' in EINER Zeile
function renderAttendanceControls(box, ev, forceButtons){
  box.innerHTML = '';
  box.removeAttribute('style');

  if(isReminderEvent(ev)){
    renderReminderControls(box, ev);
    return;
  }

  const status = meineStatusMap[getEventKey(ev)] || null;

  if(status && !forceButtons){
    styleStatusRow(box);
    box.appendChild(makeBadge(statusLabel(status), status === 'abgesagt' ? 'var(--muted, #999)' : 'var(--ok, #4caf50)'));
    const change = makeBtn('ändern', function(){ renderAttendanceControls(box, ev, true); });
    styleGhostBtn(change);
    box.appendChild(change);
    return;
  }

  box.className = 'event-actions';
  box.appendChild(makeBtn('✅ Dabei', function(){ setAttendance(ev, 'dabei'); }));
  box.appendChild(makeBtn('❔ Evtl.', function(){ setAttendance(ev, 'vielleicht'); }));
  box.appendChild(makeBtn('❌ Absage', function(){ setAttendance(ev, 'abgesagt'); }));
}

function addSpan(parent, text, muted){
  const s = document.createElement('span');
  s.textContent = text;
  if(muted){ s.style.color = 'var(--muted)'; s.style.fontSize = '11px'; }
  parent.appendChild(s);
}

function formatEventWhen(ev, full){
  if(!ev.start) return '';
  const start = new Date(ev.start);
  const opts = full
    ? { weekday:'short', day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }
    : { weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' };
  return start.toLocaleString('de-DE', opts);
}

function buildEventCard(ev){
  const card = document.createElement('div');
  card.className = 'event-card';
  card.style.cursor = 'pointer';

  const h3 = document.createElement('h3');
  h3.textContent = ev.title || 'Ohne Titel';
  card.appendChild(h3);

  // Beschreibung erscheint nur in der Detailansicht (Klick auf den Termin)
  const when = formatEventWhen(ev, true);
  const meta = document.createElement('div');
  meta.className = 'event-meta';
  if(when) addSpan(meta, '🕐 ' + when);
  if(ev.location) addSpan(meta, '📍 ' + ev.location);
  card.appendChild(meta);

  const box = document.createElement('div');
  renderAttendanceControls(box, ev, false);
  card.appendChild(box);

  // Kurzliste der Zusagen direkt unter dem Termin (bei Erinnerungen übernimmt das die Erledigt-Zeile)
  if(!isReminderEvent(ev) && ev.teilnehmer && ev.teilnehmer.length){
    const t = document.createElement('div');
    t.className = 'event-teilnehmer';
    t.textContent = '👥 ' + ev.teilnehmer.join(', ');
    card.appendChild(t);
  }

  // Klick auf den Termin (nicht auf Buttons) öffnet die Detailansicht
  card.addEventListener('click', function(e){
    if(e.target.closest('button')) return;
    openEventDetail(ev);
  });
  return card;
}

function renderEventListe(events){
  const liste = document.getElementById('kalenderListe');
  if(!liste) return;
  renderKalMonthNav();
  if(!events || events.length === 0){
    liste.innerHTML = '<div class="kal-empty">Keine Termine in diesem Monat.</div>';
    return;
  }
  liste.innerHTML = '';
  events.forEach(ev => liste.appendChild(buildEventCard(ev)));
}

function renderHausEventListe(events){
  const liste = document.getElementById('hausKalenderListe');
  if(!liste) return;
  renderKalMonthNav();
  if(!events || events.length === 0){
    liste.innerHTML = '<div class="kal-empty">Keine Haus-Termine in diesem Monat.</div>';
    return;
  }
  liste.innerHTML = '';
  events.forEach(ev => liste.appendChild(buildEventCard(ev)));
}

// ====== TERMIN-DETAILANSICHT (Bottom-Sheet mit Animation) ======
function closeEventDetail(immediate){
  const old = document.getElementById('eventDetailOverlay');
  if(!old) return;
  if(immediate === true){ old.remove(); return; }
  // ID umbenennen, damit ein neues Sheet sofort geöffnet werden kann
  old.id = 'eventDetailClosing';
  old.style.opacity = '0';
  const sh = old.firstChild;
  if(sh) sh.style.transform = 'translateY(100%)';
  setTimeout(function(){ old.remove(); }, 300);
}

function openEventDetail(evIn){
  closeEventDetail(true);
  const ev = findCachedEvent(evIn) || evIn;

  const overlay = document.createElement('div');
  overlay.id = 'eventDetailOverlay';
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
    background: 'rgba(0,0,0,0.6)', zIndex: '1000',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    opacity: '0', transition: 'opacity 0.25s ease'
  });
  overlay.addEventListener('click', function(e){ if(e.target === overlay) closeEventDetail(); });

  const sheet = document.createElement('div');
  Object.assign(sheet.style, {
    background: 'var(--card, #1e1e1e)', color: 'var(--text, #eee)',
    width: '100%', maxWidth: '560px', maxHeight: '80vh', overflowY: 'auto',
    borderRadius: '16px 16px 0 0', padding: '16px 16px 28px', boxSizing: 'border-box',
    transform: 'translateY(100%)',
    transition: 'transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)'
  });

  const title = document.createElement('h3');
  title.textContent = ev.title || 'Ohne Titel';
  title.style.margin = '0 0 6px';
  sheet.appendChild(title);

  const info = document.createElement('div');
  info.style.fontSize = '13px';
  info.style.color = 'var(--muted, #aaa)';
  info.style.marginBottom = '12px';
  const parts = [];
  const when = formatEventWhen(ev, true);
  if(when) parts.push('🕐 ' + when);
  if(ev.location) parts.push('📍 ' + ev.location);
  info.textContent = parts.join('  ·  ');
  sheet.appendChild(info);

  if(ev.description){
    const desc = document.createElement('div');
    desc.textContent = ev.description;
    desc.style.fontSize = '13px';
    desc.style.color = 'var(--muted, #aaa)';
    desc.style.marginBottom = '12px';
    desc.style.whiteSpace = 'pre-wrap';
    sheet.appendChild(desc);
  }

  if(isReminderEvent(ev)){
    // Erinnerung: nur Erledigt-Status anzeigen
    const done = ev.teilnehmer || [];
    const head = document.createElement('div');
    head.style.fontWeight = '600';
    head.style.margin = '10px 0 4px';
    head.textContent = done.length ? '✓ Erledigt' : 'Noch nicht erledigt';
    sheet.appendChild(head);
    const who = document.createElement('div');
    who.style.fontSize = '14px';
    who.style.color = done.length ? 'inherit' : 'var(--muted, #888)';
    who.textContent = done.length ? 'von ' + done.join(', ') : '–';
    sheet.appendChild(who);
  } else {
    const teilnahmen = ev.teilnahmen || [];
    [['dabei', '✅ Dabei'], ['vielleicht', '❔ Vielleicht'], ['abgesagt', '❌ Abgesagt']].forEach(function(g){
      const namen = teilnahmen.filter(t => t.status === g[0]).map(t => t.name);
      const head = document.createElement('div');
      head.textContent = g[1] + ' (' + namen.length + ')';
      head.style.fontWeight = '600';
      head.style.margin = '10px 0 4px';
      sheet.appendChild(head);
      const list = document.createElement('div');
      list.textContent = namen.length ? namen.join(', ') : '–';
      list.style.fontSize = '14px';
      list.style.color = namen.length ? 'inherit' : 'var(--muted, #888)';
      sheet.appendChild(list);
    });
  }

  const close = document.createElement('button');
  close.textContent = 'Schließen';
  Object.assign(close.style, { marginTop: '18px', width: '100%', padding: '10px', cursor: 'pointer' });
  close.addEventListener('click', function(){ closeEventDetail(); });
  sheet.appendChild(close);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Startzustand rendern lassen, dann animiert einblenden
  void sheet.offsetHeight;
  requestAnimationFrame(function(){
    overlay.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  });
}

// ====== SETATTENDANCE (GET, wegen GAS-302-Redirect) ======
async function setAttendance(ev, status){
  const session = getSession();
  if(!session){ toast('Bitte erst anmelden.'); return; }

  const evKey = getEventKey(ev);
  const previous = meineStatusMap[evKey] || null;

  // Optimistic UI: Status sofort setzen, cachen und beide Listen neu zeichnen
  meineStatusMap[evKey] = status;
  saveMeineStatus();
  applyOwnStatusToCache(ev, session.name, status);
  renderKalenderFromCache();
  renderHausKalenderFromCache();

  if(!navigator.onLine){
    toast('Offline – Status ist nur lokal gespeichert');
    return;
  }

  try{
    const url = new URL(HAUS_SCRIPT_URL);
    url.searchParams.set('action', 'setattendance');
    url.searchParams.set('event_id', ev.id || '');
    url.searchParams.set('event_start', ev.start ? ev.start.toString() : '');
    url.searchParams.set('event_title', ev.title || '');
    url.searchParams.set('kalender', ev.calendar || '');
    url.searchParams.set('name', session.name);
    url.searchParams.set('status', status);
    url.searchParams.set('key', API_KEY);

    const res = await fetchWithTimeout(url.toString(), 20000);
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'Fehler');
    toast(isReminderEvent(ev) ? '✓ Als erledigt markiert' : '✓ Status gespeichert');
  }catch(e){
    // Rollback, damit die Anzeige nicht etwas Ungespeichertes vortäuscht
    if(previous) meineStatusMap[evKey] = previous; else delete meineStatusMap[evKey];
    saveMeineStatus();
    applyOwnStatusToCache(ev, session.name, previous);
    renderKalenderFromCache();
    renderHausKalenderFromCache();
    toast('⚠️ Nicht gespeichert: ' + e.message);
  }
}

// Eigenen Status komplett löschen (Backend-Action 'removeattendance', löscht die Zeile im Sheet)
async function removeAttendance(ev){
  const session = getSession();
  if(!session){ toast('Bitte erst anmelden.'); return; }

  const evKey = getEventKey(ev);
  const isReminder = isReminderEvent(ev);
  // Bei Erinnerungen kann der Haken nur aus den Server-Teilnahmen bekannt sein
  const previous = meineStatusMap[evKey] || (isReminder ? 'dabei' : null);
  if(!previous) return;

  // Optimistic UI: lokal entfernen, Cache anpassen, Listen neu zeichnen
  delete meineStatusMap[evKey];
  saveMeineStatus();
  applyOwnStatusToCache(ev, session.name, null);
  renderKalenderFromCache();
  renderHausKalenderFromCache();
  renderMeineZusagen();

  if(!navigator.onLine){
    toast('Offline – Status ist nur lokal entfernt');
    return;
  }

  try{
    const url = new URL(HAUS_SCRIPT_URL);
    url.searchParams.set('action', 'removeattendance');
    url.searchParams.set('event_id', ev.id || '');
    url.searchParams.set('event_start', ev.start ? ev.start.toString() : '');
    url.searchParams.set('name', session.name);
    url.searchParams.set('key', API_KEY);

    const res = await fetchWithTimeout(url.toString(), 20000);
    const data = await res.json();
    if(!data.ok) throw new Error(data.error || 'Fehler');
    toast(isReminder ? '✓ Haken entfernt' : '✓ Status entfernt');
  }catch(e){
    // Rollback: alter Status kommt zurück
    meineStatusMap[evKey] = previous;
    saveMeineStatus();
    applyOwnStatusToCache(ev, session.name, previous);
    renderKalenderFromCache();
    renderHausKalenderFromCache();
    renderMeineZusagen();
    const msg = String(e.message || '');
    if(msg.indexOf('unknown_action') !== -1){
      toast('⚠️ Backend-Update nötig (removeattendance) – Status blieb erhalten');
    } else {
      toast('⚠️ Nicht entfernt: ' + msg);
    }
  }
}

function renderMeineZusagen(){
  const liste = document.getElementById('meineZusagenListe');
  if(!liste) return;
  const data = readKalCache();
  if(!data){ liste.innerHTML = '<div class="kal-empty">Termine noch nicht geladen.</div>'; return; }
  const meine = (data.events || []).filter(ev => {
    if(isReminderEvent(ev)) return false;
    const s = meineStatusMap[getEventKey(ev)];
    return s === 'dabei' || s === 'vielleicht';
  });
  if(!meine.length){ liste.innerHTML = '<div class="kal-empty">Noch keine Zusagen.</div>'; return; }
  liste.innerHTML = '';
  meine.forEach(ev => {
    const s = meineStatusMap[getEventKey(ev)];
    const d = document.createElement('div');
    d.className = 'event-card';
    d.style.cursor = 'pointer';
    const h3 = document.createElement('h3');
    h3.textContent = (ev.title || '') + (ev.calendar === 'haus' ? ' 🏠' : '');
    d.appendChild(h3);
    const meta = document.createElement('div');
    meta.className = 'event-meta';
    addSpan(meta, '🕐 ' + formatEventWhen(ev, false));
    d.appendChild(meta);

    // Status links, 'Entfernen' rechts in derselben Zeile
    const row = document.createElement('div');
    styleStatusRow(row);
    row.appendChild(makeBadge(statusLabel(s), s === 'dabei' ? 'var(--ok, #4caf50)' : '#ffd'));
    const rm = makeBtn('Entfernen', function(){ removeAttendance(ev); });
    styleGhostBtn(rm);
    row.appendChild(rm);
    d.appendChild(row);

    d.addEventListener('click', function(e){
      if(e.target.closest('button')) return;
      openEventDetail(ev);
    });
    liste.appendChild(d);
  });
}

function escHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ====== PUTZPLAN ======
let putzError = '';
let hwState = { cfgData: null, personen: null, vorwoche: null, error: '' };

function sameNameFE(a, b){
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

// Kleiner DOM-Helfer: el('div', { class, text, style, on:{click}, ... }, [children])
function el(tag, props, children){
  const e = document.createElement(tag);
  if(props){
    Object.keys(props).forEach(function(k){
      if(k === 'text') e.textContent = props[k];
      else if(k === 'style') Object.assign(e.style, props[k]);
      else if(k === 'class') e.className = props[k];
      else if(k === 'on') Object.keys(props.on).forEach(function(ev){ e.addEventListener(ev, props.on[ev]); });
      else e[k] = props[k];
    });
  }
  (children || []).forEach(function(c){ if(c) e.appendChild(c); });
  return e;
}

function fmtDay(key){
  if(!key) return '';
  const p = String(key).split('-');
  return p[2] + '.' + p[1] + '.';
}

function addDaysKey(key, n){
  const p = String(key).split('-');
  const d = new Date(Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + n));
  const m = String(d.getUTCMonth() + 1);
  const t = String(d.getUTCDate());
  return d.getUTCFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (t.length < 2 ? '0' + t : t);
}

function sectionTitle(text){
  return el('div', { text: text, style: { fontWeight: '600', fontSize: '14px', margin: '16px 0 6px' } });
}

function noteLine(text, color){
  return el('div', { text: text, style: { fontSize: '12px', color: color || 'var(--muted, #999)', margin: '4px 0' } });
}

// Alle Putzplan-Aufrufe gehen als GET an das Haus-Script
async function hausGet(params){
  const url = new URL(HAUS_SCRIPT_URL);
  Object.keys(params).forEach(function(k){ url.searchParams.set(k, params[k]); });
  url.searchParams.set('key', API_KEY);
  const res = await fetchWithTimeout(url.toString(), 20000);
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Fehler vom Server');
  return data;
}

function readPutzCache(){
  try{
    const raw = localStorage.getItem(PUTZ_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

async function loadPutzplan(){
  if(!navigator.onLine) return;
  try{
    const data = await hausGet({ action: 'getputzplan' });
    localStorage.setItem(PUTZ_CACHE_KEY, JSON.stringify({ data: data, ts: Date.now() }));
    putzError = '';
  }catch(e){
    putzError = e.message || 'Fehler';
  }
  renderPutzAufgaben();
  const hv = document.getElementById('hausview-hauswart');
  if(hv && !hv.classList.contains('hidden')) renderHauswart();
}

// Aktion eines Mitglieds (name = angemeldete Person), danach Plan neu laden
async function putzAction(action, params, okMsg){
  const session = getSession();
  if(!session){ toast('Bitte erst anmelden.'); return; }
  if(!navigator.onLine){ toast('Kein Netz – bitte später erneut versuchen.'); return; }
  try{
    const p = Object.assign({ action: action, name: session.name }, params || {});
    await hausGet(p);
    if(okMsg) toast(okMsg);
  }catch(e){
    toast('⚠️ ' + e.message);
  }
  await loadPutzplan();
}

// Aktion des Hauswarts (name = Zielperson, steht in params), danach alles neu laden
async function hwAction(action, params, okMsg){
  const session = getSession();
  if(!session){ toast('Bitte erst anmelden.'); return; }
  if(!navigator.onLine){ toast('Kein Netz – bitte später erneut versuchen.'); return; }
  try{
    const p = Object.assign({ action: action, von: session.name }, params || {});
    await hausGet(p);
    if(okMsg) toast(okMsg);
  }catch(e){
    toast('⚠️ ' + e.message);
  }
  await loadPutzplan();
  await loadHauswart();
}

function putzStatusText(s){
  if(s === 'erledigt') return 'erledigt';
  if(s === 'verspaetet') return 'verspätet';
  if(s === 'nicht_erledigt') return 'nicht erledigt';
  return 'offen';
}

// ---- Aufgaben-Tab (Mitglieder) ----
function buildPutzTaskCard(a, me, canAct){
  const gem = a.typ === 'gemeinschaft';
  const card = el('div', { class: 'event-card' });
  card.appendChild(el('h3', { text: a.aufgabe }));
  if(gem){
    const sub = a.urspruenglich
      ? 'Eigentlich ' + a.urspruenglich + ' (abwesend) – jeder kann helfen'
      : 'Für alle – wer mithilft, setzt seinen Haken';
    card.appendChild(el('div', { class: 'event-meta' }, [el('span', { text: sub })]));
  }

  const mein = (a.haken || []).find(function(h){ return sameNameFE(h.name, me); }) || null;
  const row = el('div');
  styleStatusRow(row);

  let text;
  let color = 'var(--ok, #4caf50)';
  if(gem){
    const names = (a.haken || []).map(function(h){ return h.name + (h.puenktlich ? '' : ' (verspätet)'); });
    text = names.length ? '✓ Geholfen: ' + names.join(', ') : 'Noch niemand abgehakt';
    if(!names.length) color = 'var(--muted, #999)';
  } else if(mein){
    text = '✓ Erledigt' + (mein.puenktlich ? '' : ' (verspätet)');
  } else if(canAct){
    text = 'Offen';
    color = 'var(--muted, #999)';
  } else {
    text = 'Nicht erledigt';
    color = 'var(--muted, #999)';
  }
  row.appendChild(makeBadge(text, color));

  if(canAct){
    if(mein){
      const undo = makeBtn(gem ? 'Haken entfernen' : 'rückgängig', function(){
        putzAction('removeputzhaken', { aufgabe: a.aufgabe }, '✓ Haken entfernt');
      });
      styleGhostBtn(undo);
      row.appendChild(undo);
    } else {
      row.appendChild(makeBtn(gem ? '✓ Ich habe geholfen' : '✓ Erledigt', function(){
        putzAction('setputzhaken', { aufgabe: a.aufgabe }, '✓ Abgehakt');
      }));
    }
  }
  card.appendChild(row);
  return card;
}

function renderPutzAufgaben(){
  const box = document.getElementById('hausview-aufgaben');
  if(!box) return;
  const session = getSession();
  box.innerHTML = '';
  if(!session) return;

  const cache = readPutzCache();
  if(!cache){
    box.appendChild(el('div', { class: 'kal-empty', text: putzError ? '⚠️ ' + putzError : '⏳ Lade Putzplan…' }));
    return;
  }

  const data = cache.data;
  const w = data.woche;
  const jetzt = data.jetzt || {};
  const me = session.name;
  const canAct = !!jetzt.abhakbar && !w.abgeschlossen;

  box.appendChild(el('h3', { text: 'Putzwoche ' + fmtDay(w.start) + ' – ' + fmtDay(w.ende), style: { margin: '4px 0' } }));

  let info;
  if(w.abgeschlossen) info = 'Diese Woche ist abgeschlossen. Neue Aufgaben gibt es ab Mittwoch.';
  else if(jetzt.phase === 'verspaetet') info = 'Abhaken gilt jetzt als verspätet (möglich bis Sonntag).';
  else info = 'Pünktlich abhaken bis Freitag (' + fmtDay(w.punktlich_bis) + ').';
  box.appendChild(noteLine(info));
  if(putzError){
    box.appendChild(noteLine('⚠️ Aktualisieren fehlgeschlagen (' + putzError + ') – Stand vom ' + formatCacheTime(String(cache.ts)) + ' Uhr', '#e6a700'));
  }

  const meTeil = (w.teilnehmer || []).find(function(t){ return sameNameFE(t.name, me); });
  if(!meTeil){
    box.appendChild(el('div', { class: 'kal-empty', text: 'Du bist diese Woche nicht im Putzplan eingeplant.' }));
    return;
  }

  // Meine Aufgaben
  box.appendChild(sectionTitle('Meine Aufgaben'));
  const mine = (w.aufgaben || []).filter(function(a){ return a.typ === 'platz' && sameNameFE(a.zustaendig, me); });

  if(meTeil.abwesend){
    box.appendChild(noteLine('Du bist diese Woche als abwesend eingetragen. Deine Aufgaben sind für alle offen. Zurücksetzen kann nur der Hauswart.'));
  } else if(!mine.length){
    box.appendChild(noteLine('Diese Woche hast du keine feste Aufgabe.'));
  }
  mine.forEach(function(a){ box.appendChild(buildPutzTaskCard(a, me, canAct)); });

  const hatAbgehakt = mine.some(function(a){
    return (a.haken || []).some(function(h){ return sameNameFE(h.name, me); });
  });
  if(!meTeil.abwesend && canAct && mine.length && !hatAbgehakt){
    const abBtn = makeBtn('Ich bin diese Woche abwesend', function(){
      if(!confirm('Wirklich für diese Woche abwesend melden? Deine Aufgaben werden zu Gemeinschaftsaufgaben, zurücksetzen kann nur der Hauswart.')) return;
      putzAction('setputzabwesend', {}, '✓ Als abwesend eingetragen');
    });
    styleGhostBtn(abBtn);
    abBtn.style.marginTop = '8px';
    box.appendChild(abBtn);
  }

  // Gemeinschaftsaufgaben
  const gemein = (w.aufgaben || []).filter(function(a){ return a.typ === 'gemeinschaft'; });
  if(gemein.length){
    box.appendChild(sectionTitle('Gemeinschaftsaufgaben'));
    gemein.forEach(function(a){ box.appendChild(buildPutzTaskCard(a, me, canAct)); });
  }

  box.appendChild(noteLine('Stand: ' + formatCacheTime(String(cache.ts)) + ' Uhr'));
}

// ---- Hauswart-Tab ----
// Fügt den dritten Tab 'Hauswart' neben 'Aufgaben' ein (ohne index.html anzufassen)
function ensureHauswartTab(){
  if(document.getElementById('haustab-hauswart')) return;
  const tabAuf = document.getElementById('haustab-aufgaben');
  const viewAuf = document.getElementById('hausview-aufgaben');
  if(!tabAuf || !viewAuf || !tabAuf.parentNode || !viewAuf.parentNode) return;

  const tab = tabAuf.cloneNode(true);
  tab.id = 'haustab-hauswart';
  tab.removeAttribute('onclick');
  tab.textContent = 'Hauswart';
  tab.classList.remove('active');
  tab.addEventListener('click', function(){ switchHausTab('hauswart'); });
  tabAuf.parentNode.insertBefore(tab, tabAuf.nextSibling);

  const view = document.createElement('div');
  view.id = 'hausview-hauswart';
  view.className = viewAuf.className;
  view.classList.add('hidden');
  viewAuf.parentNode.insertBefore(view, viewAuf.nextSibling);
}

function buildHwPersonenListe(cfgData){
  const saved = (cfgData.personen || []).slice().sort(function(a, b){
    return (a.reihenfolge || 1e9) - (b.reihenfolge || 1e9);
  });
  const list = saved.map(function(p){ return { name: p.name, eingeplant: !!p.eingeplant }; });
  (cfg.haus || []).forEach(function(n){
    if(!list.some(function(p){ return sameNameFE(p.name, n); })) list.push({ name: n, eingeplant: false });
  });
  return list;
}

async function loadHauswart(){
  hwState.error = '';
  try{
    const cfgData = await hausGet({ action: 'getputzconfig' });
    hwState.cfgData = cfgData;
    if(!hwState.personen) hwState.personen = buildHwPersonenListe(cfgData);
  }catch(e){
    hwState.error = e.message || 'Fehler';
  }

  const cache = readPutzCache();
  const start = cache && cache.data && cache.data.woche ? cache.data.woche.start : null;
  hwState.vorwoche = null;
  if(start){
    try{
      const vw = await hausGet({ action: 'getputzplan', woche: addDaysKey(start, -7) });
      hwState.vorwoche = vw.woche;
    }catch(e){
      hwState.vorwoche = null;
    }
  }
  renderHauswart();
}

function buildHwTaskCard(a, w){
  const gem = a.typ === 'gemeinschaft';
  const card = el('div', { class: 'event-card' });
  card.appendChild(el('h3', { text: a.aufgabe }));

  const who = gem
    ? (a.urspruenglich ? 'Gemeinschaft (eigentlich ' + a.urspruenglich + ')' : 'Gemeinschaft (alle)')
    : 'Platz: ' + a.zustaendig;
  card.appendChild(el('div', { class: 'event-meta' }, [el('span', { text: who + ' · ' + putzStatusText(a.status) })]));

  (a.haken || []).forEach(function(h){
    const row = el('div');
    styleStatusRow(row);
    const t = '✓ ' + h.name + ' – ' + (h.puenktlich ? 'pünktlich' : 'verspätet') +
      (h.nachgetragen ? ' (nachgetragen von ' + h.gesetzt_von + ')' : '') + ' · ' + h.zeitpunkt;
    row.appendChild(makeBadge(t, h.puenktlich ? 'var(--ok, #4caf50)' : '#e6a700'));
    const rm = makeBtn('entfernen', function(){
      hwAction('putzhakenentfernen', { name: h.name, aufgabe: a.aufgabe }, '✓ Haken entfernt');
    });
    styleGhostBtn(rm);
    row.appendChild(rm);
    card.appendChild(row);
  });

  if(a.fehlt && a.fehlt.length){
    card.appendChild(noteLine('Nicht abgehakt: ' + a.fehlt.join(', ')));
  }

  // Nachtragen (pünktlich oder verspätet)
  const personen = gem
    ? (w.teilnehmer || []).map(function(t){ return t.name; })
    : [a.zustaendig];
  const sel = el('select', { style: { marginRight: '6px', maxWidth: '45%' } },
    personen.map(function(n){ return el('option', { value: n, text: n }); }));

  const actions = el('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '8px' } });
  if(gem) actions.appendChild(sel);
  const nachtragen = function(art){
    const person = gem ? sel.value : a.zustaendig;
    if(!person) return;
    hwAction('putznachtragen', { name: person, aufgabe: a.aufgabe, art: art }, '✓ Nachgetragen');
  };
  const b1 = makeBtn('pünktlich nachtragen', function(){ nachtragen('puenktlich'); });
  const b2 = makeBtn('verspätet nachtragen', function(){ nachtragen('verspaetet'); });
  styleGhostBtn(b1);
  styleGhostBtn(b2);
  actions.appendChild(b1);
  actions.appendChild(b2);
  card.appendChild(actions);
  return card;
}

function renderHwPersonen(container){
  container.innerHTML = '';
  const list = hwState.personen || [];
  if(!list.length){
    container.appendChild(noteLine('Keine Personen vorhanden (cfg.haus ist leer oder noch nicht geladen).'));
    return;
  }
  list.forEach(function(p, i){
    const row = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' } });
    const cb = el('input', { type: 'checkbox', checked: !!p.eingeplant });
    cb.addEventListener('change', function(){ p.eingeplant = cb.checked; });
    row.appendChild(cb);
    const imHaus = (cfg.haus || []).some(function(n){ return sameNameFE(n, p.name); });
    row.appendChild(el('span', { text: (i + 1) + '. ' + p.name + (imHaus ? '' : ' (nicht in Haus-Liste)'), style: { flex: '1' } }));

    const up = makeBtn('▲', function(){
      if(i > 0){ const t = list[i - 1]; list[i - 1] = list[i]; list[i] = t; renderHwPersonen(container); }
    });
    const down = makeBtn('▼', function(){
      if(i < list.length - 1){ const t = list[i + 1]; list[i + 1] = list[i]; list[i] = t; renderHwPersonen(container); }
    });
    styleGhostBtn(up);
    styleGhostBtn(down);
    row.appendChild(up);
    row.appendChild(down);
    container.appendChild(row);
  });
  container.appendChild(noteLine('Häkchen = eingeplant. Die Reihenfolge bestimmt die Rotation. Änderungen gelten ab der nächsten Putzwoche.'));
  const save = makeBtn('Personen speichern', function(){ hwSavePersonen(); });
  save.style.marginTop = '8px';
  container.appendChild(save);
}

async function hwSavePersonen(){
  const personen = (hwState.personen || []).map(function(p){
    return { name: p.name, eingeplant: p.eingeplant ? 'ja' : 'nein' };
  });
  if(!personen.some(function(p){ return p.eingeplant === 'ja'; })){
    toast('Bitte mindestens eine Person einplanen.');
    return;
  }
  try{
    await hausGet({ action: 'saveputzplan', personen: JSON.stringify(personen) });
    toast('✓ Gespeichert – gilt ab der nächsten Woche');
    hwState.personen = null;
  }catch(e){
    toast('⚠️ ' + e.message);
  }
  await loadHauswart();
}

function renderHauswart(){
  const box = document.getElementById('hausview-hauswart');
  if(!box) return;
  box.innerHTML = '';

  const cache = readPutzCache();
  if(!cache){
    box.appendChild(el('div', { class: 'kal-empty', text: putzError ? '⚠️ ' + putzError : '⏳ Lade…' }));
    return;
  }
  const w = cache.data.woche;

  box.appendChild(el('h3', { text: 'Hauswart – Woche ' + fmtDay(w.start) + ' – ' + fmtDay(w.ende), style: { margin: '4px 0' } }));
  if(hwState.error) box.appendChild(noteLine('⚠️ ' + hwState.error, '#e6a700'));
  if(putzError) box.appendChild(noteLine('⚠️ ' + putzError, '#e6a700'));

  // Diese Woche
  box.appendChild(sectionTitle('Diese Woche'));
  (w.aufgaben || []).forEach(function(a){ box.appendChild(buildHwTaskCard(a, w)); });
  if(!(w.aufgaben || []).length) box.appendChild(noteLine('Keine Aufgaben in dieser Woche.'));

  // Anwesenheit
  box.appendChild(sectionTitle('Anwesenheit'));
  (w.teilnehmer || []).forEach(function(t){
    const row = el('div');
    styleStatusRow(row);
    row.appendChild(makeBadge('Platz ' + t.platz + ' · ' + t.name + (t.abwesend ? ' – abwesend' : ''), t.abwesend ? '#e6a700' : 'inherit'));
    const btn = t.abwesend
      ? makeBtn('zurücksetzen', function(){ hwAction('resetputzabwesend', { name: t.name }, '✓ Abwesenheit zurückgesetzt'); })
      : makeBtn('abwesend setzen', function(){ hwAction('putzabwesendsetzen', { name: t.name }, '✓ Als abwesend eingetragen'); });
    styleGhostBtn(btn);
    row.appendChild(btn);
    box.appendChild(row);
  });
  if((w.frei || []).length) box.appendChild(noteLine('Ohne feste Aufgabe: ' + w.frei.join(', ')));

  // 'alle'-Aufgaben ein-/ausschalten
  const alleCfg = ((hwState.cfgData && hwState.cfgData.aufgaben) || []).filter(function(a){ return a.platz === 'alle'; });
  if(alleCfg.length){
    box.appendChild(sectionTitle('Aufgaben für alle (diese Woche)'));
    alleCfg.forEach(function(c){
      const inWeek = (w.aufgaben || []).some(function(a){
        return a.typ === 'gemeinschaft' && !a.urspruenglich && sameNameFE(a.aufgabe, c.aufgabe);
      });
      const row = el('div');
      styleStatusRow(row);
      row.appendChild(makeBadge(c.aufgabe + (inWeek ? ' – aktiv' : ' – aus'), inWeek ? 'var(--ok, #4caf50)' : 'var(--muted, #999)'));
      const btn = makeBtn(inWeek ? 'ausschalten' : 'einschalten', function(){
        hwAction('setputzgemeinschaft', { aufgabe: c.aufgabe, an: inWeek ? '0' : '1' }, inWeek ? '✓ Ausgeschaltet' : '✓ Eingeschaltet');
      });
      styleGhostBtn(btn);
      row.appendChild(btn);
      box.appendChild(row);
    });
  }

  // Vorwoche (Dokumentation)
  box.appendChild(sectionTitle('Vorwoche'));
  const vw = hwState.vorwoche;
  if(!vw){
    box.appendChild(noteLine('Für die Vorwoche gibt es keine Daten.'));
  } else {
    box.appendChild(noteLine('Woche ' + fmtDay(vw.start) + ' – ' + fmtDay(vw.ende)));
    const probleme = (vw.aufgaben || []).filter(function(a){ return a.status === 'nicht_erledigt' || a.status === 'verspaetet'; });
    if(!probleme.length) box.appendChild(noteLine('✓ Alles pünktlich erledigt.', 'var(--ok, #4caf50)'));
    (vw.aufgaben || []).forEach(function(a){
      const gem = a.typ === 'gemeinschaft';
      const wer = gem ? 'Gemeinschaft' : a.zustaendig;
      const helfer = (a.haken || []).map(function(h){ return h.name + (h.puenktlich ? '' : ' (verspätet)'); });
      const zeile = a.aufgabe + ' – ' + wer + ' – ' + putzStatusText(a.status) + (helfer.length ? ' · ' + helfer.join(', ') : '');
      const bad = a.status === 'nicht_erledigt';
      const late = a.status === 'verspaetet';
      box.appendChild(noteLine(zeile, bad ? '#e05353' : (late ? '#e6a700' : 'var(--muted, #999)')));
    });
  }

  // Personen und Reihenfolge
  box.appendChild(sectionTitle('Personen und Reihenfolge'));
  const personenBox = el('div');
  box.appendChild(personenBox);
  renderHwPersonen(personenBox);
}

// ====== STATUS / OFFLINE ======
function updateQueueBadge(){
  const b = document.getElementById('queueBadge');
  if(b) b.classList.add('hidden');
}

function updateStatus(){
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  const banner = document.getElementById('offlineBanner');
  const isOnline = navigator.onLine;
  if(isOnline){
    dot.classList.add('online'); txt.textContent = 'online';
    if(banner) banner.classList.add('hidden');
  } else {
    dot.classList.remove('online'); txt.textContent = 'offline';
    if(banner) banner.classList.remove('hidden');
  }
}
window.addEventListener('online', updateStatus);
window.addEventListener('offline', updateStatus);
setInterval(updateStatus, 15000);

// ====== HTTP HELPERS ======
function buildUrl(params){
  const u = new URL(SCRIPT_URL);
  Object.entries(params).forEach(([k,v]) => u.searchParams.set(k, v));
  u.searchParams.set('key', API_KEY);
  return u.toString();
}

function fetchWithTimeout(url, ms = 15000){
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(t));
}

async function rawGet(params, silent){
  try{
    const res = await fetch(buildUrl(params), { method:'GET' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    if(!silent) toast(text);
    return true;
  }catch(e){ return false; }
}

let sendingInProgress = false;
async function sendAction(params){
  if(sendingInProgress){
    toast('Bitte warten – vorherige Buchung läuft noch');
    return false;
  }
  sendingInProgress = true;
  setSendButtonsEnabled(false);
  const session = getSession();
  params.panel = (session ? session.name : 'Unbekannt') + 'PWA';
  try{
    const res = await fetchWithTimeout(buildUrl(params), 15000);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    toast(text || 'Gebucht!');
    return true;
  }catch(e){
    if(e.name === 'AbortError'){
      toast('⏰ Zeitüberschreitung – Aktion wurde evtl. trotzdem gespeichert. Bitte prüfen!');
    } else {
      toast('⚠️ Verbindungsfehler – Aktion wurde evtl. trotzdem gespeichert. Bitte prüfen!');
    }
    return false;
  } finally {
    sendingInProgress = false;
    setSendButtonsEnabled(true);
  }
}

function setSendButtonsEnabled(enabled){
  document.querySelectorAll('.btn-accent, .anzahl-btn, .name-btn, .btn-ok')
    .forEach(btn => { btn.disabled = !enabled; });
}

let toastTimer;
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function formatCacheTime(tsStr){
  if(!tsStr) return '';
  const d = new Date(parseInt(tsStr));
  if(isNaN(d)) return '';
  return d.toLocaleString('de-DE', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ====== CONFIG ======
function loadCachedConfig(){
  try{
    const raw = localStorage.getItem(CFG_CACHE_KEY);
    if(!raw) return false;
    const data = JSON.parse(raw);
    cfg.haus    = Array.isArray(data.haus)    ? data.haus    : [];
    cfg.nonloci = Array.isArray(data.nonloci) ? data.nonloci : [];
    const tsEl = document.getElementById('cfgTimestamp');
    if(tsEl && data.ts) tsEl.textContent = 'Zuletzt aktualisiert: ' + formatCacheTime(data.ts.toString()) + ' Uhr';
    renderAdminNameLists();
    return true;
  }catch(e){ return false; }
}

async function fetchConfig(background = false){
  if(!navigator.onLine){ loadCachedConfig(); return; }
  try{
    const res = await fetchWithTimeout(buildUrl({action:'getconfig'}), 10000);
    const data = await res.json();
    cfg.haus    = Array.isArray(data.haus)    ? data.haus    : [];
    cfg.nonloci = Array.isArray(data.nonloci) ? data.nonloci : [];
    const now = Date.now();
    localStorage.setItem(CFG_CACHE_KEY, JSON.stringify({ haus: cfg.haus, nonloci: cfg.nonloci, ts: now }));
    const tsEl = document.getElementById('cfgTimestamp');
    if(tsEl) tsEl.textContent = 'Zuletzt aktualisiert: ' + formatCacheTime(now.toString()) + ' Uhr';
    renderAdminNameLists();
    if(currentKat && currentKat.hasNameList) showNames();
  }catch(e){
    if(!background) loadCachedConfig();
  }
}

// ====== GETRÄNKE: KATEGORIEN & BUCHEN ======
function renderCats(){
  const grid = document.getElementById('catGrid');
  grid.innerHTML = '';
  KATEGORIEN.forEach((k, idx) => {
    const b = document.createElement('button');
    b.textContent = k.label;
    if(k.hasNameList){ b.className = 'btn-accent'; } else { b.className = 'btn-outline'; }
    if(k.fullWidth){ b.style.gridColumn = '1 / -1'; }
    b.onclick = () => selectCat(idx);
    grid.appendChild(b);
  });
}

function selectCat(idx){
  currentKat = KATEGORIEN[idx];
  if(currentKat.hasNameList){ showNames(); } else { currentName = currentKat.logName; showMenge(); }
}

function showCats(){
  document.getElementById('catCard').classList.remove('hidden');
  document.getElementById('nameCard').classList.add('hidden');
  document.getElementById('mengeCard').classList.add('hidden');
  document.getElementById('stornoCard').classList.remove('hidden');
}

function showNames(){
  document.getElementById('catCard').classList.add('hidden');
  document.getElementById('nameCard').classList.remove('hidden');
  document.getElementById('mengeCard').classList.add('hidden');
  document.getElementById('stornoCard').classList.add('hidden');
  document.getElementById('nameCardTitle').textContent = currentKat.label + ' – wer?';
  const list = currentKat.listKey === 'haus' ? cfg.haus : cfg.nonloci;
  const wrap = document.getElementById('nameList');
  wrap.innerHTML = '';
  if(!list || list.length === 0){
    wrap.innerHTML = "<p style='color:var(--muted);font-size:.85rem;padding:.5rem 0'>Keine Namen im Cache – wird geladen…</p>";
  } else {
    list.forEach(name => {
      const b = document.createElement('button');
      b.textContent = name;
      b.onclick = () => { currentName = name; showMenge(); };
      wrap.appendChild(b);
    });
  }
  const tsEl = document.getElementById('cfgTimestamp');
  if(tsEl && !tsEl.textContent){
    try{
      const raw = localStorage.getItem(CFG_CACHE_KEY);
      if(raw){ const d = JSON.parse(raw); if(d.ts) tsEl.textContent = 'Zuletzt aktualisiert: ' + formatCacheTime(d.ts.toString()) + ' Uhr'; }
    }catch(e){}
  }
}

function showMenge(){
  document.getElementById('catCard').classList.add('hidden');
  document.getElementById('nameCard').classList.add('hidden');
  document.getElementById('mengeCard').classList.remove('hidden');
  document.getElementById('stornoCard').classList.add('hidden');
  document.getElementById('mengeTitle').textContent = currentName;
  flaschenWert = 1; kistenWert = 1;
  renderMengeSteppers();
}

function renderMengeSteppers(){
  const grid = document.getElementById('mengeGrid');
  grid.innerHTML = '';
  const flWrap = document.createElement('div');
  flWrap.className = 'stepper-block';
  const flLabel = document.createElement('div');
  flLabel.className = 'stepper-label'; flLabel.textContent = 'Flaschen';
  flWrap.appendChild(flLabel);
  flWrap.appendChild(buildAnzahlGrid(FLASCHEN_MAX, 'flasche'));
  grid.appendChild(flWrap);
  const kiWrap = document.createElement('div');
  kiWrap.className = 'stepper-block';
  const kiLabel = document.createElement('div');
  kiLabel.className = 'stepper-label'; kiLabel.textContent = 'Kästen';
  kiWrap.appendChild(kiLabel);
  kiWrap.appendChild(buildAnzahlGrid(KISTEN_MAX, 'kasten'));
  grid.appendChild(kiWrap);
}

function buildAnzahlGrid(max, typ){
  const wrap = document.createElement('div');
  wrap.className = 'anzahl-grid';
  for(let i = 1; i <= max; i++){
    const b = document.createElement('button');
    b.textContent = i; b.className = 'anzahl-btn';
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
  ['zahlungNameList','strafeNameList'].forEach(listId => {
    const elx = document.getElementById(listId);
    if(!elx) return;
    elx.innerHTML = '';
    const typ = listId.startsWith('zahlung') ? 'zahlung' : 'strafe';
    allePersonen.forEach(name => {
      const b = document.createElement('button');
      b.textContent = name;
      b.onclick = () => selectAdminName(typ, name, b);
      elx.appendChild(b);
    });
  });
}

function selectAdminName(typ, name, btn){
  const listId = typ === 'zahlung' ? 'zahlungNameList' : 'strafeNameList';
  document.getElementById(listId).querySelectorAll('button').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  if(typ === 'zahlung') zahlungSelectedName = name;
  else strafeSelectedName = name;
}

async function doZahlung(){
  if(!zahlungSelectedName){ toast('Bitte zuerst eine Person auswählen.'); return; }
  const betragRaw = document.getElementById('zahlungBetrag').value.replace(',','.');
  const betrag = parseFloat(betragRaw);
  if(!betrag || betrag <= 0){ toast('Bitte einen gültigen Betrag eingeben.'); return; }
  if(!navigator.onLine){ toast('Kein Netz – Zahlung nicht möglich.'); return; }
  const ok = await sendAction({ action:'zahlung', name: zahlungSelectedName, betrag: betrag });
  if(ok){
    document.getElementById('zahlungBetrag').value = '';
    document.getElementById('zahlungNameList').querySelectorAll('button').forEach(b => b.classList.remove('selected'));
    zahlungSelectedName = null;
  }
}

async function doStrafe(){
  if(!strafeSelectedName){ toast('Bitte zuerst eine Person auswählen.'); return; }
  const betragRaw = document.getElementById('strafeBetrag').value.replace(',','.');
  const betrag = parseFloat(betragRaw);
  if(!betrag || betrag <= 0){ toast('Bitte einen gültigen Betrag eingeben.'); return; }
  const grund = document.getElementById('strafeGrund').value.trim();
  if(!navigator.onLine){ toast('Kein Netz – Strafe nicht möglich.'); return; }
  const params = { action:'strafe', name: strafeSelectedName, betrag: betrag };
  if(grund) params.grund = grund;
  const ok = await sendAction(params);
  if(ok){
    document.getElementById('strafeBetrag').value = '';
    document.getElementById('strafeGrund').value = '';
    document.getElementById('strafeNameList').querySelectorAll('button').forEach(b => b.classList.remove('selected'));
    strafeSelectedName = null;
  }
}

// ====== STAND & RANGLISTE ======
const STAND_CACHE_KEY          = 'bier_stand_cache';
const STAND_CACHE_TIME_KEY     = 'bier_stand_cache_time';
const RANGLISTE_CACHE_KEY      = 'bier_rangliste_cache';
const RANGLISTE_CACHE_TIME_KEY = 'bier_rangliste_cache_time';

function switchStandTab(tab){
  ['abrechnung','rangliste'].forEach(t => {
    document.getElementById('subview-' + t).classList.toggle('hidden', t !== tab);
    document.getElementById('subtab-' + t).classList.toggle('active', t === tab);
  });
}

function restoreCachedStand(){
  const cached = localStorage.getItem(STAND_CACHE_KEY);
  const ts     = localStorage.getItem(STAND_CACHE_TIME_KEY);
  const div    = document.getElementById('standResult');
  const hint   = document.getElementById('standCacheHint');
  if(cached && div){
    div.textContent = cached;
    if(hint) hint.textContent = 'Geladen: ' + formatCacheTime(ts);
  }
}

function restoreCachedRangliste(){
  const cached = localStorage.getItem(RANGLISTE_CACHE_KEY);
  const ts     = localStorage.getItem(RANGLISTE_CACHE_TIME_KEY);
  const div    = document.getElementById('ranglisteResult');
  const hint   = document.getElementById('ranglisteCacheHint');
  if(cached && div){
    div.textContent = cached;
    if(hint) hint.textContent = 'Geladen: ' + formatCacheTime(ts);
  }
}

// background=true: Cache bleibt sichtbar, kein 'Lade...', Fehler ändern nichts
async function loadStand(background){
  const div  = document.getElementById('standResult');
  const hint = document.getElementById('standCacheHint');
  const cached = localStorage.getItem(STAND_CACHE_KEY);
  const ts     = localStorage.getItem(STAND_CACHE_TIME_KEY);
  if(!background || !cached){ div.textContent = 'Lade...'; hint.textContent = ''; }
  if(!navigator.onLine){
    div.textContent = cached || 'Kein Netz und kein gespeicherter Stand vorhanden.';
    if(cached && hint) hint.textContent = 'Offline – zuletzt geladen: ' + formatCacheTime(ts);
    return;
  }
  try{
    const res = await fetchWithTimeout(buildUrl({action:'stand'}), 15000);
    if(!res.ok){ if(!background) div.textContent = 'Serverfehler (HTTP ' + res.status + ').'; return; }
    const text = await res.text();
    if(!text || text.trim().length === 0){ if(!background) div.textContent = 'Server hat leere Antwort geschickt.'; return; }
    div.textContent = text;
    const now = Date.now().toString();
    localStorage.setItem(STAND_CACHE_KEY, text);
    localStorage.setItem(STAND_CACHE_TIME_KEY, now);
    if(hint) hint.textContent = 'Geladen: ' + formatCacheTime(now);
  }catch(e){
    if(background && cached){
      if(hint) hint.textContent = 'Fehler – zuletzt geladen: ' + formatCacheTime(ts);
      return;
    }
    div.textContent = (e.name === 'AbortError' ? 'Zeitüberschreitung.' : 'Fehler beim Laden.') +
      (cached ? '\n\n' + cached : '');
    if(cached && hint) hint.textContent = 'Offline – zuletzt geladen: ' + formatCacheTime(ts);
  }
}

async function loadRangliste(background){
  const div  = document.getElementById('ranglisteResult');
  const hint = document.getElementById('ranglisteCacheHint');
  const cached = localStorage.getItem(RANGLISTE_CACHE_KEY);
  const ts     = localStorage.getItem(RANGLISTE_CACHE_TIME_KEY);
  if(!background || !cached){ div.textContent = 'Lade... (kann bis zu 45 Sek. dauern)'; hint.textContent = ''; }
  if(!navigator.onLine){
    div.textContent = cached || 'Kein Netz und keine gespeicherte Rangliste vorhanden.';
    if(cached && hint) hint.textContent = 'Offline – zuletzt geladen: ' + formatCacheTime(ts);
    return;
  }
  try{
    const res = await fetchWithTimeout(buildUrl({action:'semester'}), 45000);
    if(!res.ok){ if(!background) div.textContent = 'Serverfehler (HTTP ' + res.status + ').'; return; }
    const text = await res.text();
    if(!text || text.trim().length === 0){ if(!background) div.textContent = 'Server hat leere Antwort geschickt.'; return; }
    div.textContent = text;
    const now = Date.now().toString();
    localStorage.setItem(RANGLISTE_CACHE_KEY, text);
    localStorage.setItem(RANGLISTE_CACHE_TIME_KEY, now);
    if(hint) hint.textContent = 'Geladen: ' + formatCacheTime(now);
  }catch(e){
    if(background && cached){
      if(hint) hint.textContent = 'Fehler – zuletzt geladen: ' + formatCacheTime(ts);
      return;
    }
    div.textContent = (e.name === 'AbortError' ? 'Zeitüberschreitung – Server zu langsam.' : 'Fehler beim Laden.') +
      (cached ? '\n\nZuletzt gespeichert:\n' + cached : '');
    if(cached && hint) hint.textContent = 'Offline – zuletzt geladen: ' + formatCacheTime(ts);
  }
}

// ====== STORNO ======
async function doStorno(){
  if(!navigator.onLine){ toast('Kein Netz -- Storno nicht möglich.'); return; }
  try{
    const res = await fetchWithTimeout(buildUrl({action:'storno'}), 15000);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    toast(text || 'Storno verarbeitet.');
  }catch(e){
    if(e.name === 'AbortError'){
      toast('⏰ Zeitüberschreitung – Storno wurde evtl. trotzdem ausgeführt. Bitte Stand prüfen!');
    } else {
      toast('⚠️ Verbindungsfehler beim Storno – bitte Stand prüfen, es könnte trotzdem geklappt haben.');
    }
  }
}

// ====== LAGER ======
function restoreCachedLager(){
  try{
    const raw = localStorage.getItem(LAGER_CACHE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    const numEl = document.getElementById('lagerBestandNum');
    const tsEl  = document.getElementById('lagerTimestamp');
    if(numEl) numEl.textContent = data.bestand ?? '–';
    if(tsEl && data.ts) tsEl.textContent = 'Cache: ' + formatCacheTime(data.ts.toString()) + ' Uhr';
  }catch(e){}
}

async function loadLager(){
  const numEl = document.getElementById('lagerBestandNum');
  const tsEl  = document.getElementById('lagerTimestamp');
  if(numEl) numEl.textContent = '…';
  if(tsEl)  tsEl.textContent  = 'Lädt…';
  if(!navigator.onLine){
    restoreCachedLager();
    if(tsEl) tsEl.textContent += ' (offline)';
    return;
  }
  try{
    const res  = await fetchWithTimeout(buildUrl({action:'getlager'}), 15000);
    const data = await res.json();
    const now  = Date.now();
    localStorage.setItem(LAGER_CACHE_KEY, JSON.stringify({ bestand: data.bestand, ts: now }));
    if(numEl) numEl.textContent = data.bestand ?? '–';
    if(tsEl)  tsEl.textContent  = 'Aktualisiert: ' + formatCacheTime(now.toString()) + ' Uhr';
  }catch(e){
    restoreCachedLager();
    if(tsEl) tsEl.textContent += ' (Fehler – Cache)';
  }
}

async function doEinkauf(){
  const kisten = document.getElementById('einkaufKisten').value;
  if(!kisten || kisten <= 0){ toast('Bitte Anzahl Kisten eingeben'); return; }
  await sendAction({ action:'einkauf', menge:kisten, typ:'kasten' });
}

async function doInventur(){
  const flaschen = document.getElementById('inventurFlaschen').value;
  if(!flaschen){ toast('Bitte Flaschenzahl eingeben'); return; }
  await sendAction({ action:'inventur', menge:flaschen });
}

// ====== GETRÄNKE: INTERNER TAB-WECHSEL ======
function switchTab(tab){
  ['log','stand','admin'].forEach(t => {
    document.getElementById('view-' + t).classList.toggle('hidden', t !== tab);
    document.getElementById('tab-' + t).classList.toggle('active', t === tab);
  });
  if(tab === 'admin') restoreCachedLager();
}

// ====== INIT ======
checkSessionOnLoad();

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('SW registriert', reg.scope))
      .catch(err => console.error('SW Registrierung fehlgeschlagen', err));
  });
}
