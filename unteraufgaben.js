// ============================================================
// unteraufgaben.js  –  Teilaufgaben im Putzplan
//  - Mitglieder: Aufgabenkarte mit Checkliste der Teilaufgaben
//      * Platz-Aufgabe: erst alle Teile abhaken, dann die Gesamtaufgabe
//      * Gruppenaufgabe ("alle"): jeder kann Teile abhaken, sind alle Teile
//        erledigt, wird die Gesamtaufgabe automatisch abgehakt
//  - Hauswart: Teilaufgaben je Aufgabe im Editor pflegen, in der Wochenansicht
//    einzelne Teil-Haken entfernen
// Braucht die neue server.js. Wird NACH app.js, admin.js, extras.js und
// putzfrist.js geladen. Einbau in index.html:
//   <script src="unteraufgaben.js"></script>   (unter <script src="putzfrist.js"></script>)
// Außerdem "./unteraufgaben.js" in die ASSETS-Liste der sw.js aufnehmen.
// ============================================================
(function(){

  function unterFertig(t){
    const u = t.unter || [];
    return u.length > 0 && u.every(x => x.von);
  }

  // ---------- Mitglieder: Aufgabenkarte ----------
  async function toggleUnter(task, u, set){
    const session = getSession();
    if(!session){ toast('Bitte erst anmelden.'); return; }
    if(!navigator.onLine){ toast('Offline – Abhaken braucht eine Verbindung.'); return; }

    const before = JSON.stringify(putzData);
    const t = ((putzData && putzData.woche && putzData.woche.aufgaben) || []).find(x => sameNameJs(x.aufgabe, task.aufgabe));
    const lu = t && (t.unter || []).find(x => sameNameJs(x.name, u.name));
    if(lu){
      lu.von = set ? session.name : '';
      lu.puenktlich = !!(putzData.jetzt && putzData.jetzt.phase === 'punktlich');
    }
    writePutzCache(putzData);
    renderPutzplan();

    try{
      await putzApi(set ? 'setputzunter' : 'removeputzunter', { name: session.name, aufgabe: task.aufgabe, unter: u.name });
      await loadPutzplan();   // holt auch automatisch gesetzte Gesamthaken
    }catch(e){
      putzData = JSON.parse(before);
      writePutzCache(putzData);
      renderPutzplan();
      toast('⚠️ ' + e.message);
    }
  }

  function checkBox(checked, enabled, size){
    const b = document.createElement('button');
    b.textContent = checked ? '✓' : '';
    Object.assign(b.style, {
      flex: '0 0 ' + size + 'px', width: size + 'px', height: size + 'px', margin: '0', padding: '0',
      fontSize: Math.round(size / 2) + 'px', lineHeight: '1', borderRadius: '8px',
      cursor: enabled ? 'pointer' : 'default', opacity: enabled ? '1' : '0.5',
      border: '1px solid ' + (checked ? 'var(--ok, #4caf50)' : 'var(--muted, #888)'),
      background: checked ? 'var(--ok, #4caf50)' : 'transparent',
      color: checked ? '#fff' : 'var(--muted, #aaa)'
    });
    b.disabled = !enabled;
    return b;
  }

  const origRow = window.buildPutzRow;
  window.buildPutzRow = function(task, me, canAct){
    const unter = task.unter || [];
    if(!unter.length) return origRow(task, me, canAct);

    const platz = task.typ === 'platz';
    const mein = (task.haken || []).find(h => sameNameJs(h.name, me));
    const fertig = unterFertig(task);
    const done = unter.filter(u => u.von).length;

    const card = document.createElement('div');
    card.className = 'event-card';

    // Kopf: Name + Status, bei Platz-Aufgaben rechts der Gesamthaken
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' });
    const left = document.createElement('div');
    Object.assign(left.style, { flex: '1 1 auto', minWidth: '0' });
    left.appendChild(mk('div', task.aufgabe, { fontWeight: '600', fontSize: '15px' }));

    let sub, color;
    if(platz){
      if(mein){
        sub = mein.puenktlich ? 'Erledigt' : 'Verspätet erledigt';
        if(mein.nachgetragen) sub += ' · nachgetragen';
        color = mein.puenktlich ? 'var(--ok, #4caf50)' : '#e0a030';
      } else {
        sub = done + ' von ' + unter.length + ' Teilen' + (fertig ? ' – jetzt die Gesamtaufgabe abhaken' : '');
        color = fertig ? 'var(--ok, #4caf50)' : 'var(--muted, #aaa)';
      }
    } else {
      sub = (task.urspruenglich ? 'Eigentlich ' + task.urspruenglich + ' · ' : '') +
        (fertig ? 'Erledigt (alle Teile)' : done + ' von ' + unter.length + ' Teilen');
      if(!fertig && (task.haken || []).length) sub += ' · ' + task.haken.length + ' Haken';
      color = fertig ? 'var(--ok, #4caf50)' : 'var(--muted, #aaa)';
    }
    left.appendChild(mk('div', sub, { fontSize: '12px', color: color, marginTop: '2px' }));
    head.appendChild(left);

    if(platz){
      const box = checkBox(!!mein, canAct && (!!mein || fertig), 44);
      box.style.fontSize = '22px';
      box.addEventListener('click', function(e){ e.stopPropagation(); putzToggleHaken(task.aufgabe, !mein); });
      head.appendChild(box);
    }
    card.appendChild(head);

    // Checkliste
    const list = document.createElement('div');
    Object.assign(list.style, { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' });
    unter.forEach(u => {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '10px' });
      const erledigt = !!u.von;
      const meins = erledigt && sameNameJs(u.von, me);
      const kannKlicken = canAct && (!erledigt || meins);
      const b = checkBox(erledigt, kannKlicken, 32);
      b.addEventListener('click', function(e){ e.stopPropagation(); toggleUnter(task, u, !erledigt); });
      row.appendChild(b);

      const txt = document.createElement('div');
      Object.assign(txt.style, { flex: '1 1 auto', minWidth: '0', fontSize: '14px' });
      txt.appendChild(mk('span', u.name, { textDecoration: erledigt ? 'line-through' : 'none', color: erledigt ? 'var(--muted, #aaa)' : 'inherit' }));
      if(erledigt && !meins) txt.appendChild(mk('span', '  ' + u.von, { fontSize: '11px', color: 'var(--muted, #aaa)' }));
      if(erledigt && !u.puenktlich) txt.appendChild(mk('span', '  verspätet', { fontSize: '11px', color: '#e0a030' }));
      row.appendChild(txt);
      list.appendChild(row);
    });
    card.appendChild(list);

    if(!platz && !fertig){
      card.appendChild(mk('div', 'Sind alle Teile abgehakt, ist die Aufgabe für alle Helfer automatisch erledigt.', {
        fontSize: '11px', color: 'var(--muted, #aaa)', marginTop: '8px'
      }));
    }
    return card;
  };

  // ---------- Hauswart: Wochenansicht (Teil-Haken entfernen) ----------
  const origAdminCard = window.buildAdminTaskCard;
  window.buildAdminTaskCard = function(task, week){
    const card = origAdminCard(task, week);
    const unter = task.unter || [];
    if(!unter.length) return card;

    card.appendChild(mk('div', 'Teilaufgaben', { fontSize: '12px', fontWeight: '600', marginTop: '8px' }));
    unter.forEach(u => {
      const row = document.createElement('div');
      styleStatusRow(row);
      row.style.marginTop = '4px';
      row.appendChild(mk('span', (u.von ? '✓ ' : '○ ') + u.name + (u.von ? ' · ' + u.von + (u.puenktlich ? '' : ' · verspätet') : ''), {
        fontSize: '12px', color: u.von ? 'inherit' : 'var(--muted, #aaa)'
      }));
      if(u.von){
        const rm = makeBtn('entfernen', function(){
          hwAction('putzunterentfernen', { name: u.von, aufgabe: task.aufgabe, unter: u.name, woche: week.start }, 'Teil-Haken entfernt');
        });
        styleGhostBtn(rm);
        row.appendChild(rm);
      }
      card.appendChild(row);
    });
    return card;
  };

  // ---------- Hauswart: Editor ----------
  const origBuildState = window.hwBuildEditorState;
  window.hwBuildEditorState = function(){
    origBuildState.apply(this, arguments);
    const conf = (hauswartConfig && hauswartConfig.aufgaben) || [];
    hwAufgaben.forEach(a => {
      const c = conf.find(x => sameNameJs(x.aufgabe, a.aufgabe));
      a.unter = (c && Array.isArray(c.unter)) ? c.unter.slice() : (a.unter || []);
    });
  };

  const origRenderEditor = window.renderHwEditor;
  window.renderHwEditor = function(){
    origRenderEditor.apply(this, arguments);
    const box = document.getElementById('hwEditorBox');
    if(!box) return;

    const card = document.createElement('div');
    card.className = 'event-card';
    card.appendChild(mk('div', 'Teilaufgaben', { fontWeight: '600', fontSize: '14px' }));
    card.appendChild(mk('div',
      'Optional: eine Aufgabe in Teile aufteilen. Bei Platz-Aufgaben erst alle Teile, dann die Gesamtaufgabe abhaken. Bei Aufgaben für Alle wird die Gesamtaufgabe automatisch erledigt, sobald alle Teile abgehakt sind. Gilt ab der nächsten Putzwoche.',
      { fontSize: '12px', color: 'var(--muted, #aaa)', margin: '2px 0 4px' }));

    hwAufgaben.forEach(a => {
      if(!a.unter) a.unter = [];
      const wrap = document.createElement('div');
      wrap.style.marginTop = '12px';
      wrap.appendChild(mk('div', a.aufgabe, { fontSize: '13px', fontWeight: '600' }));

      const chips = hwChipRow();
      a.unter.forEach(u => {
        chips.appendChild(hwChip(u + '  ✕', false, function(){
          a.unter = a.unter.filter(x => x !== u);
          hwDirty = true;
          window.renderHwEditor();
        }));
      });
      if(!a.unter.length) chips.appendChild(mk('span', 'Keine Teile (Aufgabe wird als Ganzes abgehakt).', { fontSize: '12px', color: 'var(--muted, #aaa)' }));
      wrap.appendChild(chips);

      const row = document.createElement('div');
      styleStatusRow(row);
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = 'Neue Teilaufgabe';
      Object.assign(inp.style, { flex: '1 1 auto', minWidth: '0', margin: '0' });
      const add = makeBtn('Hinzufügen', function(){
        const n = inp.value.trim();
        if(!n){ toast('Bitte einen Namen eingeben.'); return; }
        if(a.unter.some(x => sameNameJs(x, n))){ toast('Diese Teilaufgabe gibt es schon.'); return; }
        a.unter.push(n);
        hwDirty = true;
        window.renderHwEditor();
      });
      styleGhostBtn(add);
      row.appendChild(inp);
      row.appendChild(add);
      wrap.appendChild(row);
      card.appendChild(wrap);
    });

    // vor dem Speichern-Knopf einfügen
    let saveBtn = null;
    Array.prototype.forEach.call(box.children, function(c){
      if(c.tagName === 'BUTTON' && c.textContent === 'Speichern') saveBtn = c;
    });
    if(saveBtn) box.insertBefore(card, saveBtn); else box.appendChild(card);
  };

  // Speichern inklusive Teilaufgaben (Plätze wie in extras.js, mehrere mit + getrennt)
  window.hwSavePlan = async function(){
    const n = hwCount();
    if(!n){ toast('Bitte mindestens eine Person einplanen.'); return; }
    if(!navigator.onLine){ toast('Offline – Speichern braucht eine Verbindung.'); return; }

    const eff = function(a){
      if(!a.aktiv) return [];
      const p = a.plaetze || [];
      if(p.indexOf('alle') !== -1) return ['alle'];
      return p.filter(x => x >= 1 && x <= n);
    };

    const offen = hwAufgaben.filter(a => eff(a).length === 0);
    if(offen.length){
      const namen = offen.map(a => a.aufgabe).join(', ');
      if(!confirm('Diese Aufgaben sind keinem Platz zugeteilt und werden nicht geputzt: ' + namen + '. Trotzdem speichern?')) return;
    }

    const personen = hwPersonen.filter(p => p.eingeplant).concat(hwPersonen.filter(p => !p.eingeplant))
      .map(p => ({ name: p.name, eingeplant: p.eingeplant ? 'ja' : 'nein' }));

    const aufgaben = hwAufgaben.map(a => {
      const e = eff(a);
      let platz;
      if(e.length){
        platz = e.join('+');
      } else {
        const alt = (a.plaetze || []).filter(x => x === 'alle' || x >= 1);
        platz = alt.length ? alt.join('+') : 'alle';
      }
      return { aufgabe: a.aufgabe, platz: platz, aktiv: e.length ? 'ja' : 'nein', unter: a.unter || [] };
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

  // Falls der Hauswart-Editor schon gezeichnet wurde, bevor dieses Script lief
  try{
    if(typeof hwStateReady !== 'undefined' && hwStateReady && document.getElementById('hwEditorBox')) window.renderHwEditor();
  }catch(e){}
})();
