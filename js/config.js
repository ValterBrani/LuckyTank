'use strict';
/* =========================================================================
 * LuckyTank — règles, budget et équilibrage
 * Tout ce qui touche à l'équilibrage du jeu est regroupé ici.
 * ========================================================================= */
const HB = window.HB = window.HB || {};

HB.BUDGET = 30;        // points à répartir par tank
HB.MAX_LEVEL = 10;     // niveau max d'une stat (min = 1, gratuit)

HB.STATS = [
  { key: 'vitesse',   label: 'Speed',     icon: '⚡', desc: 'Movement and hull turning speed. The heavier the tank, the less it helps.' },
  { key: 'blindage',  label: 'Armor',     icon: '🛡️', desc: 'Hit points. Armor is heavy: it slows the tank down.' },
  { key: 'puissance', label: 'Firepower', icon: '💥', desc: 'Damage per shell. A big gun is heavy, reloads slower, turns slower and fires slower shells.' },
  { key: 'cadence',   label: 'Fire rate', icon: '🔁', desc: 'How fast the gun reloads (slowed down by firepower).' },
  { key: 'portee',    label: 'Range',     icon: '🎯', desc: 'Firing distance and accuracy.' },
];

/* Coût croissant : les premiers niveaux sont bon marché, les derniers très chers.
 * Niveaux 2-4 : 1 pt, 5-7 : 2 pts, 8-10 : 3 pts  → une stat au max = 18 pts sur 30. */
HB.levelStepCost = l => (l <= 4 ? 1 : l <= 7 ? 2 : 3);
HB.levelTotalCost = L => { let c = 0; for (let l = 2; l <= L; l++) c += HB.levelStepCost(l); return c; };
HB.buildCost = stats => HB.STATS.reduce((s, st) => s + HB.levelTotalCost(stats[st.key]), 0);

/* Coût total d'un tank = stats + modules. `t` = { stats, modules } */
HB.modulesCost = mods => (mods || []).reduce((s, m) => s + (HB.MODULES[m.id] ? HB.MODULES[m.id].cost : 0), 0);
HB.tankCost = t => HB.buildCost(t.stats) + HB.modulesCost(t.modules);
HB.pointsLeft = (t, budget = HB.BUDGET) => budget - HB.tankCost(t);
HB.canSetLevel = (t, key, level, budget = HB.BUDGET, cap = HB.MAX_LEVEL) => {
  if (level < 1 || level > Math.min(HB.MAX_LEVEL, cap)) return false;
  const stats = Object.assign({}, t.stats, { [key]: level });
  return HB.buildCost(stats) + HB.modulesCost(t.modules) <= budget;
};

/* =========================================================================
 * Modules : compétences actives. Elles coûtent des points du budget et le
 * pilote les déclenche seul, quand la condition choisie est remplie.
 * ========================================================================= */
HB.MAX_MODULES = 2;
HB.MODULES = {
  nitro:      { label: 'Nitro',            icon: '🚀', cost: 3, cooldown: 9,  duration: 2, trigger: 'incoming',
                desc: 'Speed ×1.9 for 2 s. Great for dodging or ramming.' },
  bouclier:   { label: 'Shield',           icon: '💠', cost: 4, cooldown: 13, duration: 3, trigger: 'incoming',
                desc: 'Blocks 65% of incoming damage for 3 s.' },
  mines:      { label: 'Mines',            icon: '💣', cost: 3, cooldown: 6, trigger: 'enemyClose',
                desc: 'Drops a mine behind the tank (45 damage). Up to 3 on the map.' },
  fumee:      { label: 'Smoke screen',     icon: '💨', cost: 2, cooldown: 12, duration: 5, trigger: 'targeted2',
                desc: 'A smoke cloud that blocks line of sight for 5 s.' },
  reparation: { label: 'Emergency repair', icon: '🔧', cost: 5, uses: 1, trigger: 'hp25',
                desc: 'Restores 45% of max HP. Once per battle.' },
  explosif:   { label: 'Explosive shell',  icon: '🎆', cost: 3, cooldown: 6, trigger: 'inSight',
                desc: 'The next shell explodes on impact and hurts everything around it.' },
};
HB.MODULE_ORDER = ['nitro', 'bouclier', 'mines', 'fumee', 'reparation', 'explosif'];

/* Conditions de déclenchement (le "programme" du pilote) */
HB.TRIGGERS = {
  ready:      { label: 'As soon as ready' },
  incoming:   { label: 'A shell is incoming' },
  hp50:       { label: 'HP below 50%' },
  hp25:       { label: 'HP below 25%' },
  enemyClose: { label: 'An enemy is close' },
  targeted2:  { label: '2+ enemies aim at me' },
  retreating: { label: 'While retreating' },
  chasing:    { label: 'While chasing' },
  inSight:    { label: 'Target in sight' },
};
HB.TRIGGER_ORDER = ['ready', 'incoming', 'hp50', 'hp25', 'enemyClose', 'targeted2', 'retreating', 'chasing', 'inSight'];

