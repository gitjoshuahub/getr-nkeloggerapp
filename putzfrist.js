// ============================================================
// putzfrist.js  –  Putzplan: Wochenbeginn und Frist statt Rotations-Start
//  - Hinweistexte nennen den echten Fristtag (nicht mehr fest "Freitag/Sonntag")
//  - Hauswart-Tab: die Karte "Putzplan-Start" wird durch die Karte
//    "Zeitrahmen" ersetzt (Woche beginnt am ..., Frist bis Ende von ...)
// Braucht die Haus-Script-Änderung "haus_script_frist.js".
// Wird NACH app.js und admin.js geladen. Einbau in index.html:
//   <script src="putzfrist.js"></script>   (unter <script src="admin.js"></script>)
// ============================================================
(function(){
  const TAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  // Auswahl in der Reihenfolge Montag bis Sonntag, Werte wie im Script (1 = Mo ... 7 = So)
  const OPTIONEN = [[1, 'Montag'], [2, 'Dienstag'], [3, 'Mittwoch'], [4, 'Donnerstag'], [5, 'Freitag'], [6, 'Samstag'], [7, 'Sonntag']];

  function wtag(key){
    const p = String(key || '').split('-');
    if(p.length !== 3) return '';
    return TAGE[new Date(Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10))).getUTCDay()];
  }

  // Hinweistext über dem Putzplan
  window.putzPhaseText = function(jetzt, w){
    const frist = wtag(w.punktlich_bis) + ', ' + fmtDay(w.punktlich_bis);
    if(jetzt.phase === 'punktlich'){
      return 'Abhaken ist bis ' + frist + ' (abends) pünktlich. Danach zählt es als verspätet.';
    }
    if(jetzt.phase === 'verspaetet'){
      return 'Achtung: Die Frist (' + frist + ') ist vorbei. Abhaken zählt jetzt als verspätet, möglich bis ' +
        wtag(w.verspaetet_bis) + ', ' + fmtDay(w.verspaetet_bis);
    }
    return 'Diese Woche ist abgeschlossen. Nachträge macht der Hauswart.';
  };

  function auswahl(current){
    const sel = document.createElement('select');
    Object.assign(sel.style, { flex: '1 1 auto', minWidth: '0', margin: '0' });
    OPTIONEN.forEach(o => {
      const opt = document.createElement('option');
      opt.value = String(o[0]);
      opt.textContent = o[1];
      sel.appendChild(opt);
    });
    sel.value = String(current);
    return sel;
  }

  function zeile(label, sel){
    const row = document.createElement('div');
    styleStatusRow(row);
    row.appendChild(mk('span', label, { fontSize: '14px', flex: '0 0 auto' }));
    row.appendChild(sel);
    return row;
  }

  function fristKarte(){
    const box = document.getElementById('hwEditorBox');
    if(!box || document.getElementById('xFristCard')) return;

    // alte Karte "Putzplan-Start" (aus admin.js) entfernen
    const alt = document.getElementById('admStartCard');
    if(alt) alt.remove();

    const cfgNow = (typeof hauswartConfig !== 'undefined' && hauswartConfig) ? hauswartConfig : {};
    const beginn = cfgNow.beginn_tag || 7;
    const frist = cfgNow.frist_tag || 3;

    const card = document.createElement('div');
    card.id = 'xFristCard';
    card.className = 'event-card';
    card.appendChild(mk('div', 'Zeitrahmen', { fontWeight: '600', fontSize: '14px' }));
    card.appendChild(mk('div',
      'Eine Putzwoche beginnt am gewählten Tag. Bis zum Ende des Fristtags zählt Abhaken als pünktlich, danach bis zum Ende der Woche als verspätet. Am nächsten Wochenbeginn erscheint der neue Plan.',
      { fontSize: '12px', color: 'var(--muted, #aaa)', margin: '2px 0 8px' }));

    const selBeginn = auswahl(beginn);
    const selFrist = auswahl(frist);
    card.appendChild(zeile('Woche beginnt am', selBeginn));
    card.appendChild(zeile('Frist bis Ende von', selFrist));

    const save = makeBtn('Speichern', function(){ speichern(selBeginn.value, selFrist.value); });
    styleGhostBtn(save);
    save.style.marginTop = '10px';
    card.appendChild(save);

    box.parentNode.insertBefore(card, box);
  }

  async function speichern(beginn, frist){
    if(!navigator.onLine){ toast('Offline – Speichern braucht eine Verbindung.'); return; }
    if(!confirm('Zeitrahmen ändern? Der neue Wochenbeginn gilt sofort und kann die laufende Woche verschieben.')) return;
    try{
      await putzApi('saveputzfristen', { beginn: beginn, frist: frist });
      toast('✓ Zeitrahmen gespeichert');
      loadPutzplan();
      loadHauswartPanel();
    }catch(e){
      toast('⚠️ ' + e.message);
    }
  }

  // nach jedem Neuzeichnen des Hauswart-Tabs die Karte einsetzen
  const origRender = window.renderHauswartPanel;
  if(typeof origRender === 'function'){
    window.renderHauswartPanel = function(){
      origRender.apply(this, arguments);
      try{ fristKarte(); }catch(e){ console.error(e); }
    };
  }
})();
