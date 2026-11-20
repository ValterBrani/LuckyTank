'use strict';
/* =========================================================================
 * Tank : physique, tir et rendu
 * ========================================================================= */
(function () {
  const HB = window.HB;
  const { clamp, angDiff } = HB;

  HB.TANK_RADIUS = 14;

  class Tank {
    constructor(cfg, x, y, angle, index) {
      this.cfg = cfg;
      this.index = index;
      this.name = cfg.name;
      this.color = cfg.color;
      this.team = cfg.team || null; // null = chacun pour soi
      this.stats = Object.assign({}, cfg.stats);
      this.d = HB.derive(this.stats);
      this.x = x; this.y = y;
      this.angle = angle;
      this.turret = angle;
      this.vx = 0; this.vy = 0;
      this.radius = HB.TANK_RADIUS;
      this.hp = this.d.maxHp;
      this.alive = true;
      this.reloadT = this.d.reload * (0.4 + Math.random() * 0.6);
      this.control = { move: 0, turn: 0, aim: angle, fire: false };
      this.flash = 0;       // flash de tir
      this.hitFlash = 0;    // flash quand touché
      this.recoil = 0;
      this.trackAcc = 0;
      this.lastAttacker = null;
      this.lastHitT = -99;
      this.ramT = -99;
      // Statistiques de fin de partie
      this.kills = 0;
      this.damageDealt = 0;
      this.damageTaken = 0;
      this.shots = 0;
      this.hits = 0;
      this.healed = 0;
      this.deathTime = null;
      this.place = null;
      this.killer = null;
      // Modules (compétences actives)
      this.mods = (cfg.modules || []).filter(m => HB.MODULES[m.id]).map(m => ({
        id: m.id, trigger: m.trigger, def: HB.MODULES[m.id],
        cd: 1 + Math.random(), uses: HB.MODULES[m.id].uses || Infinity,
      }));
      this.shieldT = 0;
      this.nitroT = 0;
      this.explosiveNext = false;
      this.modUses = 0;
      this.brain = new HB.Brain(this);
    }

    get hpRatio() { return this.hp / this.d.maxHp; }

    update(dt, game) {
      if (!this.alive) return;
      this.brain.update(dt, game);
      const c = this.control;
      const d = this.d;

      // Modules : recharges et effets en cours
      for (const m of this.mods) m.cd -= dt;
      this.shieldT = Math.max(0, this.shieldT - dt);
      this.nitroT = Math.max(0, this.nitroT - dt);
      const boost = this.nitroT > 0 ? 1.9 : 1;

      // Châssis
      this.angle += clamp(c.turn, -1, 1) * d.turnSpeed * (boost > 1 ? 1.3 : 1) * dt;
      const move = clamp(c.move, -1, 1);
      const sp = move * d.speed * boost * (move < 0 ? 0.7 : 1);
      // Inertie légère : les tanks lourds accélèrent moins vite (la nitro aide)
      const accel = (4 + 8 * d.weightFactor) * (boost > 1 ? 2 : 1);
      const tvx = Math.cos(this.angle) * sp, tvy = Math.sin(this.angle) * sp;
      this.vx += (tvx - this.vx) * Math.min(1, accel * dt);
      this.vy += (tvy - this.vy) * Math.min(1, accel * dt);
      const ox = this.x, oy = this.y;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.collideMap(game.map);

      // Traces de chenilles
      const moved = Math.hypot(this.x - ox, this.y - oy);
      this.trackAcc += moved;
      if (this.trackAcc > 7) { this.trackAcc = 0; game.addTrack(this); }

      // Tourelle
      const diff = angDiff(c.aim, this.turret);
      const maxRot = d.turretSpeed * dt;
      this.turret += clamp(diff, -maxRot, maxRot);

      // Tir
      this.reloadT -= dt;
      if (c.fire && this.reloadT <= 0) this.fire(game);

      this.flash = Math.max(0, this.flash - dt * 8);
      this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
      this.recoil = Math.max(0, this.recoil - dt * 18);
    }

    fire(game) {
      const d = this.d;
      this.reloadT = d.reload;
      const moving = Math.hypot(this.vx, this.vy) > 15;
      const spread = d.spread * (moving ? 1.4 : 1);
      const a = this.turret + (Math.random() * 2 - 1) * spread;
      const len = this.barrelLength();
      const mx = this.x + Math.cos(this.turret) * len, my = this.y + Math.sin(this.turret) * len;
      game.spawnShell(this, mx, my, a);
      this.shots++;
      this.flash = 1;
      this.recoil = 1 + this.stats.puissance * 0.25;
      // Recul physique proportionnel à la puissance
      const k = 6 + this.stats.puissance * 4;
      this.vx -= Math.cos(this.turret) * k;
      this.vy -= Math.sin(this.turret) * k;
    }

    barrelLength() { return 14 + this.stats.portee * 1.6; }

    /* Collision cercle / cases pleines */
    collideMap(map) {
      const r = this.radius, C = HB.CELL;
      const cx0 = Math.floor((this.x - r) / C), cx1 = Math.floor((this.x + r) / C);
      const cy0 = Math.floor((this.y - r) / C), cy1 = Math.floor((this.y + r) / C);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        if (map.cell(cx, cy) === HB.T.EMPTY) continue;
        const nx = clamp(this.x, cx * C, cx * C + C), ny = clamp(this.y, cy * C, cy * C + C);
        let dx = this.x - nx, dy = this.y - ny;
        const dd = Math.hypot(dx, dy);
        if (dd < r) {
          if (dd < 0.001) { dx = this.x - (cx + 0.5) * C; dy = this.y - (cy + 0.5) * C; }
          const l = Math.hypot(dx, dy) || 1;
          const push = r - dd;
          this.x += dx / l * push;
          this.y += dy / l * push;
          // annule la vitesse dans la direction du mur
          const vn = (this.vx * dx + this.vy * dy) / l;
          if (vn < 0) { this.vx -= vn * dx / l; this.vy -= vn * dy / l; }
        }
      }
      this.x = clamp(this.x, C + r, HB.W - C - r);
      this.y = clamp(this.y, C + r, HB.H - C - r);
    }

    takeDamage(amount, attacker, game) {
      if (!this.alive) return 0;
      if (this.shieldT > 0) amount *= 0.35; // le bouclier absorbe 65 %
      if (amount > 0) game.lastDamageT = game.time;
      if (game.haptic && amount >= 3) game.haptic('hit', this); // pas pour la zone (dégâts continus)
      const real = Math.min(amount, this.hp);
      this.hp -= amount;
      this.damageTaken += real;
      this.hitFlash = 1;
      if (attacker && attacker !== this) {
        this.lastAttacker = attacker;
        this.lastHitT = game.time;
      }
      if (this.hp <= 0) {
        this.hp = 0;
        game.killTank(this, attacker);
      }
      return real;
    }

    heal(amount) {
      const real = Math.min(amount, this.d.maxHp - this.hp);
      this.hp += real;
      this.healed += real;
      return real;
    }

    draw(ctx, opts = {}) {
      HB.drawTank(ctx, this.stats, this.color, this.x, this.y, this.angle, this.turret, {
        flash: this.flash, hitFlash: this.hitFlash, recoil: this.recoil, dead: !this.alive, ...opts,
      });
      if (!this.alive) return;
      // Obus explosif chargé : lueur orange au bout du canon
      if (this.explosiveNext) {
        const len = this.barrelLength();
        const bx = this.x + Math.cos(this.turret) * len, by = this.y + Math.sin(this.turret) * len;
        ctx.fillStyle = 'rgba(255,140,40,0.85)';
        ctx.beginPath(); ctx.arc(bx, by, 3.5 + Math.sin(performance.now() / 80) * 1, 0, Math.PI * 2); ctx.fill();
      }
      // Bouclier : bulle bleue
      if (this.shieldT > 0) {
        const a = Math.min(1, this.shieldT * 2);
        const r = 25 + this.stats.blindage * 0.5;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(90,190,255,0.16)';
        ctx.strokeStyle = 'rgba(140,215,255,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(this.x, this.y, r + Math.sin(performance.now() / 120) * 1.5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
  }

  /* Dessin d'un tank (utilisé en jeu et dans l'aperçu du garage).
   * L'apparence reflète la configuration : canon long = portée, canon épais = puissance,
   * châssis large et plaques = blindage, ailerons = vitesse. */
  HB.drawTank = (ctx, stats, color, x, y, angle, turret, o = {}) => {
    const b = stats.blindage, p = stats.puissance, r = stats.portee, v = stats.vitesse;
    const L = 28 + b * 0.8, W = 20 + b * 0.6;
    const dark = shade(color, -0.45), light = shade(color, 0.25);
    ctx.save();
    ctx.translate(x, y);

    // Ombre
    ctx.save();
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(ctx, -L / 2 + 3, -W / 2 + 4, L, W, 5);
    ctx.fill();
    ctx.restore();

    // Châssis
    ctx.save();
    ctx.rotate(angle);
    if (o.dead) ctx.globalAlpha = 1;
    // Chenilles
    ctx.fillStyle = o.dead ? '#222' : '#2b2b2b';
    roundRect(ctx, -L / 2, -W / 2, L, 5.5, 2); ctx.fill();
    roundRect(ctx, -L / 2, W / 2 - 5.5, L, 5.5, 2); ctx.fill();
    if (!o.dead) {
      ctx.fillStyle = '#4a4a4a';
      const phase = o.trackPhase || 0;
      for (let i = -L / 2 + ((phase % 4) + 4) % 4; i < L / 2 - 1; i += 4) {
        ctx.fillRect(i, -W / 2 + 0.5, 1.4, 4.5);
        ctx.fillRect(i, W / 2 - 5, 1.4, 4.5);
      }
    }
    // Caisse
    ctx.fillStyle = o.dead ? '#3a3632' : color;
    roundRect(ctx, -L / 2 + 2, -W / 2 + 4, L - 4, W - 8, 3); ctx.fill();
    if (!o.dead) {
      ctx.fillStyle = light;
      ctx.fillRect(-L / 2 + 4, -W / 2 + 5, L - 8, 2);
      // Plaques de blindage
      if (b >= 5) {
        ctx.fillStyle = dark;
        const n = b >= 8 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const px = -L / 2 + 5 + i * ((L - 10) / n);
          ctx.fillRect(px, -W / 2 + 3, (L - 10) / n - 2, 2.5);
          ctx.fillRect(px, W / 2 - 5.5, (L - 10) / n - 2, 2.5);
        }
      }
      // Ailerons / pot d'échappement pour la vitesse
      if (v >= 5) {
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(-L / 2 + 1, -W / 2 + 6); ctx.lineTo(-L / 2 - 3 - v * 0.3, -W / 2 + 5); ctx.lineTo(-L / 2 + 1, -W / 2 + 10);
        ctx.moveTo(-L / 2 + 1, W / 2 - 6); ctx.lineTo(-L / 2 - 3 - v * 0.3, W / 2 - 5); ctx.lineTo(-L / 2 + 1, W / 2 - 10);
        ctx.fill();
      }
      // Phare avant
      ctx.fillStyle = 'rgba(255,240,180,0.8)';
      ctx.fillRect(L / 2 - 4, -2, 2, 4);
    }
    ctx.restore();

    // Tourelle
    ctx.save();
    ctx.rotate(turret);
    const bl = 14 + r * 1.6, bw = 3 + p * 0.5, tr = 6 + p * 0.45 + b * 0.15;
    const rec = (o.recoil || 0) * 1.2;
    ctx.fillStyle = o.dead ? '#2a2725' : '#3a3a3a';
    ctx.fillRect(2 - rec, -bw / 2, bl - 2, bw);
    if (!o.dead) {
      ctx.fillStyle = '#555';
      ctx.fillRect(bl - 4 - rec, -bw / 2 - 1, 4, bw + 2); // frein de bouche
    }
    ctx.fillStyle = o.dead ? '#3a3632' : dark;
    ctx.beginPath(); ctx.arc(0, 0, tr + 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = o.dead ? '#433e39' : color;
    ctx.beginPath(); ctx.arc(0, 0, tr, 0, Math.PI * 2); ctx.fill();
    if (!o.dead) {
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(-tr * 0.25, -tr * 0.25, tr * 0.35, 0, Math.PI * 2); ctx.fill();
    }
    // Flash de tir
    if (o.flash > 0) {
      ctx.globalAlpha = o.flash;
      ctx.fillStyle = '#ffd36b';
      ctx.beginPath();
      const fs = 6 + p * 1.2;
      ctx.moveTo(bl, -bw); ctx.lineTo(bl + fs * 1.6, 0); ctx.lineTo(bl, bw);
      ctx.fill();
      ctx.beginPath(); ctx.arc(bl + 2, 0, fs * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Flash blanc quand touché
    if (o.hitFlash > 0 && !o.dead) {
      ctx.globalAlpha = o.hitFlash * 0.6;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, L * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt < 0) { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
    else { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  HB.roundRect = roundRect;
  HB.shade = shade;
  HB.Tank = Tank;
})();
