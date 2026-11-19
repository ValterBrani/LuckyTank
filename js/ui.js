'use strict';
/* =========================================================================
 * Interface : garage (configuration), écran de bataille, résultats
 * ========================================================================= */
(function () {
  const HB = window.HB;
  const $ = s => document.querySelector(s);
  const esc = HB.esc;
  const STORE = 'hasardBattle.v1';

  const state = {
    roster: [],
    sel: 0,
    options: { density: 'normale', pickups: true, zone: true },
    lastSeed: null,
    speed: 1,
  };
  let game = null;

  /* ---------------- Sauvegarde ---------------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d.roster)) state.roster = d.roster.map(sanitize).filter(Boolean).slice(0, HB.MAX_TANKS);
        if (d.options) Object.assign(state.options, d.options);
      }
    } catch (e) { /* stockage indisponible : on repart de zéro */ }
    if (state.roster.length < HB.MIN_TANKS) defaultRoster();
  }

  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ roster: state.roster, options: state.options })); } catch (e) { /* ignore */ }
  }

  /* Anciens noms français (versions précédentes) → noms anglais */
  const OLD_NAMES = ['Bulldozer', 'Vortex', 'Taupe', 'Mammouth', 'Frelon', 'Gargouille', 'Tonnerre', 'Renard',
    'Belette', 'Cyclone', 'Pétard', 'Grizzli', 'Mistral', 'Cafard', 'Bélier', 'Furet', 'Sanglier',
    'Pélican', 'Bourdon', 'Caïman', 'Zéphyr', 'Marmotte', 'Tornade', 'Scorpion'];
  function migrateName(n) {
    if (n === 'Mon Tank') return 'My Tank';
    if (n === 'Sans nom') return 'Unnamed';
    const m = /^Joueur (\d+)$/.exec(n);
    if (m) return 'Player ' + m[1];
    const i = OLD_NAMES.indexOf(n);
    return i >= 0 ? HB.NAMES[i] : n;
  }

  function sanitize(t) {
    if (!t || typeof t !== 'object') return null;
    const stats = {};
    for (const st of HB.STATS) stats[st.key] = HB.clamp(Math.round(+((t.stats || {})[st.key]) || 1), 1, HB.MAX_LEVEL);
    return {
      id: t.id || HB.uid(),
      name: migrateName(String(t.name || 'Tank')).slice(0, 14),
      color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : HB.COLORS[0],
      stats: HB.buildCost(stats) <= HB.BUDGET ? stats : HB.randomStats(),
      behavior: HB.BEHAVIORS[t.behavior] ? t.behavior : 'flanqueur',
      retreat: HB.RETREAT.some(r => r.value === t.retreat) ? t.retreat : 0,
      random: !!t.random,
    };
  }

  function defaultRoster() {
    state.roster = [{
      id: HB.uid(), name: 'My Tank', color: HB.COLORS[0],
      stats: { vitesse: 5, blindage: 5, puissance: 5, cadence: 5, portee: 5 },
      behavior: 'flanqueur', retreat: 0.25, random: false,
    }];
    for (let i = 0; i < 3; i++) state.roster.push(HB.randomTank(state.roster));
    state.sel = 0;
  }

  const cur = () => state.roster[state.sel];

  /* ---------------- Archétype & conseils ---------------- */
  HB.archetype = s => {
    if (s.blindage >= 7 && s.puissance >= 6) return { label: 'Fortress', icon: '🏰', sub: 'Slow but terrifying.' };
    if (s.vitesse >= 7 && s.blindage <= 3) return { label: 'Scout', icon: '🏎️', sub: 'Fast, fragile, hard to pin down.' };
    if (s.puissance >= 8) return { label: 'Heavy gun', icon: '💣', sub: 'Every shell hurts… when it hits.' };
    if (s.cadence >= 7) return { label: 'Machine gunner', icon: '🔥', sub: 'A hail of small shells.' };
    if (s.portee >= 7) return { label: 'Artillery', icon: '🎯', sub: 'Hits from afar.' };
    if (s.blindage >= 7) return { label: 'Heavy tank', icon: '🛡️', sub: 'Takes a beating.' };
    if (s.vitesse >= 7) return { label: 'Runner', icon: '💨', sub: 'Mobile and evasive.' };
    return { label: 'All-rounder', icon: '⚙️', sub: 'Good at everything, great at nothing.' };
  };

  function notesFor(t) {
    const d = HB.derive(t.stats), out = [];
    const left = HB.pointsLeft(t.stats);
    if (left > 0) out.push(['info', `You still have ${left} point${left > 1 ? 's' : ''} to spend.`]);
    const loss = Math.round((1 - d.weightFactor) * 100);
    if (d.weightFactor < 0.7) out.push(['warn', `Very heavy (${d.tons} t): loses ${loss}% of its speed.`]);
    else if (d.weightFactor > 0.86) out.push(['good', `Light (${d.tons} t): almost no speed loss.`]);
    if (d.reload > 2.2) out.push(['warn', `Very slow reload: ${d.reload.toFixed(1)} s between shots.`]);
    if (d.maxHp < 120) out.push(['warn', `Fragile: ${Math.ceil(d.maxHp / 58)} heavy shells are enough to destroy it.`]);
    if (d.range < 330) out.push(['warn', 'Short range: it will have to get close to fire.']);
    if (d.shellSpeed < 420) out.push(['info', 'Slow shells: fast tanks will be able to dodge them.']);
    if (t.behavior === 'tireur' && d.range < 400) out.push(['warn', 'A Sniper with little range is not ideal.']);
    if (t.behavior === 'agressif' && d.maxHp < 140) out.push(['warn', 'A fragile Bruiser is likely to die first.']);
    return out;
  }

  /* ---------------- Rendu du garage ---------------- */
  function renderAll() {
    renderRoster();
    renderEditor();
    renderDerived();
    renderOptions();
    save();
  }

  function renderRoster() {
    $('#rosterCount').textContent = `(${state.roster.length}/${HB.MAX_TANKS})`;
    $('#roster').innerHTML = state.roster.map((t, i) => {
      const a = HB.archetype(t.stats), b = HB.BEHAVIORS[t.behavior];
      const mini = HB.STATS.map(st => `<span title="${st.label} ${t.stats[st.key]}"><i style="width:${t.stats[st.key] * 10}%;background:${t.color}"></i></span>`).join('');
      return `<div class="tank-card ${i === state.sel ? 'sel' : ''}" data-i="${i}">
        <div class="stripe" style="background:${t.color}"></div>
        <div>
          <div class="nm">${esc(t.name)} ${t.random ? '🎲' : ''}</div>
          <div class="sub">${a.icon} ${a.label} · ${b.icon} ${b.label}</div>
          <div class="mini">${mini}</div>
        </div>
        <div class="acts">
          <button data-act="reroll" title="Rebuild at random">🎲</button>
          <button data-act="remove" title="Remove" ${state.roster.length <= HB.MIN_TANKS ? 'disabled' : ''}>✕</button>
        </div>
      </div>`;
    }).join('');
    $('#addCustom').disabled = $('#addRandom').disabled = state.roster.length >= HB.MAX_TANKS;
  }

  function tierOf(l) { return l <= 4 ? 't1' : l <= 7 ? 't2' : 't3'; }

  function renderEditor() {
    const t = cur();
    const nameInput = $('#tankName');
    if (document.activeElement !== nameInput) nameInput.value = t.name;

    const used = new Set(state.roster.filter(o => o !== t).map(o => o.color));
    $('#swatches').innerHTML = HB.COLORS.map(c =>
      `<button data-color="${c}" class="${c === t.color ? 'on' : ''} ${used.has(c) ? 'used' : ''}" style="background:${c}" title="${used.has(c) ? 'Already taken' : 'Color'}"></button>`).join('');

    const left = HB.pointsLeft(t.stats);
    const pl = $('#pointsLeft');
    pl.textContent = left;
    pl.classList.toggle('zero', left === 0);
    $('#budgetMax').textContent = HB.BUDGET;
    $('#budgetFill').style.width = (100 * (HB.BUDGET - left) / HB.BUDGET) + '%';

    $('#statRows').innerHTML = HB.STATS.map(st => {
      const lvl = t.stats[st.key];
      const pips = [];
      for (let l = 1; l <= HB.MAX_LEVEL; l++) {
        const on = l <= lvl;
        const can = !on && HB.canSetLevel(t.stats, st.key, l);
        pips.push(`<i data-lvl="${l}" class="${tierOf(l)} ${on ? 'on' : can ? 'can' : 'locked'}" title="Level ${l}"></i>`);
      }
      const nextCost = lvl < HB.MAX_LEVEL ? HB.levelStepCost(lvl + 1) : 0;
      const canInc = lvl < HB.MAX_LEVEL && nextCost <= left;
      return `<div class="stat-row" data-key="${st.key}">
        <div class="stat-label"><span class="ic">${st.icon}</span><div><b>${st.label}</b><small>${st.desc}</small></div></div>
        <button class="pm" data-act="dec" ${lvl <= 1 ? 'disabled' : ''}>−</button>
        <div class="pips">${pips.join('')}</div>
        <button class="pm" data-act="inc" ${canInc ? '' : 'disabled'}>+</button>
        <div class="lvl">${lvl}</div>
        <div class="next ${lvl < HB.MAX_LEVEL && !canInc ? 'no' : ''}">${lvl >= HB.MAX_LEVEL ? 'MAX' : '+1 lvl = ' + nextCost + ' pt' + (nextCost > 1 ? 's' : '')}</div>
      </div>`;
    }).join('');

    $('#behaviors').innerHTML = Object.entries(HB.BEHAVIORS).map(([k, b]) =>
      `<button class="beh ${t.behavior === k ? 'on' : ''}" data-beh="${k}"><span class="bi">${b.icon}</span><b>${b.label}</b><small>${b.desc}</small></button>`).join('');

    $('#retreatBtns').innerHTML = HB.RETREAT.map(r =>
      `<button data-retreat="${r.value}" class="${t.retreat === r.value ? 'on' : ''}">${r.label}</button>`).join('');
  }

  function renderDerived() {
    const t = cur();
    const d = HB.derive(t.stats);
    const a = HB.archetype(t.stats);
    $('#archetype').innerHTML = `${a.icon} ${a.label}<small>${a.sub}</small>`;
    $('#derived').innerHTML = HB.DERIVED_VIEW.map(v => {
      const val = d[v.key];
      const pct = HB.clamp((val - v.min) / (v.max - v.min), 0, 1) * 100;
      return `<div class="drow ${v.invert ? 'inv' : ''}"><div class="top"><span>${v.label}</span><b>${v.fmt(d)}</b></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
    }).join('');
    $('#notes').innerHTML = notesFor(t).map(([k, s]) => `<li class="${k}">${s}</li>`).join('');
  }

  function renderOptions() {
    const dens = [['faible', 'Sparse'], ['normale', 'Normal'], ['forte', 'Dense']];
    $('#densityBtns').innerHTML = dens.map(([k, l]) => `<button data-dens="${k}" class="${state.options.density === k ? 'on' : ''}">${l}</button>`).join('');
    $('#optPickups').checked = !!state.options.pickups;
    $('#optZone').checked = !!state.options.zone;
  }

  /* ---------------- Aperçu animé du tank ---------------- */
  let previewRaf = 0;
  function previewLoop(ts) {
    const cv = $('#preview');
    const ctx = cv.getContext('2d');
    const t = cur();
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#6f6848';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    for (let x = 0; x < cv.width; x += 20) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, cv.height); ctx.stroke(); }
    for (let y = 0; y < cv.height; y += 20) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(cv.width, y + 0.5); ctx.stroke(); }
    if (t) {
      const s = ts / 1000;
      ctx.save();
      ctx.translate(cv.width / 2, cv.height / 2 + 4);
      ctx.scale(2.6, 2.6);
      HB.drawTank(ctx, t.stats, t.color, 0, 0, -0.35, -0.35 + Math.sin(s * 0.9) * 0.8, { trackPhase: s * 20 * (0.3 + t.stats.vitesse * 0.1) });
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, cv.height - 22, cv.width, 22);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${t.name} — ${HB.derive(t.stats).tons} tons`, cv.width / 2, cv.height - 7);
    }
    if ($('#garage').classList.contains('active')) previewRaf = requestAnimationFrame(previewLoop);
  }

  /* ---------------- Événements du garage ---------------- */
  function markCustom() { cur().random = false; }

  function bindGarage() {
    $('#roster').addEventListener('click', e => {
      const card = e.target.closest('.tank-card');
      if (!card) return;
      const i = +card.dataset.i;
      const act = e.target.closest('button')?.dataset.act;
      if (act === 'remove') {
        if (state.roster.length <= HB.MIN_TANKS) return;
        state.roster.splice(i, 1);
        if (state.sel >= state.roster.length) state.sel = state.roster.length - 1;
        else if (state.sel > i) state.sel--;
      } else if (act === 'reroll') {
        const t = state.roster[i];
        const others = state.roster.filter(o => o !== t);
        const r = HB.randomTank(others);
        t.stats = r.stats; t.behavior = r.behavior; t.retreat = r.retreat; t.random = true;
        state.sel = i;
      } else {
        state.sel = i;
      }
      renderAll();
    });

    $('#addCustom').addEventListener('click', () => {
      if (state.roster.length >= HB.MAX_TANKS) return;
      const r = HB.randomTank(state.roster);
      r.name = 'Player ' + (state.roster.length + 1);
      r.stats = { vitesse: 1, blindage: 1, puissance: 1, cadence: 1, portee: 1 };
      r.behavior = 'flanqueur'; r.retreat = 0.25; r.random = false;
      state.roster.push(r);
      state.sel = state.roster.length - 1;
      renderAll();
      $('#tankName').focus();
      $('#tankName').select();
    });

    $('#addRandom').addEventListener('click', () => {
      if (state.roster.length >= HB.MAX_TANKS) return;
      state.roster.push(HB.randomTank(state.roster));
      state.sel = state.roster.length - 1;
      renderAll();
    });

    $('#tankName').addEventListener('input', e => {
      cur().name = e.target.value.slice(0, 14) || 'Unnamed';
      renderRoster();
      save();
    });

    $('#swatches').addEventListener('click', e => {
      const b = e.target.closest('button[data-color]');
      if (!b) return;
      cur().color = b.dataset.color;
      renderAll();
    });

    $('#statRows').addEventListener('click', e => {
      const row = e.target.closest('.stat-row');
      if (!row) return;
      const key = row.dataset.key, t = cur(), lvl = t.stats[key];
      const act = e.target.closest('button')?.dataset.act;
      const pip = e.target.closest('i[data-lvl]');
      let target = null;
      if (act === 'inc') target = lvl + 1;
      else if (act === 'dec') target = lvl - 1;
      else if (pip) { const l = +pip.dataset.lvl; target = l === lvl ? l - 1 : l; }
      if (target !== null && HB.canSetLevel(t.stats, key, target)) {
        t.stats[key] = target;
        markCustom();
        renderAll();
      }
    });

    $('#behaviors').addEventListener('click', e => {
      const b = e.target.closest('[data-beh]');
      if (!b) return;
      cur().behavior = b.dataset.beh;
      markCustom();
      renderAll();
    });

    $('#retreatBtns').addEventListener('click', e => {
      const b = e.target.closest('[data-retreat]');
      if (!b) return;
      cur().retreat = +b.dataset.retreat;
      markCustom();
      renderAll();
    });

    $('#randomize').addEventListener('click', () => { cur().stats = HB.randomStats(); renderAll(); });
    $('#resetStats').addEventListener('click', () => {
      cur().stats = { vitesse: 1, blindage: 1, puissance: 1, cadence: 1, portee: 1 };
      markCustom();
      renderAll();
    });

    $('#densityBtns').addEventListener('click', e => {
      const b = e.target.closest('[data-dens]');
      if (!b) return;
      state.options.density = b.dataset.dens;
      renderAll();
    });
    $('#optPickups').addEventListener('change', e => { state.options.pickups = e.target.checked; save(); });
    $('#optZone').addEventListener('change', e => { state.options.zone = e.target.checked; save(); });

    $('#launch').addEventListener('click', () => startBattle((Math.random() * 1e9) >>> 0));
  }

  /* ---------------- Bataille ---------------- */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    if (id === 'garage') { cancelAnimationFrame(previewRaf); previewRaf = requestAnimationFrame(previewLoop); }
  }

  let sbRows = [];
  let feedCount = 0;

  function startBattle(seed) {
    state.lastSeed = seed;
    save();
    showScreen('battle');
    $('#results').classList.add('hidden');
    $('#feed').innerHTML = '';
    feedCount = 0;
    if (game) game.destroy();
    const roster = state.roster.map(t => JSON.parse(JSON.stringify(t)));
    game = new HB.Game($('#battleCanvas'), roster, Object.assign({}, state.options, { seed }), {
      onHud: renderHud, onFeed: addFeed, onEnd: showResults,
    });
    game.speed = state.speed || 1;
    buildScoreboard();
    setSpeedButtons();
    addFeed(`⚔️ ${roster.length} tanks on map #${seed}. May the best tank win!`);
    HB.sfx.unlock();
    HB.sfx.start();
    game.start();
    window.__game = game; // pratique pour déboguer dans la console
  }

  function buildScoreboard() {
    const sb = $('#scoreboard');
    sb.innerHTML = '';
    sbRows = game.tanks.map(t => {
      const row = document.createElement('div');
      row.className = 'sb-row';
      const b = HB.BEHAVIORS[t.cfg.behavior];
      row.innerHTML = `<span class="dot" style="background:${t.color}"></span>
        <div style="min-width:0"><div class="nm">${esc(t.name)} <span class="muted" title="${b.label}">${b.icon}</span></div>
        <div class="hp"><i></i></div><div class="st"></div></div>
        <div class="k"></div>`;
      row.addEventListener('click', () => { game.selected = t.alive ? t : null; renderHud(game); });
      sb.appendChild(row);
      return { t, row, hp: row.querySelector('.hp i'), st: row.querySelector('.st'), k: row.querySelector('.k') };
    });
  }

  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function fmtTime(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  function renderHud(g) {
    if (g !== game) return;
    for (const r of sbRows) {
      const t = r.t;
      r.row.classList.toggle('dead', !t.alive);
      r.row.classList.toggle('sel', g.selected === t);
      const ratio = t.hpRatio;
      r.hp.style.width = (ratio * 100) + '%';
      r.hp.style.background = ratio > 0.5 ? 'var(--good)' : ratio > 0.25 ? '#f2c230' : 'var(--bad)';
      r.st.textContent = t.alive ? `${Math.ceil(t.hp)} HP · ${t.brain.state}` : `Destroyed · ${ordinal(t.place)}`;
      r.k.innerHTML = `⚔ ${t.kills}<br><span class="muted">${Math.round(t.damageDealt)} dmg</span>`;
    }
    $('#clock').textContent = fmtTime(g.time);
    const zi = $('#zoneInfo');
    if (g.over) { zi.textContent = '🏁 Battle over'; zi.classList.remove('hot'); }
    else if (!g.options.zone) { zi.textContent = ''; zi.classList.remove('hot'); }
    else if (!g.zone.active) { zi.textContent = `☢️ Death zone in ${Math.ceil(g.zone.start - g.time)} s`; zi.classList.remove('hot'); }
    else { zi.textContent = '☢️ The zone is closing in!'; zi.classList.add('hot'); }
  }

  function addFeed(html, kind) {
    const div = document.createElement('div');
    if (kind) div.className = kind;
    div.innerHTML = `<span class="tm">${fmtTime(game ? game.time : 0)}</span>${html}`;
    const feed = $('#feed');
    feed.prepend(div);
    if (++feedCount > 60) feed.lastChild.remove();
  }

  function setSpeedButtons() {
    document.querySelectorAll('#speedBtns button').forEach(b => {
      const s = +b.dataset.speed;
      b.classList.toggle('on', game && (s === 0 ? game.paused : !game.paused && game.speed === s));
    });
  }

  function setSpeed(s) {
    if (!game) return;
    if (s === 0) game.paused = !game.paused;
    else { game.paused = false; game.speed = s; state.speed = s; }
    setSpeedButtons();
  }

  function showResults(res) {
    const w = res.list[0];
    $('#resTitle').innerHTML = res.winner
      ? `🏆 <span style="color:${w.color}">${esc(res.winner)}</span> wins the battle!`
      : 'Draw';
    $('#resSub').textContent = `Duration: ${fmtTime(res.duration)} · map #${res.seed}`;
    $('#resBody').innerHTML = res.list.map((r, i) => {
      const b = HB.BEHAVIORS[r.behavior];
      return `<tr class="${i === 0 ? 'first' : ''}">
        <td>${r.place}</td>
        <td><span class="tn"><i style="background:${r.color}"></i>${esc(r.name)}</span></td>
        <td>${b.icon} ${b.label}</td>
        <td>${r.kills}</td>
        <td>${r.damageDealt}</td>
        <td>${r.accuracy}% <span class="muted">(${r.hits}/${r.shots})</span></td>
        <td>${fmtTime(r.survival)}</td>
        <td>${r.killer ? esc(r.killer) : '—'}</td>
      </tr>`;
    }).join('');
    $('#results').classList.remove('hidden');
  }

  function backToGarage() {
    if (game) { game.destroy(); game = null; }
    $('#results').classList.add('hidden');
    showScreen('garage');
    renderAll();
  }

  function bindBattle() {
    $('#speedBtns').addEventListener('click', e => {
      const b = e.target.closest('button[data-speed]');
      if (b) setSpeed(+b.dataset.speed);
    });
    $('#backGarage').addEventListener('click', backToGarage);
    $('#resGarage').addEventListener('click', backToGarage);
    $('#resReplay').addEventListener('click', () => startBattle(state.lastSeed));
    $('#resNew').addEventListener('click', () => startBattle((Math.random() * 1e9) >>> 0));

    const cv = $('#battleCanvas');
    cv.addEventListener('click', e => {
      if (!game) return;
      const r = cv.getBoundingClientRect();
      game.pick((e.clientX - r.left) * HB.W / r.width, (e.clientY - r.top) * HB.H / r.height);
      renderHud(game);
    });

    document.addEventListener('keydown', e => {
      if (!$('#battle').classList.contains('active') || !game) return;
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); setSpeed(0); }
      else if (e.key === '1') setSpeed(1);
      else if (e.key === '2') setSpeed(2);
      else if (e.key === '3') setSpeed(4);
      else if (e.key === 'Escape') game.selected = null;
    });
  }

  /* ---------------- Son ---------------- */
  function renderSound() {
    const s = HB.sfx;
    document.querySelectorAll('.mute-btn').forEach(b => {
      b.textContent = !s.audible ? '🔇' : s.volume < 0.4 ? '🔉' : '🔊';
      b.classList.toggle('off', !s.audible);
    });
    document.querySelectorAll('.vol').forEach(v => { v.value = s.muted ? 0 : s.volume; });
  }

  function bindSound() {
    document.querySelectorAll('.mute-btn').forEach(b => b.addEventListener('click', () => {
      HB.sfx.unlock();
      if (HB.sfx.volume === 0) HB.sfx.setVolume(0.6); else HB.sfx.toggleMute();
      renderSound();
      HB.sfx.click();
    }));
    document.querySelectorAll('.vol').forEach(v => {
      v.addEventListener('input', () => { HB.sfx.unlock(); HB.sfx.setVolume(+v.value); renderSound(); });
      v.addEventListener('change', () => { HB.sfx.click(); v.blur(); }); // rend les raccourcis clavier
    });
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
      if (e.key === 'm' || e.key === 'M') { HB.sfx.unlock(); HB.sfx.toggleMute(); renderSound(); }
    });
    // Petit clic sur les boutons du garage
    $('#garage').addEventListener('click', e => { if (e.target.closest('button, .pips i')) HB.sfx.click(); });
  }

  /* ---------------- Démarrage ---------------- */
  load();
  bindSound();
  renderSound();
  bindGarage();
  bindBattle();
  renderAll();
  showScreen('garage');
})();
