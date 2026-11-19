'use strict';
/* =========================================================================
 * Campagne de défis : scénarios, objectifs (3 étoiles), progression
 * Chaque défi gagné (1 étoile minimum) débloque le suivant, et certains
 * débloquent un nouveau module.
 * ========================================================================= */
(function () {
  const HB = window.HB;
  const PROGRESS = 'hasardBattle.progress';

  // Raccourcis pour décrire les ennemis : stats = [vitesse, blindage, puissance, cadence, portée]
  const S = a => ({ vitesse: a[0], blindage: a[1], puissance: a[2], cadence: a[3], portee: a[4] });
  const E = (name, color, behavior, stats, modules = [], retreat = 0) => ({
    id: 'enemy-' + name.toLowerCase(), name, color, behavior, retreat,
    stats: S(stats), modules: modules.map(([id, trigger]) => ({ id, trigger: trigger || HB.MODULES[id].trigger })),
  });

  HB.CHALLENGES = [
    {
      id: 'c1', name: 'First Blood', seed: 1101, density: 'normale',
      desc: 'A simple duel against a Bruiser. Show it who is boss.',
      enemies: [E('Brutus', '#3f8ee8', 'agressif', [5, 5, 5, 4, 4])],
      objectives: [{ type: 'win' }, { type: 'hp', value: 0.5 }, { type: 'time', value: 35 }],
      unlocks: 'bouclier',
    },
    {
      id: 'c2', name: 'Sniper Alley', seed: 3303, density: 'faible',
      desc: 'An open field and two snipers with very long range. Find a way in.',
      enemies: [
        E('Hawk', '#b45ee8', 'tireur', [2, 2, 4, 2, 7]),
        E('Eagle', '#cfd6dd', 'tireur', [3, 2, 3, 2, 6]),
      ],
      objectives: [{ type: 'win' }, { type: 'time', value: 60 }, { type: 'hp', value: 0.3 }],
    },
    {
      id: 'c3', name: 'Speed Trap', seed: 2202, density: 'normale',
      desc: 'Two scouts zip around the map. Can you even hit them?',
      enemies: [
        E('Zip', '#f2c230', 'flanqueur', [6, 1, 2, 3, 2]),
        E('Zap', '#35c9c1', 'opportuniste', [6, 1, 2, 2, 2], [['nitro']]),
      ],
      objectives: [{ type: 'win' }, { type: 'accuracy', value: 0.45 }, { type: 'hp', value: 0.4 }],
      unlocks: 'mines',
    },
    {
      id: 'c4', name: 'Shoestring', seed: 4404, density: 'normale', budget: 20,
      desc: 'Only 20 points for your tank, against two tanks working together.',
      enemies: [
        E('Rusty', '#8a6d4b', 'flanqueur', [4, 3, 3, 3, 2]),
        E('Dusty', '#f08a2c', 'agressif', [3, 3, 4, 3, 2]),
      ],
      objectives: [{ type: 'win' }, { type: 'hp', value: 0.3 }, { type: 'time', value: 60 }],
    },
    {
      id: 'c5', name: 'Free-for-All', seed: 5505, density: 'normale', ffa: true,
      desc: 'Five tanks, one survivor. Everyone shoots at everyone.',
      enemies: [
        E('Viper', '#3f8ee8', 'flanqueur', [7, 4, 4, 5, 4]),
        E('Bison', '#8a6d4b', 'agressif', [3, 8, 6, 3, 3]),
        E('Owl', '#cfd6dd', 'tireur', [4, 4, 5, 4, 7]),
        E('Jackal', '#f2c230', 'opportuniste', [6, 5, 4, 5, 4], [['nitro']]),
        E('Wasp', '#e85ca8', 'flanqueur', [6, 3, 3, 8, 4]),
      ],
      objectives: [{ type: 'win' }, { type: 'kills', value: 3 }, { type: 'hp', value: 0.25 }],
      unlocks: 'fumee',
    },
    {
      id: 'c6', name: 'Paper Armor', seed: 6606, density: 'forte', caps: { blindage: 1 },
      desc: 'No armor allowed. Three Bruisers want to ram you.',
      enemies: [
        E('Ram', '#e8543f', 'agressif', [3, 2, 3, 2, 2]),
        E('Bull', '#f08a2c', 'agressif', [3, 2, 3, 2, 2]),
        E('Goat', '#cfd6dd', 'agressif', [3, 2, 3, 2, 2]),
      ],
      objectives: [{ type: 'win' }, { type: 'time', value: 50 }, { type: 'accuracy', value: 0.4 }],
    },
    {
      id: 'c7', name: 'Hold the Line', seed: 7707, density: 'forte', survive: 75, zone: false, ffa: true,
      desc: 'Six tanks in a free-for-all, no death zone. Stay alive for 75 seconds.',
      enemies: [
        E('Alpha', '#3f8ee8', 'agressif', [6, 5, 4, 4, 3]),
        E('Bravo', '#4fc26b', 'flanqueur', [7, 4, 4, 5, 3]),
        E('Charlie', '#f2c230', 'tireur', [3, 4, 5, 3, 8]),
        E('Delta', '#b45ee8', 'opportuniste', [5, 5, 5, 4, 4]),
        E('Echo', '#35c9c1', 'flanqueur', [6, 4, 3, 7, 4]),
        E('Foxtrot', '#e85ca8', 'agressif', [4, 7, 6, 3, 3]),
      ],
      objectives: [{ type: 'survive' }, { type: 'kills', value: 2 }, { type: 'hp', value: 0.5 }],
      unlocks: 'reparation',
    },
    {
      id: 'c8', name: 'Zone Rush', seed: 8808, density: 'normale', zoneStart: 8, zoneDur: 40,
      desc: 'The death zone starts closing after 8 seconds. Fight fast or burn.',
      enemies: [
        E('Ember', '#e8543f', 'agressif', [4, 3, 3, 3, 2]),
        E('Ash', '#cfd6dd', 'tireur', [3, 2, 3, 2, 4]),
        E('Cinder', '#f08a2c', 'flanqueur', [4, 2, 3, 3, 2], [['nitro', 'retreating']]),
      ],
      objectives: [{ type: 'win' }, { type: 'hp', value: 0.4 }, { type: 'time', value: 40 }],
    },
    {
      id: 'c9', name: 'The Hunters', seed: 9909, density: 'forte',
      desc: 'A pack of three Flankers with modules. They circle, they dodge, they hide.',
      enemies: [
        E('Lynx', '#4fc26b', 'flanqueur', [4, 2, 2, 2, 2], [['nitro']]),
        E('Puma', '#f2c230', 'flanqueur', [3, 2, 3, 2, 2], [['fumee']]),
        E('Ocelot', '#35c9c1', 'flanqueur', [3, 2, 3, 2, 2], [['bouclier']]),
      ],
      objectives: [{ type: 'win' }, { type: 'hp', value: 0.25 }, { type: 'kills', value: 3 }],
      unlocks: 'explosif',
    },
    {
      id: 'c10', name: 'Goliath', seed: 10010, density: 'normale',
      desc: 'The final boss: a 38-point monster with a shield and a repair kit. One on one.',
      enemies: [
        E('Goliath', '#8a6d4b', 'agressif', [4, 8, 6, 4, 5], [['bouclier', 'hp50'], ['reparation', 'hp25']]),
      ],
      objectives: [{ type: 'win' }, { type: 'hp', value: 0.3 }, { type: 'time', value: 90 }],
    },
  ];

  HB.challengeById = id => HB.CHALLENGES.find(c => c.id === id);
  HB.challengeIndex = id => HB.CHALLENGES.findIndex(c => c.id === id);

  /* Règles qui s'appliquent au tank du joueur pendant un défi */
  HB.challengeRules = ch => ({
    budget: ch.budget || HB.BUDGET,
    caps: ch.caps || {},
    behaviors: ch.behaviors || null,
    modules: ch.noModules ? false : true,
  });

  HB.objectiveText = (o, ch) => {
    switch (o.type) {
      case 'win': return 'Win the battle';
      case 'survive': return `Survive ${ch.survive} seconds`;
      case 'hp': return `Finish with at least ${Math.round(o.value * 100)}% HP`;
      case 'time': return `Win in under ${o.value} seconds`;
      case 'kills': return `Destroy at least ${o.value} tank${o.value > 1 ? 's' : ''}`;
      case 'accuracy': return `Win with at least ${Math.round(o.value * 100)}% accuracy`;
      default: return o.type;
    }
  };

  /* r = { won, hp (0-1), time, kills, accuracy (0-1) } → objectifs atteints */
  HB.evalObjectives = (ch, r) => ch.objectives.map((o, i) => {
    if (!r.won) return false;
    switch (o.type) {
      case 'win': case 'survive': return true;
      case 'hp': return r.hp >= o.value;
      case 'time': return r.time <= o.value;
      case 'kills': return r.kills >= o.value;
      case 'accuracy': return r.accuracy >= o.value;
      default: return i === 0;
    }
  });

  /* ---------------- Progression (localStorage) ---------------- */
  const prog = { done: {} }; // done[cid] = [bool, bool, bool]
  try {
    const d = JSON.parse(localStorage.getItem(PROGRESS) || '{}');
    if (d && d.done) prog.done = d.done;
  } catch (e) { /* ignore */ }
  const saveProg = () => { try { localStorage.setItem(PROGRESS, JSON.stringify(prog)); } catch (e) { /* ignore */ } };

  // Pour tester : ouvrir index.html?unlockall (ou index.html#unlockall) débloque tous les défis et modules
  const UNLOCK_ALL = /[?&]unlockall\b/.test(location.search) || location.hash === '#unlockall';

  HB.progress = {
    flags: cid => prog.done[cid] || [false, false, false],
    stars: cid => (prog.done[cid] || []).filter(Boolean).length,
    totalStars: () => HB.CHALLENGES.reduce((s, c) => s + HB.progress.stars(c.id), 0),
    maxStars: () => HB.CHALLENGES.length * 3,
    isOpen: idx => UNLOCK_ALL || idx === 0 || HB.progress.stars(HB.CHALLENGES[idx - 1].id) > 0,
    /* Enregistre un résultat ; renvoie ce qui est nouveau */
    record(cid, flags) {
      const before = HB.unlockedModules();
      const old = HB.progress.flags(cid);
      const merged = old.map((v, i) => v || !!flags[i]);
      const newStars = merged.filter(Boolean).length - old.filter(Boolean).length;
      prog.done[cid] = merged;
      saveProg();
      const after = HB.unlockedModules();
      const unlocked = [...after].filter(m => !before.has(m));
      const idx = HB.challengeIndex(cid);
      const openedNext = merged[0] && !old[0] && idx + 1 < HB.CHALLENGES.length;
      return { newStars, unlocked, openedNext };
    },
    reset() { prog.done = {}; saveProg(); },
    unlockAll: UNLOCK_ALL,
  };

  /* Modules débloqués : la Nitro d'office, puis un par défi récompensé */
  HB.unlockedModules = () => {
    if (UNLOCK_ALL) return new Set(HB.MODULE_ORDER);
    const set = new Set(['nitro']);
    for (const c of HB.CHALLENGES) if (c.unlocks && HB.progress.stars(c.id) > 0) set.add(c.unlocks);
    return set;
  };

  /* Quel défi débloque ce module ? (pour l'afficher sur les modules verrouillés) */
  HB.moduleUnlockedBy = id => {
    const i = HB.CHALLENGES.findIndex(c => c.unlocks === id);
    return i >= 0 ? { index: i, challenge: HB.CHALLENGES[i] } : null;
  };
})();
