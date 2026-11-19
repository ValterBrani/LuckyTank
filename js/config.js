'use strict';
/* =========================================================================
 * Hasard Battle — règles, budget et équilibrage
 * Tout ce qui touche à l'équilibrage du jeu est regroupé ici.
 * ========================================================================= */
const HB = window.HB = window.HB || {};

HB.BUDGET = 30;        // points à répartir par tank
HB.MAX_LEVEL = 10;     // niveau max d'une stat (min = 1, gratuit)

HB.STATS = [
  { key: 'vitesse',   label: 'Vitesse',   icon: '⚡', desc: 'Vitesse de déplacement et de rotation du châssis. Plus le tank est lourd, moins elle sert.' },
  { key: 'blindage',  label: 'Blindage',  icon: '🛡️', desc: 'Points de vie. Le blindage pèse lourd : il ralentit le tank.' },
  { key: 'puissance', label: 'Puissance', icon: '💥', desc: 'Dégâts par obus. Un gros canon pèse lourd, recharge plus lentement, tourne moins vite et ses obus sont plus lents.' },
  { key: 'cadence',   label: 'Cadence',   icon: '🔁', desc: 'Vitesse de rechargement du canon (freinée par la puissance).' },
  { key: 'portee',    label: 'Portée',    icon: '🎯', desc: 'Distance de tir et précision.' },
];

/* Coût croissant : les premiers niveaux sont bon marché, les derniers très chers.
 * Niveaux 2-4 : 1 pt, 5-7 : 2 pts, 8-10 : 3 pts  → une stat au max = 18 pts sur 30. */
HB.levelStepCost = l => (l <= 4 ? 1 : l <= 7 ? 2 : 3);
HB.levelTotalCost = L => { let c = 0; for (let l = 2; l <= L; l++) c += HB.levelStepCost(l); return c; };
HB.buildCost = stats => HB.STATS.reduce((s, st) => s + HB.levelTotalCost(stats[st.key]), 0);
HB.pointsLeft = stats => HB.BUDGET - HB.buildCost(stats);
HB.canSetLevel = (stats, key, level) => {
  if (level < 1 || level > HB.MAX_LEVEL) return false;
  const s = Object.assign({}, stats, { [key]: level });
  return HB.buildCost(s) <= HB.BUDGET;
};

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
  { key: 'maxHp',    label: 'Points de vie',  min: 92,  max: 245, fmt: d => Math.round(d.maxHp) },
  { key: 'speed',    label: 'Vitesse réelle', min: 30,  max: 172, fmt: d => Math.round(d.speed * 0.4) + ' km/h' },
  { key: 'damage',   label: 'Dégâts / obus',  min: 13,  max: 58,  fmt: d => Math.round(d.damage) },
  { key: 'fireRate', label: 'Cadence de tir', min: 0.3, max: 1.4, fmt: d => d.fireRate.toFixed(2) + ' tir/s' },
  { key: 'dps',      label: 'Dégâts / sec',   min: 5,   max: 50,  fmt: d => d.dps.toFixed(1) },
  { key: 'range',    label: 'Portée',         min: 218, max: 650, fmt: d => Math.round(d.range) + ' m' },
  { key: 'tons',     label: 'Poids',          min: 24,  max: 70,  fmt: d => d.tons + ' t', invert: true },
];

/* Comportements IA (gratuits : c'est la "personnalité" du pilote) */
HB.BEHAVIORS = {
  agressif:     { label: 'Bourrin',    icon: '🐗', distFactor: 0.40, target: 'nearest',
                  desc: "Fonce sur l'ennemi le plus proche, l'éperonne s'il a l'avantage et tire à travers les caisses." },
  tireur:       { label: 'Sniper',     icon: '🔭', distFactor: 0.88, target: 'nearest',
                  desc: "Reste au bout de sa portée et recule quand on l'approche." },
  flanqueur:    { label: 'Chasseur',   icon: '🌀', distFactor: 0.62, target: 'nearest',
                  desc: 'Tourne autour de sa cible en esquivant ses tirs.' },
  opportuniste: { label: 'Charognard', icon: '🦅', distFactor: 0.70, target: 'weakest',
                  desc: 'Achève les tanks les plus abîmés et ramasse les kits de réparation.' },
};

HB.RETREAT = [
  { value: 0,    label: 'Jamais' },
  { value: 0.25, label: 'Sous 25 % PV' },
  { value: 0.5,  label: 'Sous 50 % PV' },
];

HB.COLORS = ['#e8543f', '#3f8ee8', '#f2c230', '#4fc26b', '#b45ee8', '#f08a2c', '#35c9c1', '#e85ca8', '#cfd6dd', '#8a6d4b'];
HB.NAMES = ['Bulldozer', 'Vortex', 'Taupe', 'Mammouth', 'Frelon', 'Gargouille', 'Tonnerre', 'Renard',
            'Belette', 'Cyclone', 'Pétard', 'Grizzli', 'Mistral', 'Cafard', 'Bélier', 'Furet', 'Sanglier',
            'Pélican', 'Bourdon', 'Caïman', 'Zéphyr', 'Marmotte', 'Tornade', 'Scorpion'];

HB.MAX_TANKS = 8;
HB.MIN_TANKS = 2;

/* Répartition aléatoire du budget : poids aléatoires au carré → favorise les spécialistes */
HB.randomStats = (rng = Math.random) => {
  const s = {};
  HB.STATS.forEach(st => (s[st.key] = 1));
  const w = {};
  HB.STATS.forEach(st => (w[st.key] = 0.12 + rng() ** 2));
  for (let guard = 0; guard < 200; guard++) {
    const used = HB.buildCost(s);
    const affordable = HB.STATS.filter(st => s[st.key] < HB.MAX_LEVEL &&
      used + HB.levelStepCost(s[st.key] + 1) <= HB.BUDGET);
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

HB.randomTank = (roster = []) => {
  const usedNames = new Set(roster.map(t => t.name));
  const usedColors = new Set(roster.map(t => t.color));
  const names = HB.NAMES.filter(n => !usedNames.has(n));
  const colors = HB.COLORS.filter(c => !usedColors.has(c));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  return {
    id: HB.uid(),
    name: names.length ? pick(names) : 'Tank ' + (roster.length + 1),
    color: colors.length ? colors[0] : pick(HB.COLORS),
    stats: HB.randomStats(),
    behavior: HB.randomBehavior(),
    retreat: pick(HB.RETREAT).value,
    random: true,
  };
};

HB.uid = () => Math.random().toString(36).slice(2, 10);

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
