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

function enterApp(session){
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('appRoot').classList.remove('app-hidden');
  document.getElementById('loggedInName').textContent = session.name;
  document.getElementById('loggedInName').classList.remove('hidden');
  document.getElementById('logoutBtn').classList.remove('hidden');
  document.getElementById('bottomNav').style.display = '';

  const isAdmin = session.rolle === 'admin' || session.rolle === 'kassenwart';
  document.getElementById('tab-admin').style.display = isAdmin ? '' : 'none';

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

  // Putzplan: UI aufbauen, Cache zeigen, für Hausmitglieder im Hintergrund laden
  try{
    setupPutzplanUi(session);
    const cachedPutz = readPutzCache();
    if(cachedPutz && cachedPutz.data){ putzData = cachedPutz.data; renderPutzplan(); }
    if(isHausMember(session)) loadPutzplan();
  }catch(e){ console.error('Putzplan-Init fehlgeschlagen', e); }

  // Alles aus dem Cache anzeigen, im Hintergrund neu laden
  loadLager();
  loadKalender();
  loadStand(true);
  loadRangliste(true);
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
}

// Haus-Unterbereiche: kalender, aufgaben (Putzplan), hauswart (nur Hauswart/Admin, wird per JS angelegt)
function switchHausTab(tab){
  ['kalender','aufgaben','hauswart'].forEach(t => {
    const v = document.getElementById('hausview-' + t);
    const b = document.getElementById('haustab-' + t);
    if(v) v.classList.toggle('hidden', t !== tab);
    if(b) b.classList.toggle('active', t === tab);
  });
  try{
    if(tab === 'aufgaben') loadPutzplan();
    if(tab === 'hauswart') loadHauswartPanel();
  }catch(e){ console.error(e); }
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
    const el = document.getElementById(listId);
    if(!el) return;
    el.innerHTML = '';
    const typ = listId.startsWith('zahlung') ? 'zahlung' : 'strafe';
    allePersonen.forEach(name => {
      const b = document.createElement('button');
      b.textContent = name;
      b.onclick = () => selectAdminName(typ, name, b);
      el.appendChild(b);
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

// ====================================================
// PUTZPLAN (Aufgaben-Tab) + HAUSWART-TAB
// ====================================================
const PUTZ_CACHE_KEY = 'bier_putz_cache';
let putzData = null;        // letzte Antwort von getputzplan
let putzHint = '';
let hauswartConfig = null;  // Antwort von getputzconfig
let hauswartPrev = null;    // Vorwoche (Ansicht)
let hwPersonen = [];        // Editor-Zustand: [{name, eingeplant}]

function isHauswartSession(session){
  return !!session && (session.rolle === 'hauswart' || session.rolle === 'admin');
}

function isHausMember(session){
  try{
    if(!session) return false;
    const raw = localStorage.getItem(CFG_CACHE_KEY);
    if(!raw) return false;
    const data = JSON.parse(raw);
    const n = session.name.toLowerCase();
    return (Array.isArray(data.haus) ? data.haus : []).some(h => String(h).toLowerCase() === n);
  }catch(e){ return false; }
}

function sameNameJs(a, b){
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

// '2026-09-30' -> '30.09.'
function fmtDay(key){
  const p = String(key || '').split('-');
  return p.length === 3 ? p[2] + '.' + p[1] + '.' : '';
}

function addDaysJs(key, n){
  const p = String(key).split('-');
  const ms = Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)) + n * 86400000;
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return d.getUTCFullYear() + '-' + mm + '-' + dd;
}

function readPutzCache(){
  try{
    const raw = localStorage.getItem(PUTZ_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

function writePutzCache(data){
  try{ localStorage.setItem(PUTZ_CACHE_KEY, JSON.stringify({ data: data, ts: Date.now() })); }catch(e){}
}

// Kleine Helfer zum Bauen von DOM-Elementen
function mk(tag, text, style){
  const e = document.createElement(tag);
  if(text !== undefined && text !== null) e.textContent = text;
  if(style) Object.assign(e.style, style);
  return e;
}

function mkTitle(text){
  return mk('div', text, { fontWeight: '600', fontSize: '15px', margin: '14px 0 6px' });
}

function mkInfo(text){
  return mk('div', text, { fontSize: '13px', color: 'var(--muted, #aaa)', margin: '4px 0 10px' });
}

// Aufruf des Haus-Backends (GET)
async function putzApi(action, params){
  const url = new URL(HAUS_SCRIPT_URL);
  url.searchParams.set('action', action);
  Object.keys(params || {}).forEach(k => {
    if(params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
  });
  url.searchParams.set('key', API_KEY);
  const res = await fetchWithTimeout(url.toString(), 20000);
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || 'Fehler');
  return data;
}

function putzStatusLabel(s){
  return s === 'erledigt' ? '✓ Erledigt'
    : s === 'verspaetet' ? '⚠ Verspätet'
    : s === 'nicht_erledigt' ? '✗ Nicht erledigt'
    : '• Offen';
}

function putzStatusColor(s){
  return s === 'erledigt' ? 'var(--ok, #4caf50)'
    : s === 'verspaetet' ? '#e0a030'
    : s === 'nicht_erledigt' ? '#e05050'
    : 'var(--muted, #aaa)';
}

function putzTaskStatus(task, abgeschlossen){
  if(task.haken && task.haken.length){
    return task.haken.some(h => h.puenktlich) ? 'erledigt' : 'verspaetet';
  }
  return abgeschlossen ? 'nicht_erledigt' : 'offen';
}

function putzPhaseText(jetzt, w){
  if(jetzt.phase === 'punktlich'){
    return 'Abhaken ist bis Freitag (' + fmtDay(w.punktlich_bis) + ') pünktlich. Danach zählt es als verspätet.';
  }
  if(jetzt.phase === 'verspaetet'){
    return 'Achtung: Abhaken zählt jetzt als verspätet (möglich bis Sonntag ' + fmtDay(w.verspaetet_bis) + ').';
  }
  return 'Diese Woche ist abgeschlossen. Die neuen Aufgaben erscheinen am Mittwoch. Nachträge macht der Hauswart.';
}

// Legt die Hauswart-Unterseite an und bereitet den Putzplan-Container vor.
// index.html bleibt unverändert: alles wird in die vorhandenen Aufgaben-Container gebaut.
function setupPutzplanUi(session){
  const tabAuf = document.getElementById('haustab-aufgaben');
  const viewAuf = document.getElementById('hausview-aufgaben');
  if(!tabAuf || !viewAuf) return;

  if(!document.getElementById('putzplanRoot')){
    Array.prototype.slice.call(viewAuf.children).forEach(function(c){ c.style.display = 'none'; });
    const root = document.createElement('div');
    root.id = 'putzplanRoot';
    viewAuf.appendChild(root);
  }

  if(isHauswartSession(session) && !document.getElementById('haustab-hauswart')){
    const btn = tabAuf.cloneNode(true);
    btn.id = 'haustab-hauswart';
    btn.removeAttribute('onclick');
    btn.textContent = 'Hauswart';
    btn.classList.remove('active');
    btn.addEventListener('click', function(){ switchHausTab('hauswart'); });
    tabAuf.parentNode.insertBefore(btn, tabAuf.nextSibling);

    const view = document.createElement('div');
    view.id = 'hausview-hauswart';
    view.className = viewAuf.className;
    view.classList.add('hidden');
    const rootH = document.createElement('div');
    rootH.id = 'hauswartRoot';
    view.appendChild(rootH);
    viewAuf.parentNode.insertBefore(view, viewAuf.nextSibling);
  }
}

// ---- Putzplan: Mitglieder-Ansicht ----
async function loadPutzplan(){
  const root = document.getElementById('putzplanRoot');
  if(!root) return;

  const cached = readPutzCache();
  if(cached && cached.data){
    putzData = cached.data;
    putzHint = 'Cache: ' + formatCacheTime(String(cached.ts || ''));
    renderPutzplan();
  } else if(!putzData){
    root.innerHTML = '';
    root.appendChild(mkInfo('⏳ Lade Putzplan …'));
  }

  if(!navigator.onLine){
    putzHint = 'Offline – Cache angezeigt';
    if(putzData) renderPutzplan();
    return;
  }

  try{
    const data = await putzApi('getputzplan', {});
    putzData = data;
    writePutzCache(data);
    putzHint = 'Geladen: ' + formatCacheTime(String(Date.now())) + ' Uhr';
    renderPutzplan();
  }catch(e){
    if(putzData){
      putzHint = 'Fehler – Cache angezeigt';
      renderPutzplan();
    } else {
      root.innerHTML = '';
      root.appendChild(mkInfo('⚠️ ' + e.message));
    }
  }
}

function renderPutzplan(){
  const root = document.getElementById('putzplanRoot');
  if(!root || !putzData || !putzData.woche) return;
  const session = getSession();
  const me = session ? session.name : '';
  const w = putzData.woche;
  const jetzt = putzData.jetzt || {};
  const canAct = !!jetzt.abhakbar && !w.abgeschlossen;

  root.innerHTML = '';
  root.appendChild(mkTitle('Putzplan · ' + fmtDay(w.start) + ' – ' + fmtDay(w.ende)));
  root.appendChild(mkInfo(putzPhaseText(jetzt, w)));

  const myTeil = (w.teilnehmer || []).find(t => sameNameJs(t.name, me));
  if(!myTeil){
    root.appendChild(mkInfo('Du bist diese Woche nicht im Putzplan eingeplant.'));
    if(putzHint) root.appendChild(mkInfo(putzHint));
    return;
  }

  const mine = (w.aufgaben || []).filter(a => a.typ === 'platz' && sameNameJs(a.zustaendig, me));
  const gem = (w.aufgaben || []).filter(a => a.typ === 'gemeinschaft');

  root.appendChild(mkTitle('Meine Aufgaben'));
  if(myTeil.abwesend){
    root.appendChild(mkInfo('Du bist diese Woche als abwesend eingetragen. Zurücksetzen kann nur der Hauswart.'));
  } else if(!mine.length){
    root.appendChild(mkInfo('Diese Woche hast du keine feste Aufgabe.'));
  } else {
    mine.forEach(t => root.appendChild(buildPutzTaskCard(t, me, canAct)));
  }

  if(!myTeil.abwesend && canAct && mine.length){
    const noch = mine.every(t => !(t.haken || []).some(h => sameNameJs(h.name, me)));
    if(noch){
      const b = makeBtn('Ich bin diese Woche abwesend', putzSetAbwesend);
      styleGhostBtn(b);
      b.style.margin = '6px 0 4px';
      root.appendChild(b);
    }
  }

  if(gem.length){
    root.appendChild(mkTitle('Gemeinschaftsaufgaben'));
    root.appendChild(mkInfo('Jede Person, die mitgeholfen hat, setzt ihren eigenen Haken.'));
    gem.forEach(t => root.appendChild(buildPutzTaskCard(t, me, canAct)));
  }

  if(putzHint) root.appendChild(mkInfo(putzHint));
}

function buildPutzTaskCard(task, me, canAct){
  const card = document.createElement('div');
  card.className = 'event-card';

  let title = task.aufgabe;
  if(task.urspruenglich) title += '  (eigentlich ' + task.urspruenglich + ')';
  card.appendChild(mk('h3', title));

  const row = document.createElement('div');
  styleStatusRow(row);

  const mein = (task.haken || []).find(h => sameNameJs(h.name, me));
  let text;
  let color;
  if(task.typ === 'platz'){
    if(mein){
      text = '✓ Erledigt' + (mein.puenktlich ? '' : ' · verspätet') + (mein.nachgetragen ? ' · nachgetragen' : '');
      color = mein.puenktlich ? 'var(--ok, #4caf50)' : '#e0a030';
    } else {
      text = putzStatusLabel(task.status);
      color = putzStatusColor(task.status);
    }
  } else {
    const namen = (task.haken || []).map(h => h.name + (h.puenktlich ? '' : ' (verspätet)'));
    text = namen.length ? '✓ Erledigt von ' + namen.join(', ') : putzStatusLabel(task.status);
    color = namen.length ? 'var(--ok, #4caf50)' : putzStatusColor(task.status);
  }
  row.appendChild(makeBadge(text, color));

  if(canAct){
    if(mein){
      const undo = makeBtn('rückgängig', function(){ putzToggleHaken(task.aufgabe, false); });
      styleGhostBtn(undo);
      row.appendChild(undo);
    } else {
      const label = task.typ === 'gemeinschaft' ? '✓ Ich habe geholfen' : '✓ Erledigt';
      row.appendChild(makeBtn(label, function(){ putzToggleHaken(task.aufgabe, true); }));
    }
  }

  card.appendChild(row);
  return card;
}

// Lokale, optimistische Änderung eines Hakens in putzData
function putzApplyHakenLocal(aufgabe, name, set){
  if(!putzData || !putzData.woche) return;
  const w = putzData.woche;
  const punkt = (putzData.jetzt && putzData.jetzt.phase) === 'punktlich';
  (w.aufgaben || []).forEach(t => {
    if(!sameNameJs(t.aufgabe, aufgabe)) return;
    t.haken = (t.haken || []).filter(h => !sameNameJs(h.name, name));
    if(set){
      t.haken.push({ name: name, zeitpunkt: '', puenktlich: punkt, nachgetragen: false, gesetzt_von: name });
    }
    t.status = putzTaskStatus(t, !!w.abgeschlossen);
    if(t.typ === 'gemeinschaft' && !t.urspruenglich){
      t.fehlt = (w.teilnehmer || [])
        .filter(p => !p.abwesend && !t.haken.some(h => sameNameJs(h.name, p.name)))
        .map(p => p.name);
    }
  });
}

async function putzToggleHaken(aufgabe, set){
  const session = getSession();
  if(!session){ toast('Bitte erst anmelden.'); return; }
  if(!navigator.onLine){ toast('Offline – Abhaken braucht eine Verbindung.'); return; }

  const before = JSON.stringify(putzData);
  putzApplyHakenLocal(aufgabe, session.name, set);
  writePutzCache(putzData);
  renderPutzplan();

  try{
    await putzApi(set ? 'setputzhaken' : 'removeputzhaken', { name: session.name, aufgabe: aufgabe });
    toast(set ? '✓ Erledigt gespeichert' : '✓ Rückgängig gemacht');
  }catch(e){
    putzData = JSON.parse(before);
    writePutzCache(putzData);
    renderPutzplan();
    toast('⚠️ ' + e.message);
  }
}

async function putzSetAbwesend(){
  const session = getSession();
  if(!session) return;
  if(!navigator.onLine){ toast('Offline – bitte später erneut versuchen.'); return; }
  const ok = confirm('Wirklich für diese Woche abwesend melden? Deine Aufgaben werden zu Gemeinschaftsaufgaben. Zurücksetzen kann nur der Hauswart.');
  if(!ok) return;
  try{
    await putzApi('setputzabwesend', { name: session.name });
    toast('✓ Als abwesend eingetragen');
    await loadPutzplan();
  }catch(e){
    toast('⚠️ ' + e.message);
  }
}

// ---- Hauswart-Tab ----
async function loadHauswartPanel(){
  const root = document.getElementById('hauswartRoot');
  if(!root) return;
  if(!root.firstChild) root.appendChild(mkInfo('⏳ Lade …'));
  if(!navigator.onLine){
    root.innerHTML = '';
    root.appendChild(mkInfo('Offline – der Hauswart-Bereich braucht eine Verbindung.'));
    return;
  }
  try{
    const res = await Promise.all([ putzApi('getputzplan', {}), putzApi('getputzconfig', {}) ]);
    putzData = res[0];
    writePutzCache(putzData);
    hauswartConfig = res[1];
    try{
      const prev = await putzApi('getputzplan', { woche: addDaysJs(putzData.woche.start, -7) });
      hauswartPrev = prev.woche;
    }catch(e){
      hauswartPrev = null;
    }
    hwPersonen = hwBuildPersonenState();
    renderHauswartPanel();
    renderPutzplan();
  }catch(e){
    root.innerHTML = '';
    root.appendChild(mkInfo('⚠️ ' + e.message));
  }
}

function hwBuildPersonenState(){
  const conf = ((hauswartConfig && hauswartConfig.personen) || []).slice();
  conf.sort((a, b) => (a.reihenfolge || 1e9) - (b.reihenfolge || 1e9));
  const seen = {};
  const out = [];
  conf.forEach(p => {
    const k = String(p.name).toLowerCase();
    if(seen[k]) return;
    seen[k] = true;
    out.push({ name: p.name, eingeplant: !!p.eingeplant });
  });
  (cfg.haus || []).forEach(n => {
    const k = String(n).toLowerCase();
    if(seen[k]) return;
    seen[k] = true;
    out.push({ name: n, eingeplant: false });
  });
  return out;
}

async function hwAction(action, params, okText){
  try{
    await putzApi(action, params);
    toast('✓ ' + okText);
    await loadHauswartPanel();
  }catch(e){
    toast('⚠️ ' + e.message);
  }
}

function renderHauswartPanel(){
  const root = document.getElementById('hauswartRoot');
  if(!root || !putzData || !putzData.woche) return;
  const w = putzData.woche;

  root.innerHTML = '';
  root.appendChild(mkTitle('Hauswart · Woche ' + fmtDay(w.start) + ' – ' + fmtDay(w.ende)));
  root.appendChild(mkInfo(putzPhaseText(putzData.jetzt || {}, w)));
  const reload = makeBtn('Neu laden', loadHauswartPanel);
  styleGhostBtn(reload);
  root.appendChild(reload);

  appendAdminAlleToggles(root);

  root.appendChild(mkTitle('Diese Woche'));
  appendAdminWeek(root, w);

  appendAdminPersonen(root, w);

  root.appendChild(mkTitle('Vorwoche'));
  if(hauswartPrev){
    appendAdminWeek(root, hauswartPrev);
  } else {
    root.appendChild(mkInfo('Keine Vorwoche gespeichert.'));
  }

  appendAdminEditor(root);
}

function appendAdminAlleToggles(root){
  const alle = ((hauswartConfig && hauswartConfig.aufgaben) || []).filter(a => a.platz === 'alle');
  if(!alle.length) return;
  root.appendChild(mkTitle('Aufgaben für alle (diese Woche)'));
  alle.forEach(a => {
    const aktiv = (putzData.woche.aufgaben || []).some(t => sameNameJs(t.aufgabe, a.aufgabe));
    const row = document.createElement('div');
    styleStatusRow(row);
    row.appendChild(mk('span', a.aufgabe + (aktiv ? ' · eingeschaltet' : ' · aus'), { fontSize: '13px' }));
    const b = makeBtn(aktiv ? 'ausschalten' : 'einschalten', function(){
      hwAction('setputzgemeinschaft', { aufgabe: a.aufgabe, an: aktiv ? '0' : '1' }, aktiv ? 'Ausgeschaltet' : 'Eingeschaltet');
    });
    styleGhostBtn(b);
    row.appendChild(b);
    root.appendChild(row);
  });
}

function appendAdminWeek(root, week){
  const counts = { erledigt: 0, verspaetet: 0, nicht_erledigt: 0, offen: 0 };
  (week.aufgaben || []).forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
  root.appendChild(mkInfo(
    fmtDay(week.start) + ' – ' + fmtDay(week.ende) + ': ' +
    counts.erledigt + ' erledigt, ' + counts.verspaetet + ' verspätet, ' +
    counts.nicht_erledigt + ' nicht erledigt, ' + counts.offen + ' offen'
  ));
  if(!(week.aufgaben || []).length){
    root.appendChild(mkInfo('Keine Aufgaben in dieser Woche.'));
    return;
  }
  week.aufgaben.forEach(t => root.appendChild(buildAdminTaskCard(t, week)));
}

function buildAdminTaskCard(task, week){
  const card = document.createElement('div');
  card.className = 'event-card';

  let title = task.aufgabe;
  if(task.typ === 'platz'){
    title += ' → ' + task.zustaendig;
  } else {
    title += ' · Gemeinschaft' + (task.urspruenglich ? ' (eigentlich ' + task.urspruenglich + ')' : '');
  }
  card.appendChild(mk('h3', title));
  card.appendChild(mk('div', putzStatusLabel(task.status), { fontSize: '13px', color: putzStatusColor(task.status), margin: '2px 0 6px' }));

  (task.haken || []).forEach(h => {
    const row = document.createElement('div');
    styleStatusRow(row);
    row.style.marginTop = '4px';
    const txt = h.name + ' · ' + (h.puenktlich ? 'pünktlich' : 'verspätet') +
      (h.zeitpunkt ? ' · ' + h.zeitpunkt : '') + (h.nachgetragen ? ' · nachgetragen' : '');
    row.appendChild(mk('span', txt, { fontSize: '12px' }));
    const rm = makeBtn('entfernen', function(){
      hwAction('putzhakenentfernen', { name: h.name, aufgabe: task.aufgabe, woche: week.start }, 'Haken entfernt');
    });
    styleGhostBtn(rm);
    row.appendChild(rm);
    card.appendChild(row);
  });

  if(task.fehlt && task.fehlt.length){
    card.appendChild(mk('div', 'Nicht abgehakt: ' + task.fehlt.join(', '), { fontSize: '12px', color: '#e0a030', marginTop: '4px' }));
  }

  // Nachtragen: bei Platz-Aufgaben für die zuständige Person, bei Gemeinschaft für eine wählbare Person
  let kandidaten = [];
  if(task.typ === 'platz'){
    if(!(task.haken || []).length && task.zustaendig) kandidaten = [task.zustaendig];
  } else {
    kandidaten = (week.teilnehmer || []).map(p => p.name)
      .filter(n => !(task.haken || []).some(h => sameNameJs(h.name, n)));
  }

  if(kandidaten.length){
    const row = document.createElement('div');
    styleStatusRow(row);
    row.style.flexWrap = 'wrap';
    row.style.justifyContent = 'flex-start';
    row.appendChild(mk('span', kandidaten.length === 1 ? 'Nachtragen für ' + kandidaten[0] + ':' : 'Nachtragen:', { fontSize: '12px' }));

    let sel = null;
    if(kandidaten.length > 1){
      sel = document.createElement('select');
      kandidaten.forEach(n => {
        const o = document.createElement('option');
        o.value = n;
        o.textContent = n;
        sel.appendChild(o);
      });
      row.appendChild(sel);
    }

    const nameOf = function(){ return sel ? sel.value : kandidaten[0]; };
    const von = (getSession() || {}).name || 'Hauswart';
    const b1 = makeBtn('pünktlich', function(){
      hwAction('putznachtragen', { name: nameOf(), aufgabe: task.aufgabe, art: 'puenktlich', woche: week.start, von: von }, 'Nachgetragen');
    });
    const b2 = makeBtn('verspätet', function(){
      hwAction('putznachtragen', { name: nameOf(), aufgabe: task.aufgabe, art: 'verspaetet', woche: week.start, von: von }, 'Nachgetragen');
    });
    styleGhostBtn(b1);
    styleGhostBtn(b2);
    row.appendChild(b1);
    row.appendChild(b2);
    card.appendChild(row);
  }

  return card;
}

function appendAdminPersonen(root, w){
  root.appendChild(mkTitle('Personen diese Woche'));
  (w.teilnehmer || []).forEach(p => {
    const row = document.createElement('div');
    styleStatusRow(row);
    row.appendChild(mk('span', 'Platz ' + p.platz + ' · ' + p.name + (p.abwesend ? ' · abwesend' : ''), { fontSize: '13px' }));
    const b = p.abwesend
      ? makeBtn('zurücksetzen', function(){ hwAction('resetputzabwesend', { name: p.name, woche: w.start }, 'Abwesenheit zurückgesetzt'); })
      : makeBtn('abwesend setzen', function(){ hwAction('putzabwesendsetzen', { name: p.name }, 'Als abwesend eingetragen'); });
    styleGhostBtn(b);
    row.appendChild(b);
    root.appendChild(row);
  });
  if((w.frei || []).length){
    root.appendChild(mkInfo('Diese Woche ohne feste Aufgabe: ' + w.frei.join(', ')));
  }
}

// ---- Hauswart: Personen & Reihenfolge ----
function appendAdminEditor(root){
  root.appendChild(mkTitle('Personen & Reihenfolge'));
  root.appendChild(mkInfo('Wähle aus, wer im Putzplan ist, und lege die Reihenfolge fest. Änderungen gelten ab der nächsten Putzwoche (Mittwoch).'));
  const box = document.createElement('div');
  box.id = 'hwEditorBox';
  root.appendChild(box);
  renderHwEditor();

  root.appendChild(mkTitle('Aufgaben (im Google Sheet gepflegt)'));
  const nEin = hwPersonen.filter(p => p.eingeplant).length;
  ((hauswartConfig && hauswartConfig.aufgaben) || []).forEach(a => {
    const warn = (a.platz !== 'alle' && a.platz > nEin) ? '  ⚠ Platz gibt es bei ' + nEin + ' Personen nicht' : '';
    root.appendChild(mk('div',
      a.aufgabe + ' – ' + (a.platz === 'alle' ? 'alle' : 'Platz ' + a.platz) + (a.aktiv ? '' : ' (aus)') + warn,
      { fontSize: '13px', margin: '2px 0' }));
  });
}

function renderHwEditor(){
  const box = document.getElementById('hwEditorBox');
  if(!box) return;
  box.innerHTML = '';
  let pos = 0;
  hwPersonen.forEach((p, i) => {
    const row = document.createElement('div');
    styleStatusRow(row);

    const left = mk('label', null, { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' });
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!p.eingeplant;
    cb.addEventListener('change', function(){ p.eingeplant = cb.checked; renderHwEditor(); });
    left.appendChild(cb);
    if(p.eingeplant) pos++;
    left.appendChild(mk('span', (p.eingeplant ? pos + '. ' : '') + p.name));
    row.appendChild(left);

    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '6px';
    const up = makeBtn('↑', function(){ hwMove(i, -1); });
    const down = makeBtn('↓', function(){ hwMove(i, 1); });
    styleGhostBtn(up);
    styleGhostBtn(down);
    btns.appendChild(up);
    btns.appendChild(down);
    row.appendChild(btns);

    box.appendChild(row);
  });

  const save = makeBtn('Speichern', hwSavePersonen);
  save.style.marginTop = '10px';
  box.appendChild(save);
}

function hwMove(i, d){
  const j = i + d;
  if(j < 0 || j >= hwPersonen.length) return;
  const tmp = hwPersonen[i];
  hwPersonen[i] = hwPersonen[j];
  hwPersonen[j] = tmp;
  renderHwEditor();
}

async function hwSavePersonen(){
  const list = hwPersonen.map(p => ({ name: p.name, eingeplant: p.eingeplant ? 'ja' : 'nein' }));
  if(!list.some(p => p.eingeplant === 'ja')){
    toast('Bitte mindestens eine Person einplanen.');
    return;
  }
  if(!navigator.onLine){ toast('Offline – Speichern braucht eine Verbindung.'); return; }
  try{
    const res = await putzApi('saveputzplan', { personen: JSON.stringify(list) });
    let msg = '✓ Gespeichert – gilt ab nächster Woche';
    if(res.warnungen && res.warnungen.length) msg = '⚠️ ' + res.warnungen[0];
    toast(msg);
  }catch(e){
    toast('⚠️ ' + e.message);
  }
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
