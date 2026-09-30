// ============================================================
// extras.js  –  Erweiterungen für die Bierlogger-PWA
//  1) Breite Bildschirme: Kacheln von oben nach unten in zwei Spalten
//  2) Stand-Tab: Abrechnung und Rangliste untereinander (breit: nebeneinander)
//  3) Schnell buchen für den angemeldeten Namen (+ Rangplatz, offener Betrag)
//  4) Namenslisten alphabetisch
//  5) Putzplan-Editor: Aufgaben auf mehrere Plätze verteilen
// Wird NACH app.js und admin.js geladen. Einbau in index.html:
//   <script src="extras.js"></script>   (unter <script src="admin.js"></script>)
// ============================================================
(function(){
  const cmpDe = function(a, b){
    return String(a).localeCompare(String(b), 'de', { sensitivity: 'base' });
  };

  // ---------- 1) Layout ----------
  const css = `
/* Stand-Tab: kein Tabwechsel, kein Neu-laden-Knopf (Daten laden beim Öffnen von selbst) */
#view-stand .subtabbar{ display: none; }
#view-stand button[onclick^="loadStand"], #view-stand button[onclick^="loadRangliste"]{ display: none; }

/* Kalender: Datum größer */
.event-card .event-meta{ font-size: 14px; }
.event-card .event-meta span:first-child{ font-size: 16px; font-weight: 600; color: var(--text); }

@media (min-width: 820px){
  main{ max-width: 1100px; }
  header > *{ max-width: 1100px; margin-left: auto; margin-right: auto; }

  /* Kacheln laufen von oben nach unten und springen dann in die zweite Spalte.
     Sie müssen nicht gleich hoch sein, nur der Abstand dazwischen ist gleich. */
  #view-log, #view-admin, #kalenderListe, #hausKalenderListe, #meineZusagenListe,
  #putzplanRoot, #hauswartRoot, #adminRoot, #hwEditorBox, #admListBox{
    column-count: 2; column-gap: 14px;
  }
  #view-log > .card, #view-admin > .card, .event-card{
    break-inside: avoid;
  }
  #kalenderListe > .kal-empty, #hausKalenderListe > .kal-empty, #meineZusagenListe > .kal-empty,
  #putzplanRoot > :not(.event-card), #hauswartRoot > :not(.event-card),
  #adminRoot > :not(.event-card), #hwEditorBox > :not(.event-card), #admListBox > :not(.event-card){
    column-span: all;
  }

  /* Stand-Tab: Abrechnung und Rangliste nebeneinander */
  #view-stand{
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start;
  }
}`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  // ---------- 2) Stand-Tab: beide Ansichten sichtbar ----------
  function showBothStand(){
    const r = document.getElementById('subview-rangliste');
    const a = document.getElementById('subview-abrechnung');
    if(r) r.classList.remove('hidden');
    if(a) a.classList.remove('hidden');
  }

  window.switchStandTab = function(){
    showBothStand();
  };

  // Beim Öffnen des Stand-Tabs Daten im Hintergrund aktualisieren
  const origSwitchTab = window.switchTab;
  window.switchTab = function(tab){
    const r = origSwitchTab.apply(this, arguments);
    if(tab === 'stand'){
      try{ loadStand(true); loadRangliste(true); }catch(e){}
    }
    return r;
  };

  // ---------- 4) Namenslisten alphabetisch ----------
  function sortCfg(){
    try{
      ['haus', 'nonloci'].forEach(k => { if(Array.isArray(cfg[k])) cfg[k].sort(cmpDe); });
    }catch(e){}
  }

  const origShowNames = window.showNames;
  window.showNames = function(){
    sortCfg();
    return origShowNames.apply(this, arguments);
  };

  const origAdminLists = window.renderAdminNameLists;
  window.renderAdminNameLists = function(){
    sortCfg();
    return origAdminLists.apply(this, arguments);
  };

  // ---------- 3) Schnell buchen + Rangplatz + offener Betrag ----------
  function qbName(){
    const s = getSession();
    if(!s) return '';
    const me = String(s.name).toLowerCase();
    const all = (cfg.haus || []).concat(cfg.nonloci || []);
    return all.find(x => String(x).toLowerCase() === me) || '';
  }

  function qbRank(name){
    const txt = localStorage.getItem(RANGLISTE_CACHE_KEY) || '';
    if(!txt) return null;
    const lines = txt.split('\n');
    const start = lines.findIndex(l => l.indexOf('PERSONEN-RANGLISTE') !== -1);
    if(start < 0) return null;
    const me = String(name).toLowerCase();
    let pos = 0;
    let mine = 0;
    for(let i = start + 1; i < lines.length; i++){
      const l = lines[i];
      if(!l.trim()){ if(pos) break; continue; }
      const m = l.replace(/^[\s\u{1F947}-\u{1F949}]+/u, '').match(/^(.+?):\s*[\d.,]+\s*€/);
      if(!m) continue;
      pos++;
      if(m[1].trim().toLowerCase() === me) mine = pos;
    }
    return pos ? { rank: mine, total: pos } : null;
  }

  function qbOpen(name){
    const txt = localStorage.getItem(STAND_CACHE_KEY) || '';
    if(txt.indexOf('Gesamt offen') === -1) return null;
    const me = String(name).toLowerCase();
    const lines = txt.split('\n');
    for(let i = 0; i < lines.length; i++){
      const m = lines[i].match(/^\S+\s+(.+?):\s*([\d.,]+)\s*€\s*$/);
      if(m && m[1].trim().toLowerCase() === me) return parseFloat(m[2].replace(',', '.'));
    }
    return 0;
  }

  function qbEuro(v){
    return v.toFixed(2).replace('.', ',') + ' €';
  }

  function qbFillInfo(info, name){
    info.innerHTML = '';
    const r = qbRank(name);
    const o = qbOpen(name);
    const rankTxt = (r && r.rank) ? '🏆 Platz ' + r.rank + ' von ' + r.total : '🏆 –';
    const openTxt = (o === null) ? '💶 –' : '💶 Offen: ' + qbEuro(o);
    info.appendChild(mk('span', rankTxt, { fontSize: '20px', fontWeight: '700' }));
    info.appendChild(mk('span', openTxt, {
      fontSize: '20px', fontWeight: '700',
      color: (o && o > 0) ? '#e0a030' : 'var(--ok, #4caf50)'
    }));
  }

  async function qbBook(menge, typ){
    const name = qbName();
    if(!name) return;
    const ok = await sendAction({ name: name, menge: menge, typ: typ });
    if(ok){
      setTimeout(function(){ try{ loadStand(true); loadRangliste(true); }catch(e){} }, 1500);
    }
  }

  function qbRender(){
    const view = document.getElementById('view-log');
    if(!view) return;
    let card = document.getElementById('quickCard');
    const name = qbName();
    if(!name){
      if(card) card.remove();
      return;
    }
    if(!card){
      card = document.createElement('div');
      card.id = 'quickCard';
      card.className = 'card';
      view.insertBefore(card, view.firstChild);
    }
    card.innerHTML = '';
    card.appendChild(mk('h2', '⚡ Schnell buchen · ' + name));

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' });
    [['🍺 1', 1, 'flasche'], ['🍺 2', 2, 'flasche'], ['🍺 3', 3, 'flasche'], ['🍻 Kasten', 1, 'kasten']].forEach(b => {
      const btn = makeBtn(b[0], function(){ qbBook(b[1], b[2]); });
      btn.className = (b[2] === 'kasten') ? 'btn-accent' : 'btn-outline';
      Object.assign(btn.style, { padding: '12px 4px', fontSize: '15px' });
      row.appendChild(btn);
    });
    card.appendChild(row);

    const info = document.createElement('div');
    info.id = 'quickInfo';
    Object.assign(info.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginTop: '14px' });
    qbFillInfo(info, name);
    card.appendChild(info);
  }

  function qbRefreshInfo(){
    const info = document.getElementById('quickInfo');
    const name = qbName();
    if(info && name) qbFillInfo(info, name);
  }

  function wrapAsync(fnName, after){
    const orig = window[fnName];
    if(typeof orig !== 'function') return;
    window[fnName] = async function(){
      const r = await orig.apply(this, arguments);
      try{ after(); }catch(e){ console.error(e); }
      return r;
    };
  }
  wrapAsync('fetchConfig', qbRender);
  wrapAsync('loadStand', qbRefreshInfo);
  wrapAsync('loadRangliste', qbRefreshInfo);

  const origEnter = window.enterApp;
  window.enterApp = function(session){
    origEnter(session);
    try{ showBothStand(); qbRender(); }catch(e){ console.error('Schnell-buchen fehlgeschlagen', e); }
  };

  // ---------- 5) Putzplan-Editor: mehrere Plätze pro Aufgabe ----------
  function xPlaetze(a){
    if(Array.isArray(a.plaetze) && a.plaetze.length) return a.plaetze.slice();
    if(a.platz === 'alle') return ['alle'];
    return (a.platz >= 1) ? [a.platz] : [];
  }

  // Wirksame Plätze: ['alle'], gültige Zahlen oder [] (nicht zugeteilt)
  function xEff(a){
    if(!a.aktiv) return [];
    const p = a.plaetze || [];
    if(p.indexOf('alle') !== -1) return ['alle'];
    const n = hwCount();
    return p.filter(x => x >= 1 && x <= n);
  }

  const origBuild = window.hwBuildEditorState;
  window.hwBuildEditorState = function(){
    origBuild();
    hwAufgaben = ((hauswartConfig && hauswartConfig.aufgaben) || []).map(a => ({
      aufgabe: a.aufgabe, plaetze: xPlaetze(a), aktiv: !!a.aktiv
    }));
    const ein = hwPersonen.filter(p => p.eingeplant);
    const aus = hwPersonen.filter(p => !p.eingeplant).sort((a, b) => cmpDe(a.name, b.name));
    hwPersonen = ein.concat(aus);
  };

  window.hwToggleAssign = function(a, key){
    const eff = xEff(a);
    if(key === 'alle'){
      if(eff.indexOf('alle') !== -1){
        a.aktiv = false;
      } else {
        a.plaetze = ['alle'];
        a.aktiv = true;
      }
    } else {
      const cur = eff.filter(x => x !== 'alle');
      const i = cur.indexOf(key);
      if(i !== -1) cur.splice(i, 1); else cur.push(key);
      cur.sort((x, y) => x - y);
      a.plaetze = cur;
      a.aktiv = cur.length > 0;
    }
    hwDirty = true;
    renderHwEditor();
  };

  window.hwAddAufgabe = function(name){
    const n = String(name || '').trim();
    if(!n){ toast('Bitte einen Namen eingeben.'); return; }
    if(hwAufgaben.some(a => sameNameJs(a.aufgabe, n))){ toast('Diese Aufgabe gibt es schon.'); return; }
    hwAufgaben.push({ aufgabe: n, plaetze: [], aktiv: false });
    hwDirty = true;
    renderHwEditor();
  };

  window.renderHwEditor = function(){
    const box = document.getElementById('hwEditorBox');
    if(!box) return;
    box.innerHTML = '';

    const ein = hwPersonen.filter(p => p.eingeplant);
    const aus = hwPersonen.filter(p => !p.eingeplant).sort((a, b) => cmpDe(a.name, b.name));

    // 1) Personen
    box.appendChild(mkTitle('Im Putzplan'));
    if(!ein.length) box.appendChild(mkInfo('Noch niemand eingeplant.'));
    ein.forEach(p => {
      const row = document.createElement('div');
      styleStatusRow(row);
      row.appendChild(mk('span', p.name, { fontSize: '14px' }));
      const btns = document.createElement('div');
      Object.assign(btns.style, { display: 'flex', gap: '6px' });
      const up = makeBtn('↑', function(){ hwMoveEin(p.name, -1); });
      const down = makeBtn('↓', function(){ hwMoveEin(p.name, 1); });
      const rm = makeBtn('entfernen', function(){ hwSetEingeplant(p.name, false); });
      [up, down, rm].forEach(b => { styleGhostBtn(b); btns.appendChild(b); });
      row.appendChild(btns);
      box.appendChild(row);
    });

    box.appendChild(mkTitle('Nicht eingeplant'));
    if(!aus.length) box.appendChild(mkInfo('Alle sind eingeplant.'));
    aus.forEach(p => {
      const row = document.createElement('div');
      styleStatusRow(row);
      row.appendChild(mk('span', p.name, { fontSize: '14px', color: 'var(--muted, #aaa)' }));
      const add = makeBtn('hinzufügen', function(){ hwSetEingeplant(p.name, true); });
      styleGhostBtn(add);
      row.appendChild(add);
      box.appendChild(row);
    });

    // 2) Aufgaben pro Platz (mehrere Plätze pro Aufgabe möglich)
    box.appendChild(mkTitle('Aufgaben verteilen'));
    box.appendChild(mkInfo('Tippe bei einem Platz die Aufgaben an, die dieser Platz übernimmt. Eine Aufgabe darf mehreren Plätzen zugeteilt werden, zum Beispiel zwei Personen fürs große Bad. Dann gibt es sie für jeden dieser Plätze einmal.'));

    const n = ein.length;
    const targets = [];
    for(let k = 1; k <= n; k++) targets.push({ key: k, label: 'Platz ' + k });
    targets.push({ key: 'alle', label: 'Alle' });

    targets.forEach(t => {
      const card = document.createElement('div');
      card.className = 'event-card';
      card.appendChild(mk('div', t.label, { fontWeight: '600', fontSize: '14px' }));
      const chips = hwChipRow();
      hwAufgaben.forEach(a => {
        const active = xEff(a).indexOf(t.key) !== -1;
        chips.appendChild(hwChip(a.aufgabe, active, function(){ hwToggleAssign(a, t.key); }));
      });
      if(!hwAufgaben.length) chips.appendChild(mk('span', 'Noch keine Aufgaben.', { fontSize: '12px', color: 'var(--muted, #aaa)' }));
      card.appendChild(chips);
      box.appendChild(card);
    });

    const offen = hwAufgaben.filter(a => xEff(a).length === 0);
    const offenCard = document.createElement('div');
    offenCard.className = 'event-card';
    offenCard.appendChild(mk('div', 'Nicht zugeteilt', { fontWeight: '600', fontSize: '14px' }));
    offenCard.appendChild(mk('div', offen.length ? 'Diese Aufgaben werden nicht geputzt.' : 'Alle Aufgaben sind zugeteilt.', {
      fontSize: '12px', color: offen.length ? '#e0a030' : 'var(--muted, #aaa)', marginTop: '2px'
    }));
    const offenChips = hwChipRow();
    offen.forEach(a => {
      offenChips.appendChild(hwChip(a.aufgabe + '  ✕', false, function(){ hwDeleteAufgabe(a); }));
    });
    offenCard.appendChild(offenChips);
    box.appendChild(offenCard);

    // 3) Neue Aufgabe
    const newRow = document.createElement('div');
    styleStatusRow(newRow);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = 'Neue Aufgabe';
    Object.assign(inp.style, { flex: '1 1 auto', minWidth: '0', margin: '0' });
    const addBtn = makeBtn('Hinzufügen', function(){ hwAddAufgabe(inp.value); });
    styleGhostBtn(addBtn);
    newRow.appendChild(inp);
    newRow.appendChild(addBtn);
    box.appendChild(newRow);

    const save = makeBtn('Speichern', hwSavePlan);
    save.style.marginTop = '14px';
    box.appendChild(save);
    if(hwDirty) box.appendChild(mkInfo('Ungespeicherte Änderungen'));
  };

  window.hwSavePlan = async function(){
    const n = hwCount();
    if(!n){ toast('Bitte mindestens eine Person einplanen.'); return; }
    if(!navigator.onLine){ toast('Offline – Speichern braucht eine Verbindung.'); return; }

    const offen = hwAufgaben.filter(a => xEff(a).length === 0);
    if(offen.length){
      const namen = offen.map(a => a.aufgabe).join(', ');
      if(!confirm('Diese Aufgaben sind keinem Platz zugeteilt und werden nicht geputzt: ' + namen + '. Trotzdem speichern?')) return;
    }

    // Eingeplante Personen zuerst (in ihrer Reihenfolge), danach die übrigen
    const personen = hwPersonen.filter(p => p.eingeplant).concat(hwPersonen.filter(p => !p.eingeplant))
      .map(p => ({ name: p.name, eingeplant: p.eingeplant ? 'ja' : 'nein' }));

    // Mehrere Plätze werden als "1+2" gespeichert
    const aufgaben = hwAufgaben.map(a => {
      const eff = xEff(a);
      let platz;
      if(eff.length){
        platz = eff.join('+');
      } else {
        const alt = (a.plaetze || []).filter(x => x === 'alle' || x >= 1);
        platz = alt.length ? alt.join('+') : 'alle';
      }
      return { aufgabe: a.aufgabe, platz: platz, aktiv: eff.length ? 'ja' : 'nein' };
    });

    try{
      const res = await putzApi('saveputzplan', { personen: JSON.stringify(personen), aufgaben: JSON.stringify(aufgaben) });
      hwDirty = false;
      toast(res.warnungen && res.warnungen.length ? '⚠️ ' + res.warnungen[0] : '✓ Gespeichert – gilt ab nächster Woche');
      loadHauswartPanel();
    }catch(e){
      toast('⚠️ ' + e.message);
    }
  };

  // Falls schon jemand angemeldet ist (app.js läuft vor diesem Script)
  try{ showBothStand(); qbRender(); }catch(e){}
})();