/* Stats dérivées : c'est ici que se jouent les compromis.
 *  - poids = blindage + puissance → réduit la vitesse et la maniabilité
 *  - puissance → rechargement plus long, tourelle plus lente, obus plus lents */
HB.derive = stats => {
  const v = stats.vitesse, b = stats.blindage, p = stats.puissance, c = stats.cadence, r = stats.portee;
  const weight = b * 1.3 + p * 1.1;                 // 2.4 → 24
  const weightFactor = 1 - weight * 0.019;          // 0.95 → 0.54
  const maxHp = 75 + b * 17;                        // 92 → 245
  const speed = Math.max(20, (40 + v * 14) * weightFactor);   // px/s
  const turnSpeed = (1.4 + v * 0.22) * Math.sqrt(weightFactor); // rad/s
  const damage = 8 + p * 5;                         // 13 → 58
  const reload = (2.3 - c * 0.16) * (1 + p * 0.035); // s
  const range = 170 + r * 48;                       // 218 → 650 px
  const shellSpeed = 560 - p * 10;                  // px/s
  const turretSpeed = 3.6 - p * 0.14;               // rad/s
  const spread = 0.09 - r * 0.007;                  // rad
  return {
    weight, weightFactor, maxHp, speed, turnSpeed, damage, reload, range,
    shellSpeed, turretSpeed, spread, fireRate: 1 / reload, dps: damage / reload,
    tons: Math.round(18 + weight * 2.4),
  };
};

/* Bornes pour afficher les jauges dans le garage */
HB.DERIVED_VIEW = [
  { key: 'maxHp',    label: 'Hit points',  min: 92,  max: 245, fmt: d => Math.round(d.maxHp) },
  { key: 'speed',    label: 'Actual speed', min: 30,  max: 172, fmt: d => Math.round(d.speed * 0.4) + ' km/h' },
  { key: 'damage',   label: 'Damage / shell',  min: 13,  max: 58,  fmt: d => Math.round(d.damage) },
  { key: 'fireRate', label: 'Fire rate',      min: 0.3, max: 1.4, fmt: d => d.fireRate.toFixed(2) + ' shots/s' },
  { key: 'dps',      label: 'Damage / sec',   min: 5,   max: 50,  fmt: d => d.dps.toFixed(1) },
  { key: 'range',    label: 'Range',         min: 218, max: 650, fmt: d => Math.round(d.range) + ' m' },
  { key: 'tons',     label: 'Weight',          min: 24,  max: 70,  fmt: d => d.tons + ' t', invert: true },
];

/* Comportements IA (gratuits : c'est la "personnalité" du pilote) */
HB.BEHAVIORS = {
  agressif:     { label: 'Bruiser',    icon: '🐗', distFactor: 0.40, target: 'nearest',
                  desc: 'Charges the nearest enemy, rams it when it has the upper hand and shoots through crates.' },
  tireur:       { label: 'Sniper',     icon: '🔭', distFactor: 0.88, target: 'nearest',
                  desc: 'Stays at the edge of its range and backs off when someone gets close.' },
  flanqueur:    { label: 'Flanker',    icon: '🌀', distFactor: 0.62, target: 'nearest',
                  desc: 'Circles around its target while dodging its shots.' },
  opportuniste: { label: 'Scavenger',  icon: '🦅', distFactor: 0.70, target: 'weakest',
                  desc: 'Finishes off the most damaged tanks and grabs repair kits.' },
  embusque:     { label: 'Ambusher',   icon: '🦊', distFactor: 0.45, target: 'nearest',
                  desc: 'Hides out of sight behind walls and crates, waits for an enemy to come close, then pounces.' },
  harceleur:    { label: 'Hit-and-run', icon: '🐝', distFactor: 0.80, target: 'nearest',
                  desc: 'Fires, backs off out of range while reloading, and comes back when the gun is ready.' },
  joueur:       { label: 'Gambler',    icon: '🎲', distFactor: 0.62, target: 'nearest',
                  desc: 'Switches to a random pilot style every 10 to 15 seconds. Nobody can predict it.' },
  custom:       { label: 'Custom',     icon: '🛠️', distFactor: 0.62, target: 'nearest',
                  desc: 'Your own pilot: choose its distance, its target and how it moves.' },
};

/* Styles entre lesquels le Gambler tire au sort */
HB.GAMBLE_STYLES = ['agressif', 'tireur', 'flanqueur', 'opportuniste', 'embusque', 'harceleur'];

