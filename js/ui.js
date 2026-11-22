'use strict';
/* =========================================================================
 * Interface : garage (configuration), défis, écran de bataille, résultats
 * ========================================================================= */
(function () {
  const HB = window.HB;
  const $ = s => document.querySelector(s);
  const esc = HB.esc;
  const STORE = 'hasardBattle.v1';
  const FREE_RULES = { budget: HB.BUDGET, caps: {}, behaviors: null, modules: true };

  const state = {
    roster: [],
    sel: 0,
    options: { density: 'normale', pickups: true, zone: true },
    lastSeed: null,
    speed: 1,
    mode: 'free',      // 'free' (bataille libre) | 'challenge' (garage d'un défi)
    chId: null,
    chTanks: {},       // tank du joueur pour chaque défi
    picking: null,     // emplacement de module en cours de choix
  };
  let screen = 'garage'; // 'garage' | 'challenges' | 'battle'

  /* Téléphone / tablette : pointeur tactile. "Compact" = mise en page téléphone (mêmes règles que le CSS). */
  HB.isTouch = window.matchMedia('(pointer: coarse)').matches;
  const compactMQ = window.matchMedia('(max-width: 760px), (pointer: coarse) and (max-height: 520px)');
  const isCompact = () => compactMQ.matches;
  document.body.classList.toggle('touch', HB.isTouch);
  if (HB.isTouch) {
    document.getElementById('battleHint').textContent =
      'Tap a tank to follow it with the camera. Pinch to zoom, drag to look around, double-tap to see the whole map. 🎥 switches between follow and overview. 🔭 puts you inside the tank.';
  } else {
    document.getElementById('battleHint').textContent =
      'Click a tank to see its range, its target, its path and what it is doing. 🔭 Inside (V) puts you inside the selected tank.';
  }
  function setMTab(tab) {
    document.body.dataset.mtab = tab;
    document.querySelectorAll('#mtabs button').forEach(b => b.classList.toggle('on', b.dataset.mtab === tab));
  }
  let game = null;
  let gameMode = 'free';
  let wantInside = false; // la vue intérieure reste active d'une bataille à l'autre

  /* ---------------- Sauvegarde ---------------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const d = JSON.parse(raw);
        if (Array.isArray(d.roster)) state.roster = d.roster.map(t => sanitize(t)).filter(Boolean).slice(0, HB.MAX_TANKS);
        if (d.options) Object.assign(state.options, d.options);
        if (d.chTanks && typeof d.chTanks === 'object') {
          for (const [cid, t] of Object.entries(d.chTanks)) {
            const ch = HB.challengeById(cid);
            const s = ch && sanitize(t, HB.challengeRules(ch));
            if (s) state.chTanks[cid] = s;
          }
        }
      }
    } catch (e) { /* stockage indisponible : on repart de zéro */ }
    if (state.roster.length < HB.MIN_TANKS) defaultRoster();
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ roster: state.roster, options: state.options, chTanks: state.chTanks }));
    } catch (e) { /* ignore */ }
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

  function sanitize(t, R = FREE_RULES) {
    if (!t || typeof t !== 'object') return null;
    const stats = {};
    for (const st of HB.STATS) {
      const cap = Math.min(HB.MAX_LEVEL, R.caps[st.key] || HB.MAX_LEVEL);
      stats[st.key] = HB.clamp(Math.round(+((t.stats || {})[st.key]) || 1), 1, cap);
    }
    const modules = [];
    if (R.modules && Array.isArray(t.modules)) {
      for (const m of t.modules) {
        if (!m || !HB.MODULES[m.id] || modules.some(x => x.id === m.id) || modules.length >= HB.MAX_MODULES) continue;
        modules.push({ id: m.id, trigger: HB.TRIGGERS[m.trigger] ? m.trigger : HB.MODULES[m.id].trigger });
      }
    }
    const out = {
      id: t.id || HB.uid(),
      name: migrateName(String(t.name || 'Tank')).slice(0, 14),
      color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : HB.COLORS[0],
      stats, modules,
      behavior: HB.BEHAVIORS[t.behavior] ? t.behavior : 'flanqueur',
      pilot: HB.sanitizePilot(t.pilot),
      retreat: HB.RETREAT.some(r => r.value === t.retreat) ? t.retreat : 0,
      random: !!t.random,
    };
    while (HB.tankCost(out) > R.budget && out.modules.length) out.modules.pop();
    if (HB.tankCost(out) > R.budget) out.stats = HB.randomStats(Math.random, R.budget, R.caps);
    return out;
  }

  /* Adapte un tank aux règles d'un défi (plafonds, pilote imposé, budget) */
  function fitToRules(t, R) {
    for (const st of HB.STATS) {
      const cap = R.caps[st.key];
      if (cap && t.stats[st.key] > cap) t.stats[st.key] = cap;
    }
    if (R.behaviors && !R.behaviors.includes(t.behavior)) t.behavior = R.behaviors[0];
    const unlocked = HB.unlockedModules();
    t.modules = R.modules ? (t.modules || []).filter(m => unlocked.has(m.id)) : [];
    while (HB.tankCost(t) > R.budget && t.modules.length) t.modules.pop();
    for (let guard = 0; HB.tankCost(t) > R.budget && guard < 100; guard++) {
      const k = HB.STATS.map(s => s.key).sort((a, b) => t.stats[b] - t.stats[a])[0];
      if (t.stats[k] <= 1) break;
      t.stats[k]--;
    }
    return t;
  }

  function defaultRoster() {
    state.roster = [{
      id: HB.uid(), name: 'My Tank', color: HB.COLORS[0],
      stats: { vitesse: 5, blindage: 5, puissance: 5, cadence: 5, portee: 5 }, modules: [],
      behavior: 'flanqueur', pilot: Object.assign({}, HB.DEFAULT_PILOT), retreat: 0.25, random: false,
    }];
    for (let i = 0; i < 3; i++) state.roster.push(HB.randomTank(state.roster));
    state.sel = 0;
  }

  const currentChallenge = () => (state.mode === 'challenge' ? HB.challengeById(state.chId) : null);
  const rules = () => { const ch = currentChallenge(); return ch ? HB.challengeRules(ch) : FREE_RULES; };
  const cur = () => (state.mode === 'challenge' ? state.chTanks[state.chId] : state.roster[state.sel]);

  function ensureChallengeTank(ch) {
    const R = HB.challengeRules(ch);
    if (!state.chTanks[ch.id]) {
      const base = state.roster.find(t => !t.random) || state.roster[0];
      const t = JSON.parse(JSON.stringify(base));
      t.id = 'me-' + ch.id;
      t.random = false;
      state.chTanks[ch.id] = fitToRules(t, R);
    } else {
      fitToRules(state.chTanks[ch.id], R);
    }
  }

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

  const modIcons = t => (t.modules || []).map(m => HB.MODULES[m.id] ? HB.MODULES[m.id].icon : '').join('');

  function notesFor(t, R) {
    const d = HB.derive(t.stats), out = [];
    const left = HB.pointsLeft(t, R.budget);
    if (left > 0) out.push(['info', `You still have ${left} point${left > 1 ? 's' : ''} to spend.`]);
    const mc = HB.modulesCost(t.modules);
    if (mc > 0) out.push(['info', `Modules use ${mc} of your ${R.budget} points.`]);
    const loss = Math.round((1 - d.weightFactor) * 100);
    if (d.weightFactor < 0.7) out.push(['warn', `Very heavy (${d.tons} t): loses ${loss}% of its speed.`]);
    else if (d.weightFactor > 0.86) out.push(['good', `Light (${d.tons} t): almost no speed loss.`]);
    if (d.reload > 2.2) out.push(['warn', `Very slow reload: ${d.reload.toFixed(1)} s between shots.`]);
    if (d.maxHp < 120) out.push(['warn', `Fragile: ${Math.ceil(d.maxHp / 58)} heavy shells are enough to destroy it.`]);
    if (d.range < 330) out.push(['warn', 'Short range: it will have to get close to fire.']);
    if (d.shellSpeed < 420) out.push(['info', 'Slow shells: fast tanks will be able to dodge them.']);
    if (t.behavior === 'tireur' && d.range < 400) out.push(['warn', 'A Sniper with little range is not ideal.']);
    if (t.behavior === 'agressif' && d.maxHp < 140) out.push(['warn', 'A fragile Bruiser is likely to die first.']);
    if (t.behavior === 'embusque' && d.range > 480) out.push(['warn', 'An Ambusher fights up close: long range is partly wasted.']);
    if (t.behavior === 'harceleur' && d.reload < 1.1) out.push(['info', 'Hit-and-run shines with a big gun that reloads slowly.']);
    if (t.behavior === 'harceleur' && d.speed < 60) out.push(['warn', 'Hit-and-run needs speed to get away while reloading.']);
    if (t.behavior === 'joueur') out.push(['info', 'The Gambler keeps changing style: a balanced tank suits it best.']);
    if (t.behavior === 'custom') {
      const p = HB.sanitizePilot(t.pilot);
      if (p.move === 'hold' && d.range < 330) out.push(['warn', 'Holding still with a short range: faster tanks will pick you apart.']);
      if (p.dist === 'long' && d.range < 400) out.push(['warn', 'Long distance with little range is not ideal.']);
      if (p.dist === 'close' && d.maxHp < 130) out.push(['warn', 'Fighting up close with little armor is risky.']);
    }
    for (const m of t.modules || []) {
      if (m.id === 'reparation' && (m.trigger === 'ready' || m.trigger === 'chasing' || m.trigger === 'inSight')) {
        out.push(['warn', 'Emergency repair works only once: keep it for when HP is low.']);
      }
      if (m.id === 'mines' && m.trigger === 'chasing') out.push(['warn', 'Mines are dropped behind you: useless while chasing.']);
    }
    return out;
  }

  /* ---------------- Rendu général ---------------- */
  function renderAll() {
    renderNav();
    if (screen === 'challenges') { renderChallenges(); save(); return; }
    if (screen !== 'garage') return;
    renderLeft();
    renderEditor();
    renderDerived();
    renderRight();
    save();
  }

  function renderNav() {
    const onCh = screen === 'challenges' || state.mode === 'challenge';
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', (b.dataset.nav === 'challenges') === onCh));
    $('#starCount').textContent = `★ ${HB.progress.totalStars()}/${HB.progress.maxStars()}`;
  }

  /* ---------------- Panneau gauche : roster ou briefing ---------------- */
  function renderLeft() {
    const ch = currentChallenge();
    $('#mtabTanks').textContent = ch ? 'Briefing' : 'Tanks';
    $('#rosterBlock').hidden = !!ch;
    $('#briefing').hidden = !ch;
    if (ch) renderBriefing(ch); else renderRoster();
  }

  function renderRoster() {
    $('#rosterCount').textContent = `(${state.roster.length}/${HB.MAX_TANKS})`;
    $('#roster').innerHTML = state.roster.map((t, i) => {
      const a = HB.archetype(t.stats), b = HB.BEHAVIORS[t.behavior];
      const mini = HB.STATS.map(st => `<span title="${st.label} ${t.stats[st.key]}"><i style="width:${t.stats[st.key] * 10}%;background:${t.color}"></i></span>`).join('');
      return `<div class="tank-card ${i === state.sel ? 'sel' : ''}" data-i="${i}">
        <div class="stripe" style="background:${t.color}"></div>
        <div>
          <div class="nm">${esc(t.name)} ${t.random ? '🎲' : ''} <span class="mods-inline">${modIcons(t)}</span></div>
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

  const DENS_LABEL = { faible: 'Sparse', normale: 'Normal', forte: 'Dense' };

  function challengeRulesList(ch) {
    const R = HB.challengeRules(ch), out = [];
    out.push(`💰 Budget: <b>${R.budget} points</b>${R.budget !== HB.BUDGET ? ' (instead of 30)' : ''}`);
    for (const [k, v] of Object.entries(R.caps)) {
      const st = HB.STATS.find(s => s.key === k);
      out.push(`🚫 ${st.label} limited to level <b>${v}</b>`);
    }
    if (R.behaviors) out.push(`🧑‍✈️ Pilot: ${R.behaviors.map(b => HB.BEHAVIORS[b].label).join(' or ')} only`);
    if (!R.modules) out.push('🧰 No modules');
    if (ch.survive) out.push(`⏱️ Survive <b>${ch.survive} s</b>`);
    if (ch.zone === false) out.push('☢️ No death zone');
    else out.push(`☢️ Death zone after <b>${ch.zoneStart ?? 60} s</b>`);
    out.push(`🗺️ Obstacles: ${DENS_LABEL[ch.density || 'normale']}`);
    return out;
  }

  function renderBriefing(ch) {
    const idx = HB.challengeIndex(ch.id);
    const enemies = ch.enemies.map(e => {
      const a = HB.archetype(e.stats), b = HB.BEHAVIORS[e.behavior];
      return `<div class="enemy">
        <span class="stripe" style="background:${e.color}"></span>
        <div><div class="nm">${esc(e.name)} <span class="mods-inline">${modIcons(e)}</span></div>
        <div class="sub">${a.icon} ${a.label} · ${b.icon} ${b.label}</div></div>
        <span class="cost" title="Points spent on this tank">${HB.tankCost(e)} pts</span>
      </div>`;
    }).join('');
    let reward = '';
    if (ch.unlocks) {
      const m = HB.MODULES[ch.unlocks], got = HB.unlockedModules().has(ch.unlocks);
      reward = `<div class="reward ${got ? 'got' : ''}">🎁 Reward: unlocks <b>${m.icon} ${m.label}</b>${got ? ' ✓' : ''}</div>`;
    }
    $('#briefing').innerHTML = `
      <button class="btn small ghost" data-act="toChallenges">◀ All challenges</button>
      <div class="brief-num">Challenge ${idx + 1} / ${HB.CHALLENGES.length}</div>
      <h2 class="brief-title">${esc(ch.name)}</h2>
      <p class="brief-desc">${esc(ch.desc)}</p>
      <ul class="brief-rules">${challengeRulesList(ch).map(r => `<li>${r}</li>`).join('')}</ul>
      <h3>Enemies (${ch.enemies.length})</h3>
      <div class="enemy-list">${enemies}</div>
      ${reward}`;
  }

  /* ---------------- Éditeur ---------------- */
  function tierOf(l) { return l <= 4 ? 't1' : l <= 7 ? 't2' : 't3'; }

  function renderEditor() {
    const t = cur(), R = rules();
    const nameInput = $('#tankName');
    if (document.activeElement !== nameInput) nameInput.value = t.name;

    const others = state.mode === 'challenge' ? currentChallenge().enemies : state.roster.filter(o => o !== t);
    const used = new Set(others.map(o => o.color));
    $('#swatches').innerHTML = HB.COLORS.map(c =>
      `<button data-color="${c}" class="${c === t.color ? 'on' : ''} ${used.has(c) ? 'used' : ''}" style="background:${c}" title="${used.has(c) ? 'Already taken' : 'Color'}"></button>`).join('');

    const left = HB.pointsLeft(t, R.budget);
    const pl = $('#pointsLeft');
    pl.textContent = left;
    pl.classList.toggle('zero', left === 0);
    $('#mPoints').textContent = left;
    $('#mPoints').classList.toggle('zero', left === 0);
    $('#mBudget').textContent = `/ ${R.budget} pts left`;
    $('#budgetMax').textContent = R.budget;
    $('#budgetFill').style.width = (100 * (R.budget - left) / R.budget) + '%';

    $('#statRows').innerHTML = HB.STATS.map(st => {
      const lvl = t.stats[st.key];
      const cap = Math.min(HB.MAX_LEVEL, R.caps[st.key] || HB.MAX_LEVEL);
      const pips = [];
      for (let l = 1; l <= HB.MAX_LEVEL; l++) {
        const on = l <= lvl;
        const can = !on && HB.canSetLevel(t, st.key, l, R.budget, cap);
        const capped = l > cap;
        pips.push(`<i data-lvl="${l}" class="${tierOf(l)} ${on ? 'on' : can ? 'can' : 'locked'} ${capped ? 'capped' : ''}" title="${capped ? 'Not allowed in this challenge' : 'Level ' + l}"></i>`);
      }
      const nextCost = lvl < HB.MAX_LEVEL ? HB.levelStepCost(lvl + 1) : 0;
      const canInc = lvl < cap && nextCost <= left;
      const nextTxt = lvl >= cap ? (cap < HB.MAX_LEVEL ? 'LIMIT' : 'MAX') : '+1 lvl = ' + nextCost + ' pt' + (nextCost > 1 ? 's' : '');
      return `<div class="stat-row" data-key="${st.key}">
        <div class="stat-label"><span class="ic">${st.icon}</span><div><b>${st.label}</b><small>${st.desc}</small></div></div>
        <button class="pm" data-act="dec" ${lvl <= 1 ? 'disabled' : ''}>−</button>
        <div class="pips">${pips.join('')}</div>
        <button class="pm" data-act="inc" ${canInc ? '' : 'disabled'}>+</button>
        <div class="lvl">${lvl}</div>
        <div class="next ${lvl < cap && !canInc ? 'no' : ''}">${nextTxt}</div>
      </div>`;
    }).join('');

    renderModules(t, R);

    $('#behaviors').innerHTML = Object.entries(HB.BEHAVIORS).map(([k, b]) => {
      const off = R.behaviors && !R.behaviors.includes(k);
      return `<button class="beh ${t.behavior === k ? 'on' : ''}" data-beh="${k}" ${off ? 'disabled' : ''}><span class="bi">${b.icon}</span><b>${b.label}</b><small>${b.desc}</small></button>`;
    }).join('');

    renderPilotCustom(t);

    $('#retreatBtns').innerHTML = HB.RETREAT.map(r =>
      `<button data-retreat="${r.value}" class="${t.retreat === r.value ? 'on' : ''}">${r.label}</button>`).join('');
  }

  function renderPilotCustom(t) {
    const el = $('#pilotCustom');
    el.hidden = t.behavior !== 'custom';
    if (el.hidden) return;
    const p = t.pilot = HB.sanitizePilot(t.pilot);
    el.innerHTML = Object.entries(HB.PILOT).map(([k, def]) =>
      `<div class="pc-row"><span>${def.label}</span><div class="seg" data-pk="${k}">${
        def.options.map(o => `<button data-pv="${o[0]}" class="${p[k] === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')
      }</div></div>`).join('');
  }

  function renderModules(t, R) {
    const el = $('#modules');
    if (!R.modules) { el.innerHTML = '<p class="hint">Modules are not allowed in this challenge.</p>'; return; }
    const unlocked = HB.unlockedModules();
    const left = HB.pointsLeft(t, R.budget);
    let html = '<div class="mod-slots">';
    for (let i = 0; i < HB.MAX_MODULES; i++) {
      const m = t.modules[i];
      if (m) {
        const d = HB.MODULES[m.id];
        const opts = HB.TRIGGER_ORDER.map(k => `<option value="${k}" ${m.trigger === k ? 'selected' : ''}>${HB.TRIGGERS[k].label}</option>`).join('');
        html += `<div class="mod-slot filled">
          <span class="mi">${d.icon}</span>
          <div class="mtxt">
            <div><b>${d.label}</b> <small>${d.cost} pts · ${d.uses ? 'once per battle' : 'recharges in ' + d.cooldown + ' s'}</small></div>
            <label class="when">Use when <select data-slot="${i}">${opts}</select></label>
          </div>
          <button class="mod-x" data-act="rmmod" data-slot="${i}" title="Remove this module">✕</button>
        </div>`;
      } else {
        html += `<button class="mod-slot empty ${state.picking === i ? 'on' : ''}" data-act="pick" data-slot="${i}">+ Add a module</button>`;
      }
    }
    html += '</div>';
    if (state.picking !== null && !t.modules[state.picking]) {
      html += '<div class="mod-picker">' + HB.MODULE_ORDER.filter(id => !t.modules.some(m => m.id === id)).map(id => {
        const d = HB.MODULES[id];
        const locked = !unlocked.has(id);
        const by = HB.moduleUnlockedBy(id);
        const afford = d.cost <= left;
        const tag = locked ? `🔒 Win challenge ${by ? by.index + 1 : '?'}` : afford ? `${d.cost} pts` : `${d.cost} pts · not enough points`;
        return `<button class="mod-card ${locked ? 'locked' : !afford ? 'poor' : ''}" data-mod="${id}" ${locked || !afford ? 'disabled' : ''}>
          <span class="mi">${d.icon}</span><b>${d.label}</b><small>${d.desc}</small><em>${tag}</em></button>`;
      }).join('') + '</div>';
    }
    el.innerHTML = html;
  }

  function renderDerived() {
    const t = cur(), R = rules();
    const d = HB.derive(t.stats);
    const a = HB.archetype(t.stats);
    $('#archetype').innerHTML = `${a.icon} ${a.label} <span class="mods-inline">${modIcons(t)}</span><small>${a.sub}</small>`;
    $('#derived').innerHTML = HB.DERIVED_VIEW.map(v => {
      const val = d[v.key];
      const pct = HB.clamp((val - v.min) / (v.max - v.min), 0, 1) * 100;
      return `<div class="drow ${v.invert ? 'inv' : ''}"><div class="top"><span>${v.label}</span><b>${v.fmt(d)}</b></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
    }).join('');
    $('#notes').innerHTML = notesFor(t, R).map(([k, s]) => `<li class="${k}">${s}</li>`).join('');
  }

  /* ---------------- Panneau droit : options ou objectifs ---------------- */
  function renderRight() {
    const ch = currentChallenge();
    $('#fieldOpts').hidden = !!ch;
    $('#objectives').hidden = !ch;
    $('#launch').textContent = ch ? 'START CHALLENGE ▶' : 'START BATTLE ▶';
    $('#mLaunch').textContent = ch ? 'START CHALLENGE ▶' : 'START BATTLE ▶';
    if (ch) {
      const flags = HB.progress.flags(ch.id);
      $('#objectives').innerHTML = `<h2>Objectives</h2>
        <ul class="objs">${ch.objectives.map((o, i) => `<li class="${flags[i] ? 'done' : ''}"><span class="star">★</span>${HB.objectiveText(o, ch)}</li>`).join('')}</ul>
        <p class="hint">Each objective earns a star. Stars are kept from one attempt to the next.</p>`;
    } else {
      const dens = [['faible', 'Sparse'], ['normale', 'Normal'], ['forte', 'Dense']];
      $('#densityBtns').innerHTML = dens.map(([k, l]) => `<button data-dens="${k}" class="${state.options.density === k ? 'on' : ''}">${l}</button>`).join('');
      $('#optPickups').checked = !!state.options.pickups;
      $('#optZone').checked = !!state.options.zone;
    }
  }

  /* ---------------- Écran des défis ---------------- */
  let resetArmed = false;
  function renderChallenges() {
    $('#chStars').textContent = `★ ${HB.progress.totalStars()} / ${HB.progress.maxStars()}`;
    const unlocked = HB.unlockedModules();
    $('#chGrid').innerHTML = HB.CHALLENGES.map((c, i) => {
      const open = HB.progress.isOpen(i);
      const flags = HB.progress.flags(c.id);
      const stars = flags.map(f => `<span class="${f ? 'on' : ''}">★</span>`).join('');
      const R = HB.challengeRules(c);
      const tags = [`⚔️ 1 vs ${c.enemies.length}`];
      if (R.budget !== HB.BUDGET) tags.push(`💰 ${R.budget} pts`);
      if (Object.keys(R.caps).length) tags.push('🚫 Limits');
      if (c.survive) tags.push(`⏱️ ${c.survive} s`);
      if (c.zoneStart != null && c.zoneStart < 60) tags.push(`☢️ ${c.zoneStart} s`);
      const rew = c.unlocks
        ? `<div class="ch-rew ${unlocked.has(c.unlocks) ? 'got' : ''}">🎁 ${HB.MODULES[c.unlocks].icon} ${HB.MODULES[c.unlocks].label}${unlocked.has(c.unlocks) ? ' ✓' : ''}</div>` : '';
      return `<button class="ch-card ${open ? '' : 'locked'} ${flags[0] ? 'won' : ''}" data-ch="${c.id}" ${open ? '' : 'disabled'}>
        <div class="ch-top"><span class="ch-n">${i + 1}</span><span class="ch-stars">${stars}</span></div>
        <b>${esc(c.name)}</b>
        <p>${esc(c.desc)}</p>
        <div class="ch-tags">${tags.map(x => `<span>${x}</span>`).join('')}</div>
        ${rew}
        ${open ? '' : `<div class="ch-lock">🔒 Win challenge ${i} first</div>`}
      </button>`;
    }).join('');
    $('#resetProgress').textContent = resetArmed ? 'Click again to confirm' : 'Reset progress';
    $('#resetProgress').hidden = HB.progress.unlockAll;
  }

  function openChallenge(cid) {
    const ch = HB.challengeById(cid);
    if (!ch) return;
    ensureChallengeTank(ch);
    state.mode = 'challenge';
    state.chId = cid;
    state.picking = null;
    setMTab('tanks');
    goScreen('garage');
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
      ctx.fillText(`${t.name} — ${HB.derive(t.stats).tons} tons ${modIcons(t)}`, cv.width / 2, cv.height - 7);
    }
    if (screen === 'garage') previewRaf = requestAnimationFrame(previewLoop);
  }

  /* ---------------- Événements du garage ---------------- */
  function markCustom() { cur().random = false; }

  function bindGarage() {
    $('#nav').addEventListener('click', e => {
      const b = e.target.closest('[data-nav]');
      if (!b) return;
      if (b.dataset.nav === 'free') { state.mode = 'free'; state.picking = null; setMTab('build'); goScreen('garage'); }
      else goScreen('challenges');
    });

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
        const r = HB.randomTank(state.roster.filter(o => o !== t));
        Object.assign(t, { stats: r.stats, modules: r.modules, behavior: r.behavior, pilot: r.pilot, retreat: r.retreat, random: true });
        state.sel = i;
      } else {
        state.sel = i;
      }
      state.picking = null;
      renderAll();
    });

    $('#briefing').addEventListener('click', e => {
      if (e.target.closest('[data-act="toChallenges"]')) goScreen('challenges');
    });

    $('#addCustom').addEventListener('click', () => {
      if (state.roster.length >= HB.MAX_TANKS) return;
      const r = HB.randomTank(state.roster);
      r.name = 'Player ' + (state.roster.length + 1);
      r.stats = { vitesse: 1, blindage: 1, puissance: 1, cadence: 1, portee: 1 };
      r.modules = [];
      r.behavior = 'flanqueur'; r.pilot = Object.assign({}, HB.DEFAULT_PILOT); r.retreat = 0.25; r.random = false;
      state.roster.push(r);
      state.sel = state.roster.length - 1;
      state.picking = null;
      renderAll();
      $('#tankName').focus();
      $('#tankName').select();
    });

    $('#addRandom').addEventListener('click', () => {
      if (state.roster.length >= HB.MAX_TANKS) return;
      state.roster.push(HB.randomTank(state.roster));
      state.sel = state.roster.length - 1;
      state.picking = null;
      renderAll();
    });

    $('#tankName').addEventListener('input', e => {
      cur().name = e.target.value.slice(0, 14) || 'Unnamed';
      if (state.mode === 'free') renderRoster();
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
      if (e.target.closest('.stat-label')) { row.classList.toggle('show-desc'); return; }
      const key = row.dataset.key, t = cur(), lvl = t.stats[key], R = rules();
      const act = e.target.closest('button')?.dataset.act;
      const pip = e.target.closest('i[data-lvl]');
      let target = null;
      if (act === 'inc') target = lvl + 1;
      else if (act === 'dec') target = lvl - 1;
      else if (pip) { const l = +pip.dataset.lvl; target = l === lvl ? l - 1 : l; }
      if (target !== null && HB.canSetLevel(t, key, target, R.budget, R.caps[key] || HB.MAX_LEVEL)) {
        t.stats[key] = target;
        markCustom();
        renderAll();
      }
    });

    $('#modules').addEventListener('click', e => {
      const t = cur(), R = rules();
      const b = e.target.closest('[data-act], [data-mod]');
      if (!b) return;
      if (b.dataset.act === 'pick') {
        const slot = +b.dataset.slot;
        state.picking = state.picking === slot ? null : slot;
      } else if (b.dataset.act === 'rmmod') {
        t.modules.splice(+b.dataset.slot, 1);
        state.picking = null;
        markCustom();
      } else if (b.dataset.mod) {
        const id = b.dataset.mod, d = HB.MODULES[id];
        if (t.modules.length >= HB.MAX_MODULES || d.cost > HB.pointsLeft(t, R.budget)) return;
        if (!HB.unlockedModules().has(id)) return;
        t.modules.push({ id, trigger: d.trigger });
        state.picking = null;
        markCustom();
      }
      renderAll();
    });

    $('#modules').addEventListener('change', e => {
      const sel = e.target.closest('select[data-slot]');
      if (!sel) return;
      const m = cur().modules[+sel.dataset.slot];
      if (m && HB.TRIGGERS[sel.value]) { m.trigger = sel.value; markCustom(); renderDerived(); renderLeft(); save(); }
    });

    $('#behaviors').addEventListener('click', e => {
      const b = e.target.closest('[data-beh]');
      if (!b || b.disabled) return;
      cur().behavior = b.dataset.beh;
      markCustom();
      renderAll();
    });

    $('#pilotCustom').addEventListener('click', e => {
      const b = e.target.closest('[data-pv]');
      if (!b) return;
      const k = b.closest('[data-pk]').dataset.pk;
      const t = cur();
      t.pilot = HB.sanitizePilot(t.pilot);
      t.pilot[k] = b.dataset.pv;
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

    $('#randomize').addEventListener('click', () => {
      const t = cur(), R = rules();
      t.stats = HB.randomStats(Math.random, R.budget - HB.modulesCost(t.modules), R.caps);
      renderAll();
    });
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

    const go = () => {
      if (state.mode === 'challenge') startChallenge();
      else startBattle((Math.random() * 1e9) >>> 0);
    };
    $('#launch').addEventListener('click', go);
    $('#mLaunch').addEventListener('click', go);
    $('#mtabs').addEventListener('click', e => {
      const b = e.target.closest('[data-mtab]');
      if (!b) return;
      setMTab(b.dataset.mtab);
      window.scrollTo(0, 0);
    });

    $('#chGrid').addEventListener('click', e => {
      const c = e.target.closest('[data-ch]');
      if (c && !c.disabled) openChallenge(c.dataset.ch);
    });
    $('#resetProgress').addEventListener('click', () => {
      if (!resetArmed) { resetArmed = true; renderChallenges(); setTimeout(() => { resetArmed = false; if (screen === 'challenges') renderChallenges(); }, 3000); return; }
      resetArmed = false;
      HB.progress.reset();
      renderAll();
    });
  }

  /* ---------------- Navigation ---------------- */
  function goScreen(id) {
    screen = id;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    $('#topbar').hidden = id === 'battle';
    cancelAnimationFrame(previewRaf);
    if (id === 'garage') previewRaf = requestAnimationFrame(previewLoop);
    if (id !== 'battle') renderAll();
    window.scrollTo(0, 0);
  }

  /* ---------------- Bataille ---------------- */
  let sbRows = [];
  let feedCount = 0;

  function launch(roster, opts, intro, mode) {
    gameMode = mode;
    save();
    goScreen('battle');
    $('#results').classList.add('hidden');
    $('#feed').innerHTML = '';
    feedCount = 0;
    if (game) game.destroy();
    // Téléphone : carte en portrait si tenu droit, moins de particules, caméra qui suit
    if (HB.isTouch) {
      opts.portrait = window.innerHeight > window.innerWidth;
      opts.lowFx = true;
      opts.followZoom = opts.portrait ? 1.7 : 1.6;
    }
    if (opts.focusIndex == null) opts.focusIndex = Math.max(0, roster.findIndex(t => !t.random));
    game = new HB.Game($('#battleCanvas'), roster, opts, { onHud: renderHud, onFeed: addFeed, onEnd: showResults, onHaptic });
    game.speed = state.speed || 1;
    if (HB.isTouch && game.focus) game.setFollow(game.focus);
    if (wantInside && game.focus) game.setInside(game.focus);
    $('#battleSide').classList.remove('open');
    buildScoreboard();
    setSpeedButtons();
    addFeed(intro);
    HB.sfx.unlock();
    HB.sfx.start();
    game.start();
    window.__game = game; // pratique pour déboguer dans la console
  }

  function startBattle(seed) {
    state.lastSeed = seed;
    const roster = state.roster.map(t => JSON.parse(JSON.stringify(t)));
    launch(roster, Object.assign({}, state.options, { seed }),
      `⚔️ ${roster.length} tanks on map #${seed}. May the best tank win!`, 'free');
  }

  function startChallenge() {
    const ch = currentChallenge();
    if (!ch) return;
    const me = JSON.parse(JSON.stringify(cur()));
    const enemies = ch.enemies.map(e => JSON.parse(JSON.stringify(e)));
    // Les ennemis font équipe contre le joueur, sauf dans les défis « chacun pour soi »
    me.team = ch.ffa ? null : 'player';
    for (const e of enemies) e.team = ch.ffa ? null : 'enemy';
    // Évite qu'un ennemi ait la même couleur que le joueur
    const taken = new Set([me.color, ...enemies.map(e => e.color)]);
    for (const e of enemies) {
      if (e.color === me.color) { const c = HB.COLORS.find(x => !taken.has(x)) || '#999999'; taken.add(c); e.color = c; }
    }
    const opts = {
      seed: ch.seed, density: ch.density || 'normale', pickups: ch.pickups !== false, zone: ch.zone !== false,
      zoneStart: ch.zoneStart, zoneDur: ch.zoneDur, survive: ch.survive, challenge: true, playerIndex: 0,
    };
    const idx = HB.challengeIndex(ch.id);
    launch([me, ...enemies], opts, `🏆 Challenge ${idx + 1} — ${esc(ch.name)}: ${HB.objectiveText(ch.objectives[0], ch).toLowerCase()}!`, 'challenge');
  }

  function buildScoreboard() {
    const sb = $('#scoreboard');
    sb.innerHTML = '';
    sbRows = game.tanks.map(t => {
      const row = document.createElement('div');
      row.className = 'sb-row' + (game.player === t ? ' me' : '');
      const b = HB.BEHAVIORS[t.cfg.behavior];
      row.innerHTML = `<span class="dot" style="background:${t.color}"></span>
        <div style="min-width:0"><div class="nm">${esc(t.name)}${game.player === t ? ' <span class="you">YOU</span>' : ''} <span class="muted" title="${b.label}">${b.icon}</span> <span class="mods"></span></div>
        <div class="hp"><i></i></div><div class="st"></div></div>
        <div class="k"></div>`;
      row.addEventListener('click', () => {
        game.selected = t.alive ? t : null;
        if (game.cam.mode === 'inside' && t.alive) game.setInside(t); // monter dans un autre tank
        renderHud(game);
      });
      sb.appendChild(row);
      return { t, row, hp: row.querySelector('.hp i'), st: row.querySelector('.st'), k: row.querySelector('.k'), mods: row.querySelector('.mods') };
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
      r.st.textContent = t.alive ? `${Math.ceil(t.hp)} HP · ${t.brain.shown}` : `Destroyed · ${ordinal(t.place)}`;
      r.k.innerHTML = `⚔ ${t.kills}<br><span class="muted">${Math.round(t.damageDealt)} dmg</span>`;
      r.mods.innerHTML = t.mods.map(m => `<span class="${m.cd <= 0 && m.uses > 0 ? 'ready' : ''}" title="${m.def.label}">${m.def.icon}</span>`).join('');
    }
    const alive = g.tanks.filter(t => t.alive).length;
    const f = g.focus;
    $('#sbSummary').textContent = `Tanks · ${alive}/${g.tanks.length} alive` + (f ? ` · ${f.name} ${f.alive ? Math.ceil(f.hp) + ' HP' : '💀'}` : '');
    $('#camBtn').classList.toggle('on', g.cam.mode === 'follow');
    $('#insideBtn').classList.toggle('on', g.cam.mode === 'inside');
    const cap = document.querySelector('#speedBtns button[data-speed="4"]');
    if (cap) {
      cap.classList.toggle('capped', g.cam.mode === 'inside');
      cap.title = g.cam.mode === 'inside' ? 'Speed ×4 (limited to ×2 in the inside view)' : 'Speed ×4 (3)';
    }
    const surv = g.options.survive;
    $('#clock').textContent = surv && !g.over ? fmtTime(Math.max(0, surv - g.time)) : fmtTime(g.time);
    const zi = $('#zoneInfo');
    if (g.over) { zi.textContent = '🏁 Battle over'; zi.classList.remove('hot'); }
    else if (surv) { zi.textContent = `⏱️ Survive ${Math.ceil(surv - g.time)} more seconds`; zi.classList.toggle('hot', surv - g.time < 10); }
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

  function resultRows(res) {
    return res.list.map((r, i) => {
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
  }

  function setResultButtons(mode, canNext) {
    const free = mode === 'free';
    $('#resReplay').hidden = $('#resNew').hidden = $('#resGarage').hidden = !free;
    $('#resRetry').hidden = $('#resEdit').hidden = $('#resList').hidden = free;
    $('#resNext').hidden = free || !canNext;
  }

  function showResults(res) {
    $('#resBody').innerHTML = resultRows(res);
    if (gameMode === 'challenge' && res.player) return showChallengeResults(res);
    const w = res.list[0];
    $('#resTitle').innerHTML = res.winner
      ? `🏆 <span style="color:${w.color}">${esc(res.winner)}</span> wins the battle!`
      : 'Draw';
    $('#resSub').textContent = `Duration: ${fmtTime(res.duration)} · map #${res.seed}`;
    $('#resStars').hidden = $('#resUnlock').hidden = true;
    setResultButtons('free');
    $('#results').classList.remove('hidden');
  }

  function showChallengeResults(res) {
    const ch = currentChallenge();
    const idx = HB.challengeIndex(ch.id);
    const p = res.player;
    const before = HB.progress.flags(ch.id).slice();
    const flags = HB.evalObjectives(ch, p);
    const rec = HB.progress.record(ch.id, flags);
    $('#resTitle').innerHTML = p.won
      ? (res.survived ? '🛡️ You held the line!' : '🏆 Victory!')
      : '💀 Defeat';
    $('#resSub').textContent = `Challenge ${idx + 1} · ${ch.name} · ${fmtTime(res.duration)}`;
    $('#resStars').innerHTML = ch.objectives.map((o, i) => {
      const got = flags[i], had = before[i];
      const cls = got && !had ? 'new' : (got || had) ? 'on' : '';
      return `<div class="rs ${cls}"><span class="star">★</span>${HB.objectiveText(o, ch)}${got && !had ? ' <em>New!</em>' : ''}</div>`;
    }).join('');
    $('#resStars').hidden = false;
    const notes = [];
    for (const id of rec.unlocked) {
      const m = HB.MODULES[id];
      notes.push(`🔓 New module unlocked: <b>${m.icon} ${m.label}</b>. Equip it in the garage!`);
    }
    if (rec.openedNext) notes.push(`➡️ Challenge ${idx + 2} is now open: <b>${esc(HB.CHALLENGES[idx + 1].name)}</b>`);
    $('#resUnlock').innerHTML = notes.map(n => `<div>${n}</div>`).join('');
    $('#resUnlock').hidden = !notes.length;
    if (rec.unlocked.length || rec.openedNext) setTimeout(() => HB.sfx.unlockJingle(), 900);
    setResultButtons('challenge', idx + 1 < HB.CHALLENGES.length && HB.progress.isOpen(idx + 1));
    $('#results').classList.remove('hidden');
    renderNav();
  }

  function leaveBattle(to) {
    if (game) { game.destroy(); game = null; }
    $('#results').classList.add('hidden');
    goScreen(to);
  }

  function bindBattle() {
    $('#speedBtns').addEventListener('click', e => {
      const b = e.target.closest('button[data-speed]');
      if (b) setSpeed(+b.dataset.speed);
    });
    $('#backGarage').addEventListener('click', () => leaveBattle('garage'));
    $('#resGarage').addEventListener('click', () => leaveBattle('garage'));
    $('#resReplay').addEventListener('click', () => startBattle(state.lastSeed));
    $('#resNew').addEventListener('click', () => startBattle((Math.random() * 1e9) >>> 0));
    $('#resRetry').addEventListener('click', () => startChallenge());
    $('#resEdit').addEventListener('click', () => leaveBattle('garage'));
    $('#resList').addEventListener('click', () => leaveBattle('challenges'));
    $('#resNext').addEventListener('click', () => {
      const idx = HB.challengeIndex(state.chId);
      const next = HB.CHALLENGES[idx + 1];
      if (!next) return;
      if (game) { game.destroy(); game = null; }
      $('#results').classList.add('hidden');
      openChallenge(next.id);
    });

    bindCanvas();
    $('#sbHandle').addEventListener('click', () => $('#battleSide').classList.toggle('open'));
    $('#camBtn').addEventListener('click', () => {
      if (!game) return;
      if (game.cam.mode === 'follow') game.overview();
      else game.setFollow(game.selected && game.selected.alive ? game.selected : game.focus);
      wantInside = false;
      renderHud(game);
    });
    $('#insideBtn').addEventListener('click', () => toggleInside());

    document.addEventListener('keydown', e => {
      if (screen !== 'battle' || !game) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') { e.preventDefault(); setSpeed(0); }
      else if (e.key === '1') setSpeed(1);
      else if (e.key === '2') setSpeed(2);
      else if (e.key === '3') setSpeed(4);
      else if (e.key === 'v' || e.key === 'V') toggleInside();
      else if (e.key === 'Escape') { if (game.cam.mode === 'inside') toggleInside(); else game.selected = null; }
    });
  }

  /* Vue intérieure : monter dans le tank sélectionné (sinon le sien), ou revenir à la carte */
  function toggleInside() {
    if (!game) return;
    const c = game.cam;
    if (c.mode === 'inside') {
      const t = c.follow && c.follow.alive ? c.follow : null;
      if (HB.isTouch && t) game.setFollow(t); else game.overview();
      wantInside = false;
    } else {
      const pick = [game.selected, game.focus, ...game.tanks].find(t => t && t.alive);
      if (!pick) return;
      game.setInside(pick);
      wantInside = true;
    }
    renderHud(game);
  }

  /* ---------------- Gestes sur la carte ----------------
   * Clic / toucher : sélectionner un tank (sur téléphone, la caméra le suit)
   * Pincer : zoomer · Glisser (zoomé) : se déplacer · Double toucher : vue d'ensemble */
  function bindCanvas() {
    const cv = $('#battleCanvas');
    const pts = new Map();
    let pinch = null, drag = null, lastTap = { t: 0, x: 0, y: 0 };
    const toCanvas = e => {
      const r = cv.getBoundingClientRect();
      return { x: (e.clientX - r.left) * HB.W / r.width, y: (e.clientY - r.top) * HB.H / r.height, k: HB.W / r.width };
    };
    cv.addEventListener('pointerdown', e => {
      if (!game) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      const p = toCanvas(e);
      pts.set(e.pointerId, p);
      if (game.cam.mode === 'inside') { drag = { x0: p.x, y0: p.y, last: p, t0: performance.now(), moved: false }; pinch = null; return; }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: game.cam.zoom, mid: game.toWorld((a.x + b.x) / 2, (a.y + b.y) / 2) };
        drag = null;
      } else if (pts.size === 1) {
        drag = { x0: p.x, y0: p.y, last: p, t0: performance.now(), moved: false };
      }
    });
    cv.addEventListener('pointermove', e => {
      if (!game || !pts.has(e.pointerId)) return;
      const p = toCanvas(e);
      pts.set(e.pointerId, p);
      const c = game.cam;
      if (c.mode === 'inside') { if (drag && Math.hypot(p.x - drag.x0, p.y - drag.y0) > 12 * p.k) drag.moved = true; return; }
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const z = HB.clamp(pinch.z0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0, 1, 3.5);
        if (c.mode === 'follow') { c.followZoom = c.targetZoom = c.zoom = z; }
        else if (z <= 1.02) { game.overview(); }
        else {
          c.mode = 'free'; c.zoom = z;
          c.x = pinch.mid.x - ((a.x + b.x) / 2 - HB.W / 2) / z;
          c.y = pinch.mid.y - ((a.y + b.y) / 2 - HB.H / 2) / z;
        }
        game.clampCam();
        return;
      }
      if (drag) {
        if (!drag.moved && Math.hypot(p.x - drag.x0, p.y - drag.y0) > 12 * p.k) drag.moved = true;
        if (drag.moved && c.zoom > 1.02) {
          c.mode = 'free'; c.follow = null;
          c.x -= (p.x - drag.last.x) / c.zoom;
          c.y -= (p.y - drag.last.y) / c.zoom;
          game.clampCam();
        }
        drag.last = p;
      }
    });
    cv.addEventListener('pointerup', e => {
      if (!game) return;
      const had = pts.delete(e.pointerId);
      if (pinch) { if (pts.size < 2) { pinch = null; drag = null; } return; }
      const d = drag;
      drag = null;
      if (!had || !d || d.moved || performance.now() - d.t0 > 800) return;
      const now = performance.now();
      if (game.cam.mode === 'inside') {
        // Vue intérieure : toucher le radar (ou toucher deux fois) ramène à la carte
        const r = game.cockpit && game.cockpit.radar;
        const onRadar = r && Math.hypot(d.x0 - r.x, d.y0 - r.y) < r.r * 1.15;
        if (onRadar || now - lastTap.t < 300) { toggleInside(); lastTap.t = 0; }
        else lastTap = { t: now, x: d.x0, y: d.y0 };
        return;
      }
      if (now - lastTap.t < 300 && Math.hypot(d.x0 - lastTap.x, d.y0 - lastTap.y) < 40 * d.last.k) {
        game.overview();
        lastTap.t = 0;
        renderHud(game);
        return;
      }
      lastTap = { t: now, x: d.x0, y: d.y0 };
      const w = game.toWorld(d.x0, d.y0);
      const t = game.pick(w.x, w.y);
      if (t && (HB.isTouch || game.cam.mode === 'follow')) game.setFollow(t);
      renderHud(game);
    });
    cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; drag = null; });
  }

  /* ---------------- Vibrations (téléphone) ---------------- */
  let lastVib = 0;
  function onHaptic(kind, tank) {
    if (!HB.isTouch || !game) return;
    flashFor(kind, tank);
    if (!navigator.vibrate || !HB.sfx.audible) return; // iPhone : pas de vibration possible
    const me = game.focus;
    let pattern = null;
    if (kind === 'hit' && tank === me) pattern = 25;
    else if (kind === 'kill') pattern = tank === me ? [80, 40, 140] : 30;
    else if (kind === 'win' && tank === me) pattern = [60, 40, 60, 40, 180];
    if (!pattern) return;
    const now = performance.now();
    if (kind !== 'win' && now - lastVib < 150) return;
    lastVib = now;
    try { navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  }

  /* ---------------- Éclair sur les bords de l'écran (téléphone) ----------------
   * Retour visuel quand TON tank est touché, détruit ou gagne. Complète la vibration
   * (Android) et la remplace là où elle n'existe pas (iPhone).
   * Au plus ~3 éclairs par seconde, et rien si l'appareil demande moins d'animations. */
  const FLASH = {
    hit:  { shadow: 'inset 0 0 70px 24px rgba(255, 40, 40, .95)', peak: 1, duration: 380 },
    kill: { shadow: 'inset 0 0 130px 46px rgba(255, 25, 25, 1)', peak: 1, duration: 900 },
    win:  { shadow: 'inset 0 0 90px 26px rgba(255, 200, 70, .9)', peak: 1, duration: 1400 },
  };
  let lastFlash = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function flashFor(kind, tank) {
    if (tank !== game.focus || !FLASH[kind] || reducedMotion.matches) return;
    const now = performance.now();
    if (kind === 'hit' && now - lastFlash < 340) return;
    lastFlash = now;
    const f = FLASH[kind], el = $('#hitFlash');
    if (kind === 'kill') game.shake = Math.max(game.shake, 18); // ton tank explose : grosse secousse
    el.style.boxShadow = f.shadow;
    if (el.animate) {
      el.animate([{ opacity: f.peak }, { opacity: 0 }], { duration: f.duration, easing: 'ease-out' });
    }
  }

  /* ---------------- Application installable (PWA) ---------------- */
  function setupPwa() {
    if (!/^https?:$/.test(location.protocol)) return; // rien en local (file://)
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { /* hébergement sans SW */ }); });
    }
    let deferred = null;
    window.addEventListener('beforeinstallprompt', e => {
      if (!HB.isTouch) return; // sur PC, on laisse le navigateur gérer
      e.preventDefault();
      deferred = e;
      $('#installBtn').hidden = false;
    });
    $('#installBtn').addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) { /* ignore */ }
      deferred = null;
      $('#installBtn').hidden = true;
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
      if ((e.target.tagName === 'INPUT' && e.target.type !== 'range') || e.target.tagName === 'SELECT') return;
      if (e.key === 'm' || e.key === 'M') { HB.sfx.unlock(); HB.sfx.toggleMute(); renderSound(); }
    });
    // Petit clic sur les boutons du garage et des défis
    for (const id of ['#garage', '#challenges', '#topbar']) {
      $(id).addEventListener('click', e => { if (e.target.closest('button, .pips i')) HB.sfx.click(); });
    }
  }

  /* ---------------- Démarrage ---------------- */
  setMTab('build');
  setupPwa();
  load();
  bindSound();
  renderSound();
  bindGarage();
  bindBattle();
  goScreen('garage');
})();
