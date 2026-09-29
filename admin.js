// ============================================================
// admin.js  –  Erweiterung für die Bierlogger-PWA
//  1) Neuer Admin-Tab in der unteren Leiste (nur Rolle "admin")
//     Einstellungen, Namenslisten, Personen (Rollen, Passwort zurücksetzen)
//  2) Hauswart-Tab: Karte "Putzplan-Start"
//  3) Beschriftungen: Getränke "Admin" -> "👷 Kassenwart", Tab "👷 Hauswart"
// Wird NACH app.js geladen und hängt sich in vorhandene Funktionen ein.
// Einbau: in index.html direkt unter dem app.js-Script-Tag:
//   <script src="admin.js"></script>
// ============================================================
(function(){
  const ADM_CACHE_KEY = 'bier_admin_cache';
  const ADM_LABELS = { haus: 'Haus', nonloci: 'Non Loci', philister: 'Philister' };
  const ADM_FIELDS = [
    ['preisFlasche', 'Preis pro Flasche (€)'],
    ['preisKasten', 'Preis pro Kasten (€)'],
    ['aufschlagProzent', 'Aufschlag (%)'],
    ['schuldenGrenze', 'Schuldengrenze (€)'],
    ['flaschenProKasten', 'Flaschen pro Kasten'],
    ['email', 'E-Mail-Empfänger (mehrere mit Komma trennen)']
  ];

  let admData = null;                                   // letzte Antwort von admin_getconfig
  let admS = {};                                        // Einstellungen (Textfelder)
  let admL = { haus: [], nonloci: [], philister: [] };  // Namenslisten (Bearbeitungsstand)
  let admDirtyS = false;
  let admDirtyL = false;
  let admLoading = false;

  // ---------- Hilfen ----------
  function admReadCache(){
    try{
      const raw = localStorage.getItem(ADM_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }

  function admWriteCache(d){
    try{ localStorage.setItem(ADM_CACHE_KEY, JSON.stringify(d)); }catch(e){}
  }

  // Aufruf des Bierscripts mit Name + Passwort (Server prüft die Admin-Rolle)
  async function admApi(action, params){
    const s = getSession();
    if(!s) throw new Error('Nicht angemeldet.');
    const url = new URL(SCRIPT_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('name', s.name);
    url.searchParams.set('pw', s.pw);
    Object.keys(params || {}).forEach(k => {
      if(params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
    });
    url.searchParams.set('key', API_KEY);
    const res = await fetchWithTimeout(url.toString(), 20000);
    const text = await res.text();
    let data;
    try{
      data = JSON.parse(text);
    }catch(e){
      throw new Error('Antwort nicht lesbar – Bierscript-Erweiterung eingebaut und neu deployt?');
    }
    if(!data.ok){
      throw new Error(data.error === 'nicht_berechtigt' ? 'Nicht berechtigt (Admin-Rolle nötig).' : (data.error || 'Fehler'));
    }
    return data;
  }

  function admNumText(v){
    return (v === undefined || v === null) ? '' : String(v).replace('.', ',');
  }

  function admNum(v){
    return parseFloat(String(v).replace(',', '.'));
  }

  function admBuildS(){
    const s = (admData && admData.settings) || {};
    admS = {
      preisFlasche: admNumText(s.preisFlasche),
      preisKasten: admNumText(s.preisKasten),
      aufschlagProzent: admNumText(s.aufschlagProzent),
      schuldenGrenze: admNumText(s.schuldenGrenze),
      flaschenProKasten: admNumText(s.flaschenProKasten),
      email: s.email || ''
    };
    admDirtyS = false;
  }

  function admBuildL(){
    const l = (admData && admData.listen) || {};
    admL = {
      haus: (l.haus || []).slice(),
      nonloci: (l.nonloci || []).slice(),
      philister: (l.philister || []).slice()
    };
    admDirtyL = false;
  }

  function admCanRerender(){
    if(admDirtyS || admDirtyL) return false;
    const a = document.activeElement;
    return !(a && (a.tagName === 'INPUT' || a.tagName === 'SELECT'));
  }

  // ---------- Laden (erst Cache, dann Hintergrund) ----------
  async function admLoad(){
    const root = document.getElementById('adminRoot');
    if(!root) return;

    if(!admData){
      const c = admReadCache();
      if(c){ admData = c; admBuildS(); admBuildL(); }
    }
    if(admData){
      if(admCanRerender() || !root.firstChild) admRender();
    } else if(!root.firstChild){
      root.appendChild(mkInfo('⏳ Lade …'));
    }

    if(!navigator.onLine) return;
    if(admLoading) return;
    admLoading = true;
    try{
      const data = await admApi('admin_getconfig', {});
      admData = data;
      admWriteCache(data);
      if(!admDirtyS) admBuildS();
      if(!admDirtyL) admBuildL();
      if(admCanRerender()) admRender();
    }catch(e){
      if(!admData){
        root.innerHTML = '';
        root.appendChild(mkInfo('⚠️ ' + e.message));
      }
    } finally {
      admLoading = false;
    }
  }

  // ---------- Darstellung ----------
  function admRender(){
    const root = document.getElementById('adminRoot');
    if(!root || !admData) return;
    root.innerHTML = '';

    root.appendChild(mkTitle('⚙️ Einstellungen'));
    root.appendChild(mkInfo('Preise, Aufschlag, Schuldengrenze und Empfänger der Abrechnungs-Mails.'));
    ADM_FIELDS.forEach(f => {
      const wrap = document.createElement('div');
      wrap.style.margin = '8px 0';
      wrap.appendChild(mk('div', f[1], { fontSize: '12px', color: 'var(--muted, #aaa)', marginBottom: '2px' }));
      const inp = document.createElement('input');
      inp.type = 'text';
      if(f[0] !== 'email') inp.setAttribute('inputmode', 'decimal');
      inp.value = admS[f[0]] === undefined ? '' : admS[f[0]];
      Object.assign(inp.style, { width: '100%', boxSizing: 'border-box', margin: '0' });
      inp.addEventListener('input', function(){ admS[f[0]] = inp.value; admDirtyS = true; });
      wrap.appendChild(inp);
      root.appendChild(wrap);
    });
    const saveS = makeBtn('Einstellungen speichern', admSaveSettings);
    saveS.style.marginTop = '8px';
    root.appendChild(saveS);

    root.appendChild(mkTitle('📋 Namenslisten'));
    root.appendChild(mkInfo('Wer hier steht, kann sich anmelden und wird abgerechnet. Bereits gebuchte Daten bleiben beim Entfernen erhalten.'));
    const listBox = document.createElement('div');
    listBox.id = 'admListBox';
    root.appendChild(listBox);
    admRenderLists();

    root.appendChild(mkTitle('👥 Personen'));
    root.appendChild(mkInfo('Rolle ändern und Passwort zurücksetzen. Eine neue Rolle gilt, sobald die Person sich neu anmeldet.'));
    admAppendPersonen(root);
  }

  async function admSaveSettings(){
    const alt = (admData && admData.settings) || {};
    const preisGeaendert = admNum(admS.preisFlasche) !== alt.preisFlasche || admNum(admS.preisKasten) !== alt.preisKasten;
    if(preisGeaendert && !confirm('Achtung: Eine Preisänderung wirkt auch auf bereits erstellte Abrechnungen, weil deren Formeln den aktuellen Preis lesen. Trotzdem speichern?')) return;
    if(!navigator.onLine){ toast('Offline – Speichern braucht eine Verbindung.'); return; }
    try{
      await admApi('admin_saveconfig', { settings: JSON.stringify(admS) });
      admDirtyS = false;
      toast('✓ Einstellungen gespeichert');
      admLoad();
    }catch(e){
      toast('⚠️ ' + e.message);
    }
  }

  function admAllNames(){
    return admL.haus.concat(admL.nonloci, admL.philister).map(n => String(n).toLowerCase());
  }

  function admRenderLists(){
    const box = document.getElementById('admListBox');
    if(!box) return;
    box.innerHTML = '';

    Object.keys(ADM_LABELS).forEach(key => {
      const card = document.createElement('div');
      card.className = 'event-card';
      card.appendChild(mk('div', ADM_LABELS[key], { fontWeight: '600', fontSize: '14px' }));

      admL[key].forEach((name, i) => {
        const row = document.createElement('div');
        styleStatusRow(row);
        row.appendChild(mk('span', name, { fontSize: '14px' }));
        const rm = makeBtn('entfernen', function(){
          admL[key].splice(i, 1);
          admDirtyL = true;
          admRenderLists();
        });
        styleGhostBtn(rm);
        row.appendChild(rm);
        card.appendChild(row);
      });

      const addRow = document.createElement('div');
      styleStatusRow(addRow);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = 'Neuer Name';
      Object.assign(inp.style, { flex: '1 1 auto', minWidth: '0', margin: '0' });
      const add = makeBtn('Hinzufügen', function(){
        const n = inp.value.trim();
        if(!n){ toast('Bitte einen Namen eingeben.'); return; }
        if(admAllNames().indexOf(n.toLowerCase()) !== -1){ toast('Diesen Namen gibt es schon.'); return; }
        admL[key].push(n);
        admDirtyL = true;
        admRenderLists();
      });
      styleGhostBtn(add);
      addRow.appendChild(inp);
      addRow.appendChild(add);
      card.appendChild(addRow);

      box.appendChild(card);
    });

    const save = makeBtn('Namenslisten speichern', admSaveLists);
    save.style.marginTop = '8px';
    box.appendChild(save);
    if(admDirtyL) box.appendChild(mkInfo('Ungespeicherte Änderungen'));
  }

  async function admSaveLists(){
    if(!admL.haus.length){ toast('Die Liste Haus darf nicht leer sein.'); return; }
    if(!admL.nonloci.length){ toast('Die Liste Non Loci darf nicht leer sein.'); return; }
    if(!navigator.onLine){ toast('Offline – Speichern braucht eine Verbindung.'); return; }

    const alt = (admData && admData.listen) || {};
    const neu = admAllNames();
    const entfernt = (alt.haus || []).concat(alt.nonloci || [], alt.philister || [])
      .filter(n => neu.indexOf(String(n).toLowerCase()) === -1);
    if(entfernt.length && !confirm('Diese Personen werden entfernt und können sich danach nicht mehr anmelden: ' + entfernt.join(', ') + '. Fortfahren?')) return;

    try{
      await admApi('admin_saveconfig', { listen: JSON.stringify(admL) });
      admDirtyL = false;
      toast('✓ Namenslisten gespeichert');
      admLoad();
    }catch(e){
      toast('⚠️ ' + e.message);
    }
  }

  function admAppendPersonen(root){
    const list = admData.personen || [];
    if(!list.length){
      root.appendChild(mkInfo('Keine Personen gefunden.'));
      return;
    }
    list.forEach(p => {
      const card = document.createElement('div');
      card.className = 'event-card';

      const head = document.createElement('div');
      styleStatusRow(head);
      head.style.marginTop = '0';
      const left = document.createElement('div');
      left.appendChild(mk('div', p.name, { fontWeight: '600', fontSize: '15px' }));
      left.appendChild(mk('div', (ADM_LABELS[p.gruppe] || '') + (p.konto ? '' : ' · noch nie angemeldet'), { fontSize: '12px', color: 'var(--muted, #aaa)' }));
      head.appendChild(left);

      const sel = document.createElement('select');
      (admData.rollen || []).forEach(r => {
        const o = document.createElement('option');
        o.value = r;
        o.textContent = r;
        sel.appendChild(o);
      });
      sel.value = p.rolle;
      sel.disabled = !p.konto;
      sel.addEventListener('change', function(){ admSetRole(p, sel); });
      head.appendChild(sel);
      card.appendChild(head);

      const row = document.createElement('div');
      Object.assign(row.style, { marginTop: '8px' });
      const reset = makeBtn('Passwort zurücksetzen', function(){ admResetPw(p); });
      styleGhostBtn(reset);
      reset.disabled = !p.konto;
      row.appendChild(reset);
      card.appendChild(row);

      root.appendChild(card);
    });
  }

  async function admSetRole(p, sel){
    const neu = sel.value;
    const alt = p.rolle;
    if(neu === alt) return;
    if(!confirm(p.name + ' bekommt die Rolle „' + neu + '“?')){ sel.value = alt; return; }
    try{
      await admApi('admin_setrole', { ziel: p.name, rolle: neu });
      p.rolle = neu;
      admWriteCache(admData);
      toast('✓ Rolle geändert – gilt nach dem nächsten Login');
    }catch(e){
      sel.value = alt;
      toast('⚠️ ' + e.message);
    }
  }

  async function admResetPw(p){
    const me = getSession();
    if(me && String(me.name).toLowerCase() === String(p.name).toLowerCase()){
      toast('Das eigene Passwort kann hier nicht zurückgesetzt werden.');
      return;
    }
    if(!confirm('Passwort von ' + p.name + ' zurücksetzen? Das nächste Passwort beim Login wird das neue.')) return;
    try{
      await admApi('admin_resetpw', { ziel: p.name });
      p.hatPasswort = false;
      admWriteCache(admData);
      toast('✓ Zurückgesetzt');
    }catch(e){
      toast('⚠️ ' + e.message);
    }
  }

  // ---------- Admin-Tab in der unteren Leiste ----------
  function admHide(){
    const v = document.getElementById('bereich-admin');
    if(v) v.classList.add('hidden');
    const nb = document.getElementById('nav-admin');
    if(nb) nb.className = '';
  }

  function admCreateUi(){
    const navHaus = document.getElementById('nav-haus');
    const bereichHaus = document.getElementById('bereich-haus');
    const bottom = document.getElementById('bottomNav');
    if(!navHaus || !bereichHaus || !bottom) return false;

    const btn = navHaus.cloneNode(true);
    btn.id = 'nav-admin';
    btn.removeAttribute('onclick');
    btn.className = '';
    btn.style.display = '';
    btn.textContent = '⚙️ Admin';
    btn.addEventListener('click', function(){ window.switchBereich('admin'); });
    navHaus.parentNode.insertBefore(btn, navHaus.nextSibling);
    if(window.getComputedStyle(bottom).display === 'grid'){
      bottom.style.gridTemplateColumns = 'repeat(auto-fit, minmax(0, 1fr))';
    }

    const view = document.createElement('div');
    view.id = 'bereich-admin';
    view.className = bereichHaus.className;
    view.classList.add('hidden');
    const root = document.createElement('div');
    root.id = 'adminRoot';
    view.appendChild(root);
    bereichHaus.parentNode.insertBefore(view, bereichHaus.nextSibling);
    return true;
  }

  function admSetup(session){
    // Beschriftungen
    const ta = document.getElementById('tab-admin');
    if(ta) ta.textContent = '👷 Kassenwart';
    const th = document.getElementById('haustab-hauswart');
    if(th) th.textContent = '👷 Hauswart';

    if(!session || session.rolle !== 'admin') return;
    if(document.getElementById('nav-admin')) return;
    if(!admCreateUi()) return;

    // zuletzt geöffneten Tab wiederherstellen
    try{
      const nav = (typeof readNav === 'function') ? readNav() : null;
      if(nav && nav.bereich === 'admin') window.switchBereich('admin');
    }catch(e){}
  }

  // ---------- Einhängen in vorhandene Funktionen ----------
  const origSwitch = window.switchBereich;
  window.switchBereich = function(b){
    if(b !== 'admin'){
      origSwitch(b);
      admHide();
      return;
    }
    if(!document.getElementById('bereich-admin')) return;
    aktuellerBereich = 'admin';
    ['getraenke', 'kalender', 'haus'].forEach(x => {
      const v = document.getElementById('bereich-' + x);
      if(v) v.classList.add('hidden');
      const nb = document.getElementById('nav-' + x);
      if(nb) nb.className = '';
      const h = document.getElementById(x + '-header');
      if(h) h.classList.add('hidden');
    });
    document.getElementById('bereich-admin').classList.remove('hidden');
    const na = document.getElementById('nav-admin');
    if(na) na.className = 'active-getraenke';
    const t = document.getElementById('appTitle');
    if(t) t.textContent = '⚙️ Admin';
    if(typeof saveNav === 'function') saveNav({ bereich: 'admin' });
    admLoad();
  };

  const origEnter = window.enterApp;
  window.enterApp = function(session){
    origEnter(session);
    try{ admSetup(session); }catch(e){ console.error('Admin-Setup fehlgeschlagen', e); }
  };

  // Wischen: Admin als letzte Seite anhängen
  if(typeof window.swipePages === 'function'){
    const origPages = window.swipePages;
    window.swipePages = function(){
      const p = origPages();
      if(document.getElementById('nav-admin')) p.push({ b: 'admin', s: 'admin' });
      return p;
    };
    const origIdx = window.swipeCurrentIndex;
    window.swipeCurrentIndex = function(pages){
      if(aktuellerBereich === 'admin') return pages.findIndex(x => x.b === 'admin');
      return origIdx(pages);
    };
    const origShow = window.swipeShow;
    window.swipeShow = function(page){
      if(page.b === 'admin'){
        window.switchBereich('admin');
        window.scrollTo(0, 0);
        return;
      }
      origShow(page);
    };
  }

  // Hauswart-Tab: Karte "Putzplan-Start"
  const origRenderHw = window.renderHauswartPanel;
  if(typeof origRenderHw === 'function'){
    window.renderHauswartPanel = function(){
      origRenderHw();
      try{ admAppendStartCard(); }catch(e){ console.error(e); }
    };
  }

  function admAppendStartCard(){
    const box = document.getElementById('hwEditorBox');
    if(!box || document.getElementById('admStartCard')) return;
    const cur = (typeof hauswartConfig !== 'undefined' && hauswartConfig && hauswartConfig.start) || '';

    const card = document.createElement('div');
    card.id = 'admStartCard';
    card.className = 'event-card';
    card.appendChild(mk('div', 'Putzplan-Start', { fontWeight: '600', fontSize: '14px' }));
    card.appendChild(mk('div',
      'Mittwoch, ab dem die Rotation zählt. In dieser Woche hat die erste Person unter „Im Putzplan“ Platz 1, danach rückt jede Woche alles einen Platz weiter. Bereits angelegte Wochen bleiben unverändert.',
      { fontSize: '12px', color: 'var(--muted, #aaa)', margin: '2px 0 8px' }));

    const row = document.createElement('div');
    styleStatusRow(row);
    const inp = document.createElement('input');
    inp.type = 'date';
    inp.value = cur;
    Object.assign(inp.style, { flex: '1 1 auto', minWidth: '0', margin: '0' });
    const save = makeBtn('Speichern', function(){ admSaveStart(inp.value); });
    styleGhostBtn(save);
    row.appendChild(inp);
    row.appendChild(save);
    card.appendChild(row);

    box.parentNode.insertBefore(card, box);
  }

  async function admSaveStart(v){
    if(!v){ toast('Bitte ein Datum wählen.'); return; }
    if(new Date(v + 'T00:00:00Z').getUTCDay() !== 3){ toast('Bitte einen Mittwoch wählen.'); return; }
    if(!navigator.onLine){ toast('Offline – Speichern braucht eine Verbindung.'); return; }
    if(!confirm('Start-Mittwoch auf ' + v + ' setzen? Kommende Wochen werden danach neu rotiert.')) return;
    try{
      await putzApi('saveputzstart', { start: v });
      toast('✓ Start gespeichert');
      loadHauswartPanel();
    }catch(e){
      toast('⚠️ ' + e.message);
    }
  }

  // Falls schon jemand angemeldet ist (app.js läuft vor diesem Script)
  try{
    const s = (typeof getSession === 'function') ? getSession() : null;
    if(s) admSetup(s);
  }catch(e){ console.error('Admin-Setup fehlgeschlagen', e); }
})();