/* Réglages du pilote Custom */
HB.PILOT = {
  dist:   { label: 'Distance', options: [['close', 'Close', 0.38], ['mid', 'Mid-range', 0.62], ['long', 'Long', 0.88]] },
  target: { label: 'Target',   options: [['nearest', 'Nearest'], ['weakest', 'Weakest'], ['dangerous', 'Most dangerous'], ['attacker', 'Last attacker']] },
  move:   { label: 'Movement', options: [['hold', 'Hold still'], ['circle', 'Circle'], ['zigzag', 'Zigzag']] },
};
HB.DEFAULT_PILOT = { dist: 'mid', target: 'nearest', move: 'circle' };
HB.sanitizePilot = p => {
  const out = {};
  for (const k of Object.keys(HB.PILOT)) {
    const v = p && p[k];
    out[k] = HB.PILOT[k].options.some(o => o[0] === v) ? v : HB.DEFAULT_PILOT[k];
  }
  return out;
};
HB.randomPilot = (rng = Math.random) => {
  const out = {};
  for (const k of Object.keys(HB.PILOT)) { const o = HB.PILOT[k].options; out[k] = o[Math.floor(rng() * o.length)][0]; }
  return out;
};
HB.PILOT_DIST = p => HB.PILOT.dist.options.find(o => o[0] === p.dist)[2];

HB.RETREAT = [
  { value: 0,    label: 'Never' },
  { value: 0.25, label: 'Below 25% HP' },
  { value: 0.5,  label: 'Below 50% HP' },
];

HB.COLORS = ['#e8543f', '#3f8ee8', '#f2c230', '#4fc26b', '#b45ee8', '#f08a2c', '#35c9c1', '#e85ca8', '#cfd6dd', '#8a6d4b'];
HB.NAMES = ['Bulldozer', 'Vortex', 'Mole', 'Mammoth', 'Hornet', 'Gargoyle', 'Thunder', 'Fox',
            'Weasel', 'Cyclone', 'Firecracker', 'Grizzly', 'Mistral', 'Cockroach', 'Ram', 'Ferret', 'Boar',
            'Pelican', 'Bumblebee', 'Caiman', 'Zephyr', 'Marmot', 'Tornado', 'Scorpion'];

HB.MAX_TANKS = 8;
HB.MIN_TANKS = 2;

/* Répartition aléatoire du budget : poids aléatoires au carré → favorise les spécialistes.
 * caps = niveau max par stat (contraintes des défis) */
HB.randomStats = (rng = Math.random, budget = HB.BUDGET, caps = {}) => {
  const s = {};
  HB.STATS.forEach(st => (s[st.key] = 1));
  const w = {};
  HB.STATS.forEach(st => (w[st.key] = 0.12 + rng() ** 2));
  for (let guard = 0; guard < 200; guard++) {
    const used = HB.buildCost(s);
    const affordable = HB.STATS.filter(st => s[st.key] < Math.min(HB.MAX_LEVEL, caps[st.key] || HB.MAX_LEVEL) &&
      used + HB.levelStepCost(s[st.key] + 1) <= budget);
    if (!affordable.length) break;
    let tot = 0;
    affordable.forEach(st => (tot += w[st.key]));
    let x = rng() * tot, picked = affordable[affordable.length - 1];
    for (const st of affordable) { x -= w[st.key]; if (x <= 0) { picked = st; break; } }
    s[picked.key]++;
  }
  return s;
};

HB.randomBehavior = (rng = Math.random) => {
  const keys = Object.keys(HB.BEHAVIORS);
  return keys[Math.floor(rng() * keys.length)];
};

/* Modules au hasard parmi ceux disponibles, avec leur condition par défaut */
HB.randomModules = (available, rng = Math.random) => {
  const pool = available.slice();
  const n = pool.length ? (rng() < 0.35 ? 0 : rng() < 0.7 ? 1 : 2) : 0;
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const id = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const trig = rng() < 0.75 ? HB.MODULES[id].trigger : HB.TRIGGER_ORDER[Math.floor(rng() * HB.TRIGGER_ORDER.length)];
    out.push({ id, trigger: trig });
  }
  return out;
};

/* opts.modules : liste des modules autorisés (par défaut : ceux débloqués) */
HB.randomTank = (roster = [], opts = {}) => {
  const usedNames = new Set(roster.map(t => t.name));
  const usedColors = new Set(roster.map(t => t.color));
  const names = HB.NAMES.filter(n => !usedNames.has(n));
  const colors = HB.COLORS.filter(c => !usedColors.has(c));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const available = opts.modules || (HB.unlockedModules ? [...HB.unlockedModules()] : []);
  const modules = HB.randomModules(available);
  return {
    id: HB.uid(),
    name: names.length ? pick(names) : 'Tank ' + (roster.length + 1),
    color: colors.length ? colors[0] : pick(HB.COLORS),
    stats: HB.randomStats(Math.random, HB.BUDGET - HB.modulesCost(modules)),
    modules,
    behavior: HB.randomBehavior(),
    pilot: HB.randomPilot(),
    retreat: pick(HB.RETREAT).value,
    random: true,
  };
};

HB.uid = () => Math.random().toString(36).slice(2, 10);

/* Deux tanks sont ennemis s'ils ne sont pas dans la même équipe (pas d'équipe = chacun pour soi) */
HB.isEnemy = (a, b) => a !== b && (!a.team || !b.team || a.team !== b.team);

/* Petits utilitaires mathématiques */
HB.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
HB.lerp = (a, b, t) => a + (b - a) * t;
HB.angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
HB.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

/* RNG déterministe (pour rejouer la même carte) */
HB.makeRng = seed => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
