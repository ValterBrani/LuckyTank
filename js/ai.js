'use strict';
/* =========================================================================
 * Cerveau des tanks autonomes
 * Chaque tank décide seul : choix de cible, déplacement (A*), esquive, visée
 * avec anticipation, repli et ramassage de kits selon son comportement.
 * ========================================================================= */
(function () {
  const HB = window.HB;
  const { clamp, angDiff, dist } = HB;

  class Brain {
    constructor(tank) {
      this.t = tank;
      this.behKey = HB.BEHAVIORS[tank.cfg.behavior] ? tank.cfg.behavior : 'flanqueur';
      this.beh = HB.BEHAVIORS[this.behKey];
      this.target = null;
      this.retargetT = Math.random() * 0.3;
      this.path = null;
      this.pathGoal = null;
      this.pathT = 0;
      this.pathVersion = -1;
      this.strafeDir = Math.random() < 0.5 ? 1 : -1;
      this.strafeT = 2 + Math.random() * 2;
      this.stuckRef = { x: tank.x, y: tank.y };
      this.stuckClock = 0.7;
      this.stuckCount = 0;
      this.unstuckT = 0;
      this.unstuckTurn = 1;
      this.fleeGoal = null;
      this.fleeT = 0;
      this.wobble = 0;
      this.wobbleT = 0;
      this.state = 'Starting';
      this.wantMove = false;
    }

    update(dt, game) {
      const t = this.t, map = game.map, c = t.control;
      const enemies = game.tanks.filter(o => o.alive && o !== t);
      if (!enemies.length) {
        c.move = 0; c.turn = 0; c.fire = false;
        this.state = 'Victory!';
        return;
      }

      // ---------- 1. Choix de la cible ----------
      this.retargetT -= dt;
      if (this.retargetT <= 0 || !this.target || !this.target.alive) {
        this.retargetT = 0.5 + Math.random() * 0.3;
        this.target = this.chooseTarget(enemies, game);
      }
      const tg = this.target;
      const range = t.d.range;
      const dT = dist(t.x, t.y, tg.x, tg.y);
      const crateOk = this.behKey === 'agressif';
      const shotOnTarget = map.hasLos(t.x, t.y, tg.x, tg.y, !crateOk);

      // ---------- 2. Intention de déplacement ----------
      let goal = null, dir = null, allowReverse = false, speedScale = 1;
      const zone = game.zone;
      const inZone = (x, y, m = 0) => !zone.active || dist(x, y, zone.x, zone.y) < zone.r - m;
      const pickup = game.nearestPickup(t.x, t.y, p => inZone(p.x, p.y, 20));
      const hpR = t.hpRatio;
      const retreat = t.cfg.retreat || 0;
      const nearest = this.nearestEnemy(enemies);
      const threatened = nearest && dist(t.x, t.y, nearest.x, nearest.y) < nearest.d.range + 80;

      if (zone.active && !inZone(t.x, t.y, 30)) {
        goal = zone.safe; this.state = 'Escaping the zone';
      } else if (hpR < retreat && pickup) {
        goal = pickup; this.state = 'Going to repair';
      } else if (hpR < retreat && threatened) {
        goal = this.fleePoint(enemies, game, dt); this.state = 'Retreating';
      } else if (this.behKey === 'opportuniste' && pickup && hpR < 0.85 &&
                 dist(t.x, t.y, pickup.x, pickup.y) < dT) {
        goal = pickup; this.state = 'Grabbing a kit';
      } else {
        const desired = this.beh.distFactor * range;
        if (!shotOnTarget || dT > range * 0.95) {
          goal = tg; this.state = 'Chasing';
        } else {
          const toX = (tg.x - t.x) / dT, toY = (tg.y - t.y) / dT;
          const tanX = -toY * this.strafeDir, tanY = toX * this.strafeDir;
          switch (this.behKey) {
            case 'agressif':
              if (dT > desired) {
                // Charge en zigzag pour être plus dur à toucher
                const zig = Math.sin(game.time * 3.2 + t.index) * 0.7;
                dir = { x: toX + tanX * zig, y: toY + tanY * zig }; this.state = 'Charging';
              } else if (t.hpRatio >= tg.hpRatio * 0.9 || t.d.weight > tg.d.weight * 1.3) {
                dir = { x: toX, y: toY }; this.state = 'Ramming!';   // a l'avantage : il fonce dedans
              } else { dir = { x: tanX * 0.8 + toX * 0.15, y: tanY * 0.8 + toY * 0.15 }; speedScale = 0.75; allowReverse = true; this.state = 'Pounding'; }
              break;
            case 'tireur':
              if (dT < desired * 0.75) { dir = { x: -toX + tanX * 0.3, y: -toY + tanY * 0.3 }; allowReverse = true; this.state = 'Backing off'; }
              else if (dT > range * 0.92) { dir = { x: toX, y: toY }; speedScale = 0.5; this.state = 'Adjusting'; }
              else { dir = null; this.state = 'In position'; }
              break;
            default: { // flanqueur & opportuniste : orbite autour de la cible
              const radial = clamp((dT - desired) / desired, -1, 1) * 1.4;
              dir = { x: tanX + toX * radial, y: tanY + toY * radial };
              allowReverse = true;
              this.state = this.behKey === 'opportuniste' ? 'Harassing' : 'Circling';
            }
          }
        }
      }

      // Change de sens d'orbite de temps en temps (imprévisible)
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 1.8 + Math.random() * 2.5; if (Math.random() < 0.6) this.strafeDir *= -1; }

      // ---------- 3. Navigation ----------
      let dirAngle = null;
      if (goal) {
        dirAngle = this.followPath(goal, game, dt);
      } else if (dir) {
        dirAngle = this.avoid(Math.atan2(dir.y, dir.x), map);
        if (dirAngle === null) { this.strafeDir *= -1; dirAngle = null; }
      }

      // ---------- 4. Esquive des obus ----------
      const dodge = this.dodgeVector(game);
      if (dodge) {
        let vx = dodge.x * 1.6, vy = dodge.y * 1.6;
        if (dirAngle !== null) { vx += Math.cos(dirAngle); vy += Math.sin(dirAngle); }
        const a = this.avoid(Math.atan2(vy, vx), map);
        if (a !== null) { dirAngle = a; allowReverse = true; speedScale = 1; this.state = 'Dodging'; }
      }

      // ---------- 5. Pilotage ----------
      if (this.unstuckT > 0) {
        this.unstuckT -= dt;
        c.move = -0.8; c.turn = this.unstuckTurn;
        this.state = 'Getting unstuck';
      } else if (dirAngle !== null) {
        this.steer(dirAngle, allowReverse, speedScale);
      } else {
        c.move = 0; c.turn = 0;
      }
      this.wantMove = Math.abs(c.move) > 0.3;
      this.checkStuck(dt);

      // ---------- 6. Visée et tir ----------
      this.aimAndFire(enemies, game, dt, tg, crateOk);
    }

    chooseTarget(enemies, game) {
      const t = this.t;
      let best = null, bs = Infinity;
      for (const e of enemies) {
        const d = dist(t.x, t.y, e.x, e.y);
        let s = this.beh.target === 'weakest' ? e.hp * 1.5 + d * 0.35 : d;
        if (e === t.lastAttacker && game.time - t.lastHitT < 3) s *= 0.65; // riposte
        if (e === this.target) s *= 0.85; // garde sa cible (hystérésis)
        if (this.behKey === 'tireur' && game.map.hasLos(t.x, t.y, e.x, e.y)) s *= 0.7;
        if (s < bs) { bs = s; best = e; }
      }
      return best;
    }

    nearestEnemy(enemies) {
      const t = this.t;
      let best = null, bd = Infinity;
      for (const e of enemies) { const d = dist(t.x, t.y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
      return best;
    }

    /* Choisit un point sûr loin des ennemis (réévalué régulièrement) */
    fleePoint(enemies, game, dt) {
      const t = this.t;
      this.fleeT -= dt;
      if (!this.fleeGoal || this.fleeT <= 0 || dist(t.x, t.y, this.fleeGoal.x, this.fleeGoal.y) < 40) {
        this.fleeT = 2.5;
        let best = null, bs = -Infinity;
        for (let i = 0; i < 14; i++) {
          const p = game.map.randomFreePoint(Math.random, 1);
          if (game.zone.active && dist(p.x, p.y, game.zone.x, game.zone.y) > game.zone.r - 60) continue;
          let md = Infinity;
          for (const e of enemies) md = Math.min(md, dist(p.x, p.y, e.x, e.y));
          const s = md - 0.35 * dist(t.x, t.y, p.x, p.y);
          if (s > bs) { bs = s; best = p; }
        }
        this.fleeGoal = best || game.zone.safe;
      }
      return this.fleeGoal;
    }

    followPath(goal, game, dt) {
      const t = this.t, map = game.map;
      const dg = dist(t.x, t.y, goal.x, goal.y);
      if (dg < 420 && map.canDrive(t.x, t.y, goal.x, goal.y, 15)) {
        this.path = null;
        return Math.atan2(goal.y - t.y, goal.x - t.x);
      }
      this.pathT -= dt;
      const goalMoved = !this.pathGoal || dist(goal.x, goal.y, this.pathGoal.x, this.pathGoal.y) > 48;
      if (!this.path || this.pathT <= 0 || goalMoved || this.pathVersion !== map.version) {
        this.path = map.findPath(t.x, t.y, goal.x, goal.y);
        this.pathGoal = { x: goal.x, y: goal.y };
        this.pathT = 0.8 + Math.random() * 0.4;
        this.pathVersion = map.version;
      }
      const p = this.path;
      if (!p || !p.length) return Math.atan2(goal.y - t.y, goal.x - t.x);
      while (p.length > 1 && dist(t.x, t.y, p[0].x, p[0].y) < 18) p.shift();
      let wp = p[0];
      for (let i = Math.min(p.length - 1, 5); i > 0; i--) {
        if (map.canDrive(t.x, t.y, p[i].x, p[i].y, 13)) { wp = p[i]; break; }
      }
      return Math.atan2(wp.y - t.y, wp.x - t.x);
    }

    /* Évite les obstacles juste devant : essaie des angles de plus en plus écartés */
    avoid(angle, map) {
      const t = this.t;
      const offs = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.2, -2.2];
      for (const o of offs) {
        const a = angle + o;
        if (map.canDrive(t.x, t.y, t.x + Math.cos(a) * 34, t.y + Math.sin(a) * 34, 12)) return a;
      }
      return null;
    }

    /* Repère un obus qui va passer trop près et renvoie une direction d'esquive */
    dodgeVector(game) {
      const t = this.t;
      let best = null, bestT = Infinity;
      for (const s of game.shells) {
        if (!s.alive || s.owner === t) continue;
        const vv = s.vx * s.vx + s.vy * s.vy;
        const rx = t.x - s.x, ry = t.y - s.y;
        const tc = (rx * s.vx + ry * s.vy) / vv;
        if (tc < 0 || tc > 0.75) continue;
        const cx = s.x + s.vx * tc - t.x, cy = s.y + s.vy * tc - t.y;
        if (Math.hypot(cx, cy) > t.radius + s.r + 14) continue;
        if (tc < bestT) { bestT = tc; best = { s, cx, cy, vv }; }
      }
      if (!best) return null;
      const l = Math.sqrt(best.vv);
      let px = -best.s.vy / l, py = best.s.vx / l;
      if (px * best.cx + py * best.cy > 0) { px = -px; py = -py; }
      return { x: px, y: py };
    }

    steer(dirAngle, allowReverse, speedScale) {
      const t = this.t, c = t.control;
      let diff = angDiff(dirAngle, t.angle);
      let rev = false;
      if (allowReverse && Math.abs(diff) > 1.9) { rev = true; diff = angDiff(dirAngle + Math.PI, t.angle); }
      c.turn = clamp(diff * 3, -1, 1);
      let thr = Math.abs(diff) > 1.1 ? 0.12 : Math.max(0, Math.cos(diff));
      thr *= speedScale;
      c.move = rev ? -thr : thr;
    }

    checkStuck(dt) {
      const t = this.t;
      this.stuckClock -= dt;
      if (this.stuckClock > 0) return;
      this.stuckClock = 0.7;
      const moved = dist(t.x, t.y, this.stuckRef.x, this.stuckRef.y);
      this.stuckRef = { x: t.x, y: t.y };
      if (this.wantMove && moved < 6) this.stuckCount++;
      else this.stuckCount = 0;
      if (this.stuckCount >= 2) {
        this.stuckCount = 0;
        this.unstuckT = 0.55;
        this.unstuckTurn = Math.random() < 0.5 ? -1 : 1;
        this.path = null;
        this.strafeDir *= -1;
      }
    }

    aimAndFire(enemies, game, dt, tg, crateOk) {
      const t = this.t, c = t.control, map = game.map;
      const range = t.d.range;
      const canShoot = e => dist(t.x, t.y, e.x, e.y) <= range * 1.02 && map.hasLos(t.x, t.y, e.x, e.y, !crateOk);
      let aimT = canShoot(tg) ? tg : null;
      if (!aimT) {
        let bd = Infinity;
        for (const e of enemies) {
          const d = dist(t.x, t.y, e.x, e.y);
          if (d < bd && canShoot(e)) { bd = d; aimT = e; }
        }
      }
      this.wobbleT -= dt;
      if (this.wobbleT <= 0) { this.wobbleT = 0.3; this.wobble = (Math.random() * 2 - 1) * 0.015; }

      if (!aimT) {
        c.aim = Math.atan2(tg.y - t.y, tg.x - t.x); // pré-visée
        c.fire = false;
        this.aimTarget = null;
        return;
      }
      this.aimTarget = aimT;
      // Anticipation : où sera la cible quand l'obus arrivera ?
      const s = t.d.shellSpeed;
      const len = t.barrelLength();
      const mx = t.x + Math.cos(t.turret) * len, my = t.y + Math.sin(t.turret) * len;
      const px = aimT.x - mx, py = aimT.y - my;
      const a = aimT.vx * aimT.vx + aimT.vy * aimT.vy - s * s;
      const b = 2 * (px * aimT.vx + py * aimT.vy);
      const cc = px * px + py * py;
      let ti = Math.sqrt(cc) / s;
      const disc = b * b - 4 * a * cc;
      if (disc >= 0 && Math.abs(a) > 1e-6) {
        const r1 = (-b - Math.sqrt(disc)) / (2 * a), r2 = (-b + Math.sqrt(disc)) / (2 * a);
        const cands = [r1, r2].filter(x => x > 0);
        if (cands.length) ti = Math.min(...cands);
      }
      const ax = aimT.x + aimT.vx * ti, ay = aimT.y + aimT.vy * ti;
      c.aim = Math.atan2(ay - t.y, ax - t.x) + this.wobble;
      const d = dist(t.x, t.y, aimT.x, aimT.y);
      const tol = clamp(Math.atan2(aimT.radius * 0.8, d), 0.03, 0.15);
      c.fire = Math.abs(angDiff(c.aim, t.turret)) < tol;
    }
  }

  HB.Brain = Brain;
})();
