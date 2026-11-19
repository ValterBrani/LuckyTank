'use strict';
/* =========================================================================
 * Moteur de bataille : boucle, obus, effets, kits, zone mortelle, rendu
 * ========================================================================= */
(function () {
  const HB = window.HB;
  const { clamp, dist, lerp } = HB;
  const T = HB.T;

  class Game {
    constructor(canvas, roster, options, callbacks = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.options = Object.assign({ seed: 1, density: 'normale', pickups: true, zone: true }, options);
      HB.setOrientation(!!this.options.portrait);
      canvas.width = HB.W;
      canvas.height = HB.H;
      this.cb = callbacks;
      this.map = new HB.GameMap(this.options.seed, this.options.density, roster.length);
      const mrng = this.map.rng;

      this.tanks = roster.map((cfg, i) => {
        const sp = this.map.spawns[i] || this.map.randomFreePoint();
        const ang = Math.atan2(HB.H / 2 - sp.y, HB.W / 2 - sp.x);
        return new HB.Tank(cfg, sp.x, sp.y, ang, i);
      });
      this.shells = [];
      this.particles = [];
      this.pickups = [];
      this.texts = [];
      this.smokes = [];
      this.mines = [];
      this.player = this.options.challenge ? this.tanks[this.options.playerIndex || 0] : null;
      this.survived = false;
      this.time = 0;
      this.speed = 1;
      this.paused = false;
      this.over = false;
      this.endFired = false;
      this.endTimer = 0;
      this.winner = null;
      this.acc = 0;
      this.hudT = 0;
      this.shake = 0;
      this.selected = null;
      this.pickupT = 7 + mrng() * 4;
      // Tank "à soi" (défi : le joueur ; libre : le premier tank perso) → caméra et vibrations
      this.focus = this.player || this.tanks[this.options.focusIndex || 0] || null;
      // Caméra : zoom 1 centré = vue d'ensemble (rendu identique à avant)
      this.cam = { mode: 'overview', zoom: 1, targetZoom: 1, followZoom: this.options.followZoom || 1.7, x: HB.W / 2, y: HB.H / 2, follow: null };
      this.maxParticles = this.options.lowFx ? 350 : Infinity;

      const zx = HB.W / 2 + (mrng() - 0.5) * HB.W * 0.25, zy = HB.H / 2 + (mrng() - 0.5) * HB.H * 0.25;
      const sc = this.map.nearestFreeCell(zx, zy);
      const maxR = Math.hypot(HB.W, HB.H) * 0.62;
      this.zone = {
        active: false, x: zx, y: zy, r: maxR, maxR, minR: 105,
        start: this.options.zoneStart ?? 60, dur: this.options.zoneDur ?? 70, safe: this.map.center(sc.cx, sc.cy),
      };

      if (!this.options.headless) this.buildLayers(); // headless : simulation sans rendu (tests d'équilibrage)
      this.frame = this.frame.bind(this);
    }

    /* ---------------- Boucle ---------------- */
    start() {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }

    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.raf);
    }

    frame(ts) {
      if (this.destroyed) return;
      const dt = Math.min(0.05, (ts - this.last) / 1000);
      this.last = ts;
      if (!this.paused) {
        this.acc += dt * this.speed;
        const step = 1 / 60;
        let n = 0;
        while (this.acc >= step && n < 12) { this.update(step); this.acc -= step; n++; }
        if (n >= 12) this.acc = 0;
      }
      this.updateCamera(dt);
      this.render();
      this.hudT -= dt;
      if (this.hudT <= 0) { this.hudT = 0.1; this.cb.onHud && this.cb.onHud(this); }
      this.raf = requestAnimationFrame(this.frame);
    }

    update(dt) {
      this.time += dt;
      const z = this.zone;

      // Zone mortelle qui rétrécit
      if (this.options.zone && this.time > z.start) {
        if (!z.active) { z.active = true; this.feed('☢️ The death zone is closing in!', 'warn'); HB.sfx.alarm(); }
        const k = clamp((this.time - z.start) / z.dur, 0, 1);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        z.r = lerp(z.maxR, z.minR, e);
      }

      // Kits de réparation
      if (this.options.pickups) {
        this.pickupT -= dt;
        if (this.pickupT <= 0) {
          this.pickupT = 9 + Math.random() * 8;
          if (this.pickups.length < 3) {
            for (let i = 0; i < 10; i++) {
              const p = this.map.randomFreePoint(Math.random, 1);
              if (!z.active || dist(p.x, p.y, z.x, z.y) < z.r - 60) { this.spawnPickup(p.x, p.y); break; }
            }
          }
        }
      }

      for (const t of this.tanks) t.update(dt, this);

      // Collisions entre tanks
      const alive = this.tanks.filter(t => t.alive);
      for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
        const min = a.radius + b.radius;
        if (d < min) {
          const push = (min - d) / 2, nx = dx / d, ny = dy / d;
          this.ram(a, b, nx, ny);
          // le plus lourd pousse le plus léger
          const wa = a.d.weight, wb = b.d.weight, ka = wb / (wa + wb), kb = wa / (wa + wb);
          a.x -= nx * push * 2 * ka; a.y -= ny * push * 2 * ka;
          b.x += nx * push * 2 * kb; b.y += ny * push * 2 * kb;
          a.collideMap(this.map); b.collideMap(this.map);
        }
      }

      // Dégâts de zone
      if (z.active) {
        const k = clamp((this.time - z.start) / z.dur, 0, 1);
        const dps = 6 + k * 14;
        for (const t of alive) {
          if (!t.alive) continue;
          if (dist(t.x, t.y, z.x, z.y) > z.r) {
            t.takeDamage(dps * dt, null, this);
            if (Math.random() < dt * 6) this.particles.push(this.smoke(t.x, t.y, '#a23', 0.6));
          }
        }
      }

      // Ramassage des kits
      for (const p of this.pickups) {
        if (!p.alive) continue;
        p.t += dt;
        for (const t of this.tanks) {
          if (!t.alive || dist(t.x, t.y, p.x, p.y) > t.radius + 10) continue;
          const healed = t.heal(t.d.maxHp * 0.35);
          p.alive = false;
          HB.sfx.pickup(p.x);
          this.text(t.x, t.y - 26, '+' + Math.round(healed), '#5f5');
          for (let i = 0; i < 14; i++) this.particles.push(this.spark(p.x, p.y, '#6f6', 120));
          break;
        }
      }
      this.pickups = this.pickups.filter(p => p.alive);

      this.updateShells(dt);
      this.updateModules(dt);

      for (const p of this.particles) {
        p.life -= dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt;
        p.rot += (p.vr || 0) * dt;
        if (p.grow) p.size += p.grow * dt;
      }
      this.particles = this.particles.filter(p => p.life > 0);
      if (this.particles.length > this.maxParticles) this.particles.splice(0, this.particles.length - this.maxParticles);
      for (const tx of this.texts) { tx.life -= dt; tx.y -= 22 * dt; }
      this.texts = this.texts.filter(tx => tx.life > 0);

      // Les épaves fument
      for (const t of this.tanks) {
        if (!t.alive && this.time - t.deathTime < 12 && Math.random() < dt * 5) {
          this.particles.push(this.smoke(t.x + (Math.random() - 0.5) * 10, t.y + (Math.random() - 0.5) * 10, '#333', 1.6));
        }
      }
      this.shake = Math.max(0, this.shake - dt * 30);

      // Fin de partie
      const left = this.tanks.filter(t => t.alive);
      const sides = new Set(left.map(t => t.team || t)); // une équipe = un camp
      let end = sides.size <= 1;
      const P = this.player;
      if (P && !P.alive) end = true;                                   // défi : le joueur est détruit
      if (P && this.options.survive && P.alive && this.time >= this.options.survive) { end = true; this.survived = true; }
      if (!this.over && end) {
        this.over = true;
        this.endTimer = 2.8;
        if (this.survived) this.winner = P;
        else if (P && !P.alive) this.winner = null;
        else if (left.length >= 1 && sides.size === 1) this.winner = (P && P.alive) ? P : left.slice().sort((a, b) => b.hp - a.hp)[0];
        else if (left.length === 0) this.winner = this.tanks.find(t => t.place === 1) || null;
        else this.winner = null;
        // Places des survivants : le vainqueur d'abord, puis par PV restants
        left.slice().sort((a, b) => (b === this.winner) - (a === this.winner) || b.hp - a.hp).forEach((t, i) => { t.place = i + 1; });
        if (this.winner && (!P || this.winner === P)) this.haptic('win', this.winner);
        if (this.survived) {
          this.feed(`🛡️ <b style="color:${P.color}">${esc(P.name)}</b> held the line for ${this.options.survive} s!`, 'win');
          setTimeout(() => { if (!this.destroyed) HB.sfx.victory(); }, 500);
        } else if (this.winner) {
          this.feed(`🏆 <b style="color:${this.winner.color}">${esc(this.winner.name)}</b> wins the battle!`, 'win');
          if (!P || this.winner === P) setTimeout(() => { if (!this.destroyed) HB.sfx.victory(); }, 500);
        } else if (P && !P.alive) {
          this.feed(`💀 <b style="color:${P.color}">${esc(P.name)}</b> was destroyed. Challenge failed.`, 'warn');
        }
      }
      if (this.over) {
        this.endTimer -= dt;
        if (this.winner && this.winner.alive && Math.random() < dt * 25) {
          const cols = ['#ffd84a', '#ff6b6b', '#6bd5ff', '#8cff6b', '#fff'];
          const p = this.spark(this.winner.x, this.winner.y - 10, cols[(Math.random() * cols.length) | 0], 220);
          p.vy -= 120; p.drag = 1.2; p.life = p.maxLife = 1.4; p.size = 3; p.confetti = true;
          this.particles.push(p);
        }
        if (this.endTimer <= 0 && !this.endFired) {
          this.endFired = true;
          this.cb.onEnd && this.cb.onEnd(this.results());
        }
      }
    }

    updateShells(dt) {
      for (const s of this.shells) {
        if (!s.alive) continue;
        const stepLen = Math.hypot(s.vx, s.vy) * dt;
        const n = Math.max(1, Math.ceil(stepLen / 5));
        s.trail.push({ x: s.x, y: s.y });
        if (s.trail.length > 6) s.trail.shift();
        for (let i = 0; i < n && s.alive; i++) {
          s.x += s.vx * dt / n;
          s.y += s.vy * dt / n;
          s.traveled += stepLen / n;
          const cx = Math.floor(s.x / HB.CELL), cy = Math.floor(s.y / HB.CELL);
          const cell = this.map.cell(cx, cy);
          if (cell === T.WALL) { this.impact(s, false, null); break; }
          if (cell === T.CRATE) {
            const destroyed = this.map.damageCrate(cx, cy, s.dmg);
            this.impact(s, false, null);
            if (destroyed) this.crateBroken(cx, cy);
            break;
          }
          for (const t of this.tanks) {
            if (!t.alive || !HB.isEnemy(s.owner, t)) continue; // traverse les alliés
            if (dist(s.x, s.y, t.x, t.y) < t.radius + s.r) {
              s.owner.hits++;
              const real = t.takeDamage(s.dmg, s.owner, this);
              s.owner.damageDealt += real;
              this.text(t.x + (Math.random() - 0.5) * 10, t.y - 22, '-' + Math.round(real), t.shieldT > 0 ? '#9fd8ff' : '#ffd0c0');
              this.impact(s, true, t);
              break;
            }
          }
          if (s.alive && s.traveled > s.maxDist) {
            s.alive = false;
            for (let k = 0; k < 4; k++) this.particles.push(this.smoke(s.x, s.y, '#bba', 0.5));
          }
        }
      }
      this.shells = this.shells.filter(s => s.alive);
    }

    /* Éperonnage : un choc rapide fait des dégâts, surtout si l'agresseur est lourd */
    ram(a, b, nx, ny) {
      const va = a.vx * nx + a.vy * ny;       // vitesse de a vers b
      const vb = -(b.vx * nx + b.vy * ny);    // vitesse de b vers a
      const closing = va + vb;
      if (!HB.isEnemy(a, b) || closing < 45 || this.time - a.ramT < 0.6 || this.time - b.ramT < 0.6) return;
      a.ramT = b.ramT = this.time;
      HB.sfx.ram(closing / 200, (a.x + b.x) / 2);
      const rammer = va >= vb ? a : b, other = rammer === a ? b : a;
      const sign = rammer === a ? 1 : -1;
      const k = closing * 0.15;
      const dOther = k * (0.5 + rammer.d.weight / 10);
      const dRammer = k * 0.5 * (0.5 + other.d.weight / 10);
      const dealt = other.takeDamage(dOther, rammer, this);
      rammer.damageDealt += dealt;
      this.text(other.x, other.y - 22, '-' + Math.round(dOther), '#ffb0a0');
      if (rammer.alive) rammer.takeDamage(dRammer, other, this);
      // rebond
      const kb = closing * 0.7;
      rammer.vx -= nx * sign * kb; rammer.vy -= ny * sign * kb;
      other.vx += nx * sign * kb * 0.6; other.vy += ny * sign * kb * 0.6;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      for (let i = 0; i < 12; i++) this.particles.push(this.spark(mx, my, '#ffe3a0', 180));
      this.shake = Math.max(this.shake, 3 + closing / 40);
    }

    /* ---------------- Modules ---------------- */
    activateModule(t, m) {
      const d = m.def;
      m.cd = d.cooldown || 9999;
      if (d.uses) m.uses--;
      t.modUses++;
      switch (m.id) {
        case 'nitro': t.nitroT = d.duration; break;
        case 'bouclier': t.shieldT = d.duration; break;
        case 'mines': this.dropMine(t); break;
        case 'fumee': this.smokes.push(this.makeSmoke(t.x, t.y, d.duration)); break;
        case 'reparation': {
          const h = t.heal(t.d.maxHp * 0.45);
          this.text(t.x, t.y - 26, '+' + Math.round(h), '#5f5');
          for (let i = 0; i < 18; i++) this.particles.push(this.spark(t.x, t.y, '#6f6', 140));
          break;
        }
        case 'explosif': t.explosiveNext = true; break;
      }
      this.text(t.x, t.y - 44, d.icon + ' ' + d.label, '#ffe9a8');
      HB.sfx.ability(m.id, t.x);
    }

    makeSmoke(x, y, duration) {
      const puffs = [];
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.6;
        puffs.push({ dx: Math.cos(a) * r, dy: Math.sin(a) * r, s: 0.45 + Math.random() * 0.35, ph: Math.random() * 6 });
      }
      return { x, y, r: 12, maxR: 80, t: duration, max: duration, puffs };
    }

    dropMine(t) {
      const x = t.x - Math.cos(t.angle) * 24, y = t.y - Math.sin(t.angle) * 24;
      const mine = { owner: t, x, y, armT: 0.7, life: 30, alive: true };
      if (this.map.cellAt(x, y) !== T.EMPTY) { mine.x = t.x; mine.y = t.y; }
      this.mines.push(mine);
      const mine3 = this.mines.filter(m => m.owner === t && m.alive);
      if (mine3.length > 3) mine3[0].alive = false;
    }

    /* Explosion de zone (mine, obus explosif) */
    blast(x, y, dmg, radius, owner, exclude) {
      for (const t of this.tanks) {
        if (!t.alive || t === exclude || (owner && !HB.isEnemy(owner, t))) continue;
        const d = dist(x, y, t.x, t.y);
        if (d > radius + t.radius) continue;
        const k = 1 - 0.5 * clamp(d / radius, 0, 1);
        const real = t.takeDamage(dmg * k, owner, this);
        if (owner) owner.damageDealt += real;
        this.text(t.x + 8, t.y - 22, '-' + Math.round(real), '#ffb070');
      }
      // Les caisses proches encaissent aussi
      const C = HB.CELL, r = Math.ceil(radius / C);
      const cx0 = Math.floor(x / C), cy0 = Math.floor(y / C);
      for (let cy = cy0 - r; cy <= cy0 + r; cy++) for (let cx = cx0 - r; cx <= cx0 + r; cx++) {
        if (this.map.cell(cx, cy) !== T.CRATE) continue;
        const c = this.map.center(cx, cy);
        if (dist(x, y, c.x, c.y) > radius + C / 2) continue;
        if (this.map.damageCrate(cx, cy, dmg)) this.crateBroken(cx, cy);
      }
      for (let i = 0; i < 3; i++) this.particles.push(this.fireball(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30, 18 + Math.random() * 14));
      for (let i = 0; i < 22; i++) this.particles.push(this.spark(x, y, i % 2 ? '#ffb347' : '#fff3b0', 260));
      for (let i = 0; i < 6; i++) this.particles.push(this.smoke(x, y, '#555', 1.4));
      this.scorch(x, y);
      this.shake = Math.max(this.shake, 7);
      HB.sfx.explosion(x);
    }

    updateModules(dt) {
      // Fumée
      for (const s of this.smokes) {
        s.t -= dt;
        s.r += (s.maxR - s.r) * Math.min(1, dt * 4);
      }
      this.smokes = this.smokes.filter(s => s.t > 0);
      // Mines
      for (const m of this.mines) {
        if (!m.alive) continue;
        m.armT -= dt; m.life -= dt;
        if (m.life <= 0) { m.alive = false; continue; }
        if (m.armT > 0) continue;
        for (const t of this.tanks) {
          if (!t.alive || !HB.isEnemy(m.owner, t)) continue;
          if (dist(t.x, t.y, m.x, m.y) < t.radius + 6) {
            m.alive = false;
            this.blast(m.x, m.y, 45, 55, m.owner, null);
            break;
          }
        }
      }
      this.mines = this.mines.filter(m => m.alive);
      // Traînée de la nitro
      for (const t of this.tanks) {
        if (!t.alive || t.nitroT <= 0) continue;
        const bx = t.x - Math.cos(t.angle) * 18, by = t.y - Math.sin(t.angle) * 18;
        for (let i = 0; i < 2; i++) {
          const p = this.fireball(bx + (Math.random() - 0.5) * 8, by + (Math.random() - 0.5) * 8, 5 + Math.random() * 4);
          p.life = p.maxLife = 0.25; p.grow = 6;
          this.particles.push(p);
        }
      }
    }

    /* Ligne de vue : murs (+ caisses) et nuages de fumée */
    canSee(x0, y0, x1, y1, crates = true) {
      if (!this.map.hasLos(x0, y0, x1, y1, crates)) return false;
      for (const s of this.smokes) {
        if (s.r < 25) continue;
        const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
        const k = clamp(((s.x - x0) * dx + (s.y - y0) * dy) / l2, 0, 1);
        if (dist(s.x, s.y, x0 + dx * k, y0 + dy * k) < s.r * 0.85) return false;
      }
      return true;
    }

    /* ---------------- Événements ---------------- */
    spawnShell(owner, x, y, a) {
      const d = owner.d;
      this.shells.push({
        owner, x, y, vx: Math.cos(a) * d.shellSpeed, vy: Math.sin(a) * d.shellSpeed,
        dmg: d.damage, maxDist: d.range * 1.12, traveled: 0, r: 2.4 + owner.stats.puissance * 0.33,
        alive: true, trail: [], color: owner.color, explosive: owner.explosiveNext,
      });
      owner.explosiveNext = false;
      HB.sfx.shot(owner.stats.puissance, x);
      for (let i = 0; i < 2 + owner.stats.puissance / 3; i++) {
        const p = this.smoke(x, y, '#ccc', 0.5 + owner.stats.puissance * 0.05);
        p.vx += Math.cos(a) * 40; p.vy += Math.sin(a) * 40;
        this.particles.push(p);
      }
    }

    impact(s, onTank, hitTank) {
      s.alive = false;
      if (s.explosive) this.blast(s.x, s.y, s.dmg * 0.7, 64, s.owner, hitTank);
      const power = s.dmg / 58;
      HB.sfx.impact(power, onTank, s.x);
      const nSpark = 6 + Math.round(power * 14);
      for (let i = 0; i < nSpark; i++) this.particles.push(this.spark(s.x, s.y, onTank ? '#ffb347' : '#ffe0a0', 120 + power * 160));
      for (let i = 0; i < 2 + power * 5; i++) this.particles.push(this.smoke(s.x, s.y, '#777', 0.6 + power));
      if (onTank) this.particles.push(this.fireball(s.x, s.y, 8 + power * 14));
      this.shake = Math.max(this.shake, power * 4);
    }

    crateBroken(cx, cy) {
      const c = this.map.center(cx, cy);
      HB.sfx.crate(c.x);
      for (let i = 0; i < 16; i++) {
        const p = this.spark(c.x, c.y, i % 2 ? '#a8763e' : '#6b4622', 160);
        p.size = 3 + Math.random() * 3; p.square = true; p.vr = (Math.random() - 0.5) * 20; p.drag = 3; p.life = p.maxLife = 0.9;
        this.particles.push(p);
      }
      if (this.options.pickups && Math.random() < 0.3) this.spawnPickup(c.x, c.y);
    }

    spawnPickup(x, y) {
      this.pickups.push({ x, y, t: 0, alive: true });
    }

    nearestPickup(x, y, filter) {
      let best = null, bd = Infinity;
      for (const p of this.pickups) {
        if (!p.alive || (filter && !filter(p))) continue;
        const d = dist(x, y, p.x, p.y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }

    killTank(victim, attacker) {
      victim.alive = false;
      victim.deathTime = this.time;
      victim.place = this.tanks.filter(t => t.alive).length + 1;
      victim.killer = attacker;
      victim.vx = victim.vy = 0;
      if (attacker && attacker !== victim) attacker.kills++;
      HB.sfx.explosion(victim.x);
      this.haptic('kill', victim);
      // Grosse explosion
      for (let i = 0; i < 40; i++) this.particles.push(this.spark(victim.x, victim.y, i % 3 ? '#ffb347' : '#fff3b0', 300));
      for (let i = 0; i < 4; i++) this.particles.push(this.fireball(victim.x + (Math.random() - 0.5) * 20, victim.y + (Math.random() - 0.5) * 20, 22 + Math.random() * 14));
      for (let i = 0; i < 14; i++) this.particles.push(this.smoke(victim.x, victim.y, '#444', 2.2));
      for (let i = 0; i < 10; i++) {
        const p = this.spark(victim.x, victim.y, victim.color, 200);
        p.square = true; p.size = 3 + Math.random() * 3; p.vr = (Math.random() - 0.5) * 16; p.drag = 2.5; p.life = p.maxLife = 1.2;
        this.particles.push(p);
      }
      this.scorch(victim.x, victim.y);
      this.shake = 10;
      const vn = `<b style="color:${victim.color}">${esc(victim.name)}</b>`;
      if (attacker && attacker !== victim) {
        this.feed(`💀 <b style="color:${attacker.color}">${esc(attacker.name)}</b> destroyed ${vn}`);
      } else {
        this.feed(`☢️ ${vn} was swallowed by the zone`);
      }
    }

    feed(html, kind) { this.cb.onFeed && this.cb.onFeed(html, kind); }

    text(x, y, str, color) { this.texts.push({ x, y, str, color, life: 0.9, maxLife: 0.9 }); }

    results() {
      const list = this.tanks.slice().sort((a, b) => (a.place || 99) - (b.place || 99)).map(t => ({
        name: t.name, color: t.color, place: t.place, kills: t.kills,
        damageDealt: Math.round(t.damageDealt), damageTaken: Math.round(t.damageTaken),
        shots: t.shots, hits: t.hits, accuracy: t.shots ? Math.round(100 * t.hits / t.shots) : 0,
        survival: t.deathTime == null ? this.time : t.deathTime, behavior: t.cfg.behavior,
        stats: t.stats, killer: t.killer ? t.killer.name : (t.alive ? null : 'the zone'), id: t.cfg.id,
      }));
      const P = this.player;
      const player = P ? {
        won: this.survived || this.winner === P, hp: P.alive ? P.hpRatio : 0, time: this.time, kills: P.kills,
        accuracy: P.shots ? P.hits / P.shots : 0, alive: P.alive,
      } : null;
      return { list, duration: this.time, winner: this.winner ? this.winner.name : null, seed: this.options.seed, player, survived: this.survived };
    }

    /* ---------------- Particules ---------------- */
    spark(x, y, color, speed) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      const life = 0.25 + Math.random() * 0.35;
      return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life, size: 1.5 + Math.random() * 1.5, color, drag: 4, rot: 0, kind: 'spark' };
    }
    smoke(x, y, color, scale = 1) {
      const a = Math.random() * Math.PI * 2, s = 10 + Math.random() * 30;
      const life = (0.8 + Math.random() * 0.8) * Math.max(0.6, scale);
      return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 8, life, maxLife: life, size: (3 + Math.random() * 4) * scale, grow: 10 * scale, color, drag: 1.5, rot: 0, kind: 'smoke' };
    }
    fireball(x, y, size) {
      const life = 0.35 + Math.random() * 0.2;
      return { x, y, vx: 0, vy: 0, life, maxLife: life, size, grow: size * 1.5, color: '#ff9a3c', drag: 0, rot: 0, kind: 'fire' };
    }

    addTrack(t) {
      const g = this.groundCtx;
      if (!g) return;
      g.save();
      g.translate(t.x, t.y);
      g.rotate(t.angle);
      g.fillStyle = 'rgba(40,30,20,0.10)';
      const W = 20 + t.stats.blindage * 0.6;
      g.fillRect(-2, -W / 2, 3, 5);
      g.fillRect(-2, W / 2 - 5, 3, 5);
      g.restore();
    }

    scorch(x, y) {
      const g = this.groundCtx;
      if (!g) return;
      const grd = g.createRadialGradient(x, y, 2, x, y, 34);
      grd.addColorStop(0, 'rgba(15,10,5,0.55)');
      grd.addColorStop(1, 'rgba(15,10,5,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, 34, 0, Math.PI * 2); g.fill();
    }

    /* ---------------- Rendu ---------------- */
    buildLayers() {
      const mk = () => { const c = document.createElement('canvas'); c.width = HB.W; c.height = HB.H; return c; };
      // Sol
      this.ground = mk();
      const g = this.groundCtx = this.ground.getContext('2d');
      const grd = g.createLinearGradient(0, 0, HB.W, HB.H);
      grd.addColorStop(0, '#7d7452'); grd.addColorStop(1, '#6d6646');
      g.fillStyle = grd;
      g.fillRect(0, 0, HB.W, HB.H);
      for (const d of this.map.decor) {
        g.fillStyle = d.pebble ? `rgba(60,55,40,${d.a})` : (d.dark ? `rgba(40,45,20,${d.a})` : `rgba(230,220,170,${d.a})`);
        g.beginPath(); g.arc(d.x, d.y, d.r, 0, Math.PI * 2); g.fill();
      }
      // Quadrillage discret
      g.strokeStyle = 'rgba(0,0,0,0.035)';
      g.lineWidth = 1;
      for (let x = 0; x <= HB.W; x += HB.CELL) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, HB.H); g.stroke(); }
      for (let y = 0; y <= HB.H; y += HB.CELL) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(HB.W, y + 0.5); g.stroke(); }
      // Ombres des murs
      g.fillStyle = 'rgba(0,0,0,0.22)';
      this.forCells(T.WALL, (x, y) => g.fillRect(x * HB.CELL + 5, y * HB.CELL + 6, HB.CELL, HB.CELL));

      // Murs
      this.walls = mk();
      const w = this.walls.getContext('2d');
      const C = HB.CELL, m = this.map;
      this.forCells(T.WALL, (x, y) => {
        const px = x * C, py = y * C;
        w.fillStyle = '#4d525b';
        w.fillRect(px, py, C, C);
        const up = m.cell(x, y - 1) === T.WALL, dn = m.cell(x, y + 1) === T.WALL;
        const lf = m.cell(x - 1, y) === T.WALL, rt = m.cell(x + 1, y) === T.WALL;
        w.fillStyle = '#6b717c';
        if (!up) w.fillRect(px, py, C, 4);
        if (!lf) w.fillRect(px, py, 3, C);
        w.fillStyle = '#353940';
        if (!dn) w.fillRect(px, py + C - 5, C, 5);
        if (!rt) w.fillRect(px + C - 3, py, 3, C);
        // texture de pierre
        w.fillStyle = 'rgba(255,255,255,0.05)';
        const seed = (x * 73 + y * 131) % 7;
        w.fillRect(px + 6 + seed, py + 9, 9, 6);
        w.fillRect(px + 16 - seed, py + 19, 10, 5);
      });
    }

    forCells(type, fn) {
      for (let y = 0; y < this.map.rows; y++) for (let x = 0; x < this.map.cols; x++) {
        if (this.map.cell(x, y) === type) fn(x, y);
      }
    }

    /* ---------------- Caméra ---------------- */
    setFollow(t) {
      if (!t) return this.overview();
      this.cam.mode = 'follow';
      this.cam.follow = t;
      this.cam.targetZoom = this.cam.followZoom;
    }
    overview() {
      this.cam.mode = 'overview';
      this.cam.follow = null;
      this.cam.targetZoom = 1;
    }
    clampCam() {
      const c = this.cam;
      const hw = HB.W / (2 * c.zoom), hh = HB.H / (2 * c.zoom);
      c.x = clamp(c.x, hw, HB.W - hw);
      c.y = clamp(c.y, hh, HB.H - hh);
    }
    updateCamera(dt) {
      const c = this.cam;
      if (c.mode === 'follow') {
        let t = c.follow;
        if (t && !t.alive) {
          // Le tank suivi est détruit : on suit son vainqueur, sinon vue d'ensemble
          const next = (t.killer && t.killer.alive) ? t.killer : (this.winner && this.winner.alive ? this.winner : null);
          if (next) { c.follow = next; t = next; } else { this.overview(); t = null; }
        }
        if (t) {
          const k = Math.min(1, dt * 5);
          c.x += (t.x - c.x) * k;
          c.y += (t.y - c.y) * k;
        }
      } else if (c.mode === 'overview') {
        const k = Math.min(1, dt * 6);
        c.x += (HB.W / 2 - c.x) * k;
        c.y += (HB.H / 2 - c.y) * k;
      }
      if (c.mode !== 'free') c.zoom += (c.targetZoom - c.zoom) * Math.min(1, dt * 6);
      if (Math.abs(c.zoom - 1) < 0.002 && c.mode === 'overview') { c.zoom = 1; }
      this.clampCam();
    }
    /* Coordonnées du canvas (pixels internes) → coordonnées de la carte */
    toWorld(cx, cy) {
      const c = this.cam;
      return { x: (cx - HB.W / 2) / c.zoom + c.x, y: (cy - HB.H / 2) / c.zoom + c.y };
    }

    haptic(kind, tank) { this.cb.onHaptic && this.cb.onHaptic(kind, tank); }

    render() {
      const ctx = this.ctx;
      ctx.save();
      const c = this.cam;
      if (c.zoom !== 1 || c.x !== HB.W / 2 || c.y !== HB.H / 2) {
        ctx.fillStyle = '#0f1114';
        ctx.fillRect(0, 0, HB.W, HB.H);
        ctx.setTransform(c.zoom, 0, 0, c.zoom, HB.W / 2 - c.x * c.zoom, HB.H / 2 - c.y * c.zoom);
      }
      if (this.shake > 0.1) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      ctx.drawImage(this.ground, 0, 0);

      // Caisses
      const C = HB.CELL;
      this.forCells(T.CRATE, (x, y) => {
        const px = x * C, py = y * C;
        const hp = this.map.crateHp[this.map.idx(x, y)] / HB.CRATE_HP;
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(px + 7, py + 7, C - 6, C - 6);
        ctx.fillStyle = '#6b4622';
        ctx.fillRect(px + 2, py + 2, C - 4, C - 4);
        ctx.fillStyle = '#a8763e';
        ctx.fillRect(px + 4, py + 4, C - 8, C - 8);
        ctx.strokeStyle = '#6b4622';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px + 5, py + 5); ctx.lineTo(px + C - 5, py + C - 5);
        ctx.moveTo(px + C - 5, py + 5); ctx.lineTo(px + 5, py + C - 5);
        ctx.stroke();
        if (hp < 0.7) {
          ctx.strokeStyle = 'rgba(30,15,5,0.8)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px + 8, py + 6); ctx.lineTo(px + 14, py + 15); ctx.lineTo(px + 11, py + 24); ctx.stroke();
        }
        if (hp < 0.4) {
          ctx.beginPath(); ctx.moveTo(px + 24, py + 7); ctx.lineTo(px + 19, py + 16); ctx.lineTo(px + 25, py + 26); ctx.stroke();
        }
      });

      // Kits de réparation
      for (const p of this.pickups) {
        const pulse = 1 + Math.sin(p.t * 5) * 0.12;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(pulse, pulse);
        ctx.fillStyle = 'rgba(80,255,120,0.18)';
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f4f4f4';
        HB.roundRect(ctx, -9, -9, 18, 18, 4); ctx.fill();
        ctx.fillStyle = '#2fbf4f';
        ctx.fillRect(-2.5, -6, 5, 12); ctx.fillRect(-6, -2.5, 12, 5);
        ctx.restore();
      }

      // Mines (au sol, discrètes, voyant clignotant de la couleur du poseur)
      for (const m of this.mines) {
        ctx.fillStyle = 'rgba(25,25,25,0.85)';
        ctx.beginPath(); ctx.arc(m.x, m.y, 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = m.owner.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(m.x, m.y, 6.5, 0, Math.PI * 2); ctx.stroke();
        const on = m.armT <= 0 && Math.sin(this.time * 9 + m.x) > 0;
        ctx.fillStyle = on ? '#ff3b3b' : '#5a1a1a';
        ctx.beginPath(); ctx.arc(m.x, m.y, 2, 0, Math.PI * 2); ctx.fill();
      }

      // Épaves, puis tanks vivants
      for (const t of this.tanks) if (!t.alive) t.draw(ctx);
      ctx.drawImage(this.walls, 0, 0);
      for (const t of this.tanks) if (t.alive) t.draw(ctx, { trackPhase: (t.x + t.y) * 0.5 });

      // Obus
      for (const s of this.shells) {
        if (s.trail.length) {
          ctx.strokeStyle = 'rgba(255,230,160,0.35)';
          ctx.lineWidth = s.r;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(s.trail[0].x, s.trail[0].y);
          for (const p of s.trail) ctx.lineTo(p.x, p.y);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }
        if (s.explosive) {
          ctx.fillStyle = 'rgba(255,140,40,0.35)';
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = s.explosive ? '#ffb347' : '#fff4c2';
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.55, 0, Math.PI * 2); ctx.fill();
      }

      // Particules
      for (const p of this.particles) {
        const k = p.life / p.maxLife;
        if (p.kind === 'smoke') {
          ctx.globalAlpha = k * 0.35;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        } else if (p.kind === 'fire') {
          ctx.globalAlpha = k;
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          grd.addColorStop(0, '#fff6c0'); grd.addColorStop(0.4, '#ffaa33'); grd.addColorStop(1, 'rgba(200,50,10,0)');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.globalAlpha = Math.min(1, k * 1.5);
          ctx.fillStyle = p.color;
          if (p.square || p.confetti) {
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot || p.life * 8);
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * (p.confetti ? 0.5 : 1));
            ctx.restore();
          } else {
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;

      // Nuages de fumée (au-dessus des tanks : ils les cachent vraiment)
      for (const s of this.smokes) {
        const fade = Math.min(1, s.t / 0.8, (s.max - s.t) / 0.3 + 0.3);
        for (const p of s.puffs) {
          const wob = Math.sin(this.time * 1.5 + p.ph) * 4;
          const px = s.x + p.dx * s.r + wob, py = s.y + p.dy * s.r - wob * 0.5;
          const pr = s.r * p.s;
          const grd = ctx.createRadialGradient(px, py, 0, px, py, pr);
          grd.addColorStop(0, `rgba(205,205,200,${0.75 * fade})`);
          grd.addColorStop(1, 'rgba(205,205,200,0)');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
        }
      }

      // Zone mortelle
      const z = this.zone;
      if (z.active) {
        ctx.fillStyle = 'rgba(190,20,50,0.22)';
        ctx.beginPath();
        ctx.rect(0, 0, HB.W, HB.H);
        ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
        ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(255,60,90,0.85)';
        ctx.lineWidth = 3;
        ctx.setLineDash([14, 8]);
        ctx.lineDashOffset = -this.time * 30;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Tank sélectionné : portée, chemin, intention
      const sel = this.selected;
      if (sel && sel.alive) {
        ctx.strokeStyle = sel.color;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.arc(sel.x, sel.y, sel.d.range, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        const path = sel.brain.path;
        if (path && path.length) {
          ctx.fillStyle = sel.color;
          for (const p of path) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill(); }
        }
        const at = sel.brain.aimTarget || sel.brain.target;
        if (at && at.alive) {
          ctx.strokeStyle = sel.brain.aimTarget ? '#ff5050' : 'rgba(255,255,255,0.5)';
          ctx.beginPath(); ctx.moveTo(sel.x, sel.y); ctx.lineTo(at.x, at.y); ctx.stroke();
          ctx.beginPath(); ctx.arc(at.x, at.y, 22, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Étiquettes
      ctx.textAlign = 'center';
      for (const t of this.tanks) {
        if (!t.alive) continue;
        const y = t.y - 30;
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillText(t.name, t.x + 1, y + 1);
        ctx.fillStyle = '#fff';
        ctx.fillText(t.name, t.x, y);
        const bw = 34, bx = t.x - bw / 2, by = y + 4;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, 6);
        const r = t.hpRatio;
        ctx.fillStyle = r > 0.5 ? '#4fdc6a' : r > 0.25 ? '#f2c230' : '#ff4d4d';
        ctx.fillRect(bx, by, bw * r, 4);
        const rl = 1 - clamp(t.reloadT / t.d.reload, 0, 1);
        ctx.fillStyle = rl >= 1 ? '#9ad7ff' : 'rgba(154,215,255,0.5)';
        ctx.fillRect(bx, by + 5, bw * rl, 1.5);
        // Modules : allumés quand prêts
        if (t.mods.length) {
          ctx.font = '10px system-ui, sans-serif';
          t.mods.forEach((m, i) => {
            ctx.globalAlpha = (m.cd <= 0 && m.uses > 0) ? 1 : 0.3;
            ctx.fillText(m.def.icon, t.x + 26 + i * 12, y + 8);
          });
          ctx.globalAlpha = 1;
        }
        if (sel === t) {
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillStyle = '#ffe9a8';
          ctx.fillText(t.brain.state, t.x, t.y + 32);
        }
      }

      // Textes flottants
      ctx.font = 'bold 13px system-ui, sans-serif';
      for (const tx of this.texts) {
        ctx.globalAlpha = Math.min(1, tx.life / tx.maxLife * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(tx.str, tx.x + 1, tx.y + 1);
        ctx.fillStyle = tx.color;
        ctx.fillText(tx.str, tx.x, tx.y);
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      if (this.paused) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, HB.W, HB.H);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 48px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSE', HB.W / 2, HB.H / 2);
      }
    }

    /* Sélection d'un tank au clic (coordonnées internes du canvas) */
    pick(x, y) {
      let best = null, bd = 34;
      for (const t of this.tanks) {
        if (!t.alive) continue;
        const d = dist(x, y, t.x, t.y);
        if (d < bd) { bd = d; best = t; }
      }
      this.selected = best;
      return best;
    }
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  HB.esc = esc;
  HB.Game = Game;
})();
