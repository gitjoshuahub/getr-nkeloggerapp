// ============================================================
// mengen.js  –  Mengenauswahl beim Buchen (Getränke → Kategorie → Name → "Wie viel?")
//  - Flaschen: 1 bis 5 als große Knöpfe (ein Tipp bucht sofort)
//  - darunter ein Schieberegler mit Rastpunkten von 6 bis 19, daneben die Zahl
//    und ein Bestätigen-Knopf
//  - "Zuletzt gebucht": die letzten Mengen über 5 als Schnellknöpfe
//  - Kästen: 1 bis 5 wie bisher
// Wird NACH app.js geladen. Einbau in index.html, unter dem app.js-Tag:
//   <script src="mengen.js"></script>
// ============================================================
(function(){
  const REC_KEY = 'bier_recent_mengen';
  const GROSS_MAX = 5;

  const css = `
.xslider{
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 44px; margin: 0; padding: 0; border: none; background: transparent;
  accent-color: var(--accent, #e5383b);
}
.xslider::-webkit-slider-runnable-track{ height: 8px; border-radius: 4px; background: #333; }
.xslider::-webkit-slider-thumb{
  -webkit-appearance: none; appearance: none;
  width: 28px; height: 28px; margin-top: -10px; border-radius: 50%;
  background: var(--accent, #e5383b); border: 2px solid #fff;
}
.xslider::-moz-range-track{ height: 8px; border-radius: 4px; background: #333; }
.xslider::-moz-range-thumb{
  width: 24px; height: 24px; border-radius: 50%;
  background: var(--accent, #e5383b); border: 2px solid #fff;
}
.xticks{ display: flex; justify-content: space-between; padding: 0 14px; margin-top: -8px; pointer-events: none; }
.xticks span{ width: 2px; height: 7px; background: #555; border-radius: 1px; }
.xrec-btn{
  width: auto; margin: 0; padding: 8px 14px; font-size: 14px; border-radius: 999px;
  background: transparent; border: 1px solid var(--muted, #8a8a8a); color: var(--text, #f2f2f2);
}`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  // ---------- zuletzt gebuchte Mengen ----------
  function recRead(){
    try{ return JSON.parse(localStorage.getItem(REC_KEY) || '{}'); }catch(e){ return {}; }
  }

  function recKey(name, typ){
    return String(name).toLowerCase() + '|' + typ;
  }

  function recAdd(name, typ, n){
    try{
      const all = recRead();
      const k = recKey(name, typ);
      const list = (all[k] || []).filter(x => x !== n);
      list.unshift(n);
      all[k] = list.slice(0, 8);
      localStorage.setItem(REC_KEY, JSON.stringify(all));
    }catch(e){}
  }

  // Nur Mengen über 5 (die bis 5 sind ohnehin groß da)
  function recList(name, typ){
    const l = recRead()[recKey(name, typ)] || [];
    return l.filter(n => n > GROSS_MAX).slice(0, 3);
  }

  // Buchen wie bisher, merkt sich zusätzlich die Menge
  window.logBuchung = async function(anzahl, typ){
    const ok = await sendAction({ name: currentName, menge: anzahl, typ: typ });
    if(ok){
      recAdd(currentName, typ, anzahl);
      showCats();
    }
  };

  // ---------- Darstellung ----------
  window.renderMengeSteppers = function(){
    const grid = document.getElementById('mengeGrid');
    grid.innerHTML = '';

    // --- Flaschen ---
    const flWrap = document.createElement('div');
    flWrap.className = 'stepper-block';
    const flLabel = document.createElement('div');
    flLabel.className = 'stepper-label';
    flLabel.textContent = 'Flaschen';
    flWrap.appendChild(flLabel);
    flWrap.appendChild(buildAnzahlGrid(GROSS_MAX, 'flasche'));

    const rec = recList(currentName, 'flasche');
    if(rec.length){
      const recRow = document.createElement('div');
      Object.assign(recRow.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '14px' });
      recRow.appendChild(mk('span', 'Zuletzt', { fontSize: '12px', color: 'var(--muted, #8a8a8a)' }));
      rec.forEach(n => {
        const b = makeBtn(n + ' 🍺', function(){ logBuchung(n, 'flasche'); });
        b.className = 'xrec-btn';
        recRow.appendChild(b);
      });
      flWrap.appendChild(recRow);
    }

    if(FLASCHEN_MAX > GROSS_MAX){
      const lo = GROSS_MAX + 1;
      flWrap.appendChild(mk('div', 'Mehr als ' + GROSS_MAX, {
        fontSize: '12px', color: 'var(--muted, #8a8a8a)', margin: '14px 0 2px'
      }));

      const line = document.createElement('div');
      Object.assign(line.style, { display: 'flex', alignItems: 'center', gap: '10px' });

      const sliderBox = document.createElement('div');
      Object.assign(sliderBox.style, { flex: '1 1 auto', minWidth: '0' });
      const range = document.createElement('input');
      range.type = 'range';
      range.className = 'xslider';
      range.min = String(lo);
      range.max = String(FLASCHEN_MAX);
      range.step = '1';
      range.value = String(rec[0] || lo);
      sliderBox.appendChild(range);

      const ticks = document.createElement('div');
      ticks.className = 'xticks';
      for(let i = lo; i <= FLASCHEN_MAX; i++) ticks.appendChild(document.createElement('span'));
      sliderBox.appendChild(ticks);
      line.appendChild(sliderBox);

      const val = mk('span', range.value, { fontSize: '28px', fontWeight: '700', minWidth: '38px', textAlign: 'center' });
      range.addEventListener('input', function(){ val.textContent = range.value; });
      line.appendChild(val);

      const ok = makeBtn('Buchen', function(){ logBuchung(parseInt(range.value, 10), 'flasche'); });
      ok.className = 'btn-accent';
      Object.assign(ok.style, { padding: '12px 14px', fontSize: '15px', flex: '0 0 auto' });
      line.appendChild(ok);

      flWrap.appendChild(line);
    }
    grid.appendChild(flWrap);

    // --- Kästen: 1 bis 5 wie bisher ---
    const kiWrap = document.createElement('div');
    kiWrap.className = 'stepper-block';
    const kiLabel = document.createElement('div');
    kiLabel.className = 'stepper-label';
    kiLabel.textContent = 'Kästen';
    kiWrap.appendChild(kiLabel);
    kiWrap.appendChild(buildAnzahlGrid(KISTEN_MAX, 'kasten'));
    grid.appendChild(kiWrap);
  };
})();
