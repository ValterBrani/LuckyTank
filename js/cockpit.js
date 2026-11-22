'use strict';
/* =========================================================================
 * Vue intérieure : la bataille vue depuis le viseur d'un tank (fausse 3D)
 * - Murs, caisses, sol et ciel : lancer de rayons sur la grille de la carte
 *   (la technique de Wolfenstein 3D), écrit pixel par pixel en basse résolution
 *   puis agrandi sans lissage (look pixel, rapide même sur téléphone).
 * - Tanks : petits volumes 3D (chenilles, caisse, tourelle, canon) dont les
 *   proportions viennent des stats, comme sur la carte.
 * - Obus, particules, kits, mines, fumée : images toujours tournées vers la caméra.
 * - Par-dessus, en pleine résolution : viseur, boussole, étiquettes, messages
 *   du pilote et tableau de bord (blindage, rechargement, modules, radar).
 * Purement visuel : rien ici ne change la simulation.
 * ========================================================================= */
(function () {
  const HB = window.HB;
  const { clamp, lerp, angDiff } = HB;
  const T = HB.T;
  const C = HB.CELL;
  const TAU = Math.PI * 2;

  const EYE = 19;            // hauteur de l'œil : viseur du tireur, au-dessus du canon
  const WALL_H = 36;         // hauteur des murs et des caisses
  const NEAR = 2;            // plus près que ça, on ne dessine pas
  const FOG0 = 220, FOG1 = 1500;
  const FOG = [184, 175, 148];
  const SKY_TOP = [72, 116, 172];
  const HILL = [118, 116, 102];
  const ZONE_RGB = [235, 50, 80];
  const RADAR_RANGE = 430;   // rayon couvert par le radar (unités de carte)
  const LIGHT = norm(0.45, 0.8); // le soleil éclaire depuis le nord-ouest, comme sur la carte

  function norm(x, y) { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }
  const pack = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  function hash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function hexRgb(hex) {
    const n = parseInt(String(hex).slice(1), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgbStr = (r, g, b) => `rgb(${clamp(r | 0, 0, 255)},${clamp(g | 0, 0, 255)},${clamp(b | 0, 0, 255)})`;

  /* ---------------- Textures 32×32 générées ---------------- */
  function makeTex(fn) {
    const t = new Uint32Array(32 * 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const c = fn(x, y);
      t[y * 32 + x] = pack(clamp(c[0] | 0, 0, 255), clamp(c[1] | 0, 0, 255), clamp(c[2] | 0, 0, 255));
    }
    return t;
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const k = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    return Math.hypot(px - ax - dx * k, py - ay - dy * k);
  }
  const CRACKS = [[[8, 6], [14, 15], [11, 24]], [[24, 7], [19, 16], [25, 26]]];
  function onCrack(x, y, n) {
    for (let i = 0; i < n; i++) {
      const c = CRACKS[i];
      for (let k = 0; k < c.length - 1; k++) if (segDist(x + 0.5, y + 0.5, c[k][0], c[k][1], c[k + 1][0], c[k + 1][1]) < 0.9) return true;
    }
    return false;
  }
  // Pierre : rangées de blocs décalées
  const STONE = makeTex((x, y) => {
    const row = y >> 3, off = (row & 1) * 8;
    if ((y & 7) === 7 || ((x + off) & 15) === 15) return [50, 53, 60];
    const brick = (x + off) >> 4;
    const n = hash(brick, row, 3) * 18 - 9 + hash(x, y, 7) * 12 - 6;
    const top = (y & 7) === 0 ? 10 : 0;
    return [80 + n + top, 85 + n + top, 95 + n + top];
  });
  // Caisse : planches, cadre, croisillon ; fissures quand elle est abîmée
  const CRATES = [0, 1, 2].map(dmg => makeTex((x, y) => {
    if (dmg && onCrack(x, y, dmg)) return [38, 22, 10];
    const n = hash(x, y >> 1, 5) * 18 - 9;
    if (x < 3 || x > 28 || y < 3 || y > 28 || Math.abs(x - y) < 2 || Math.abs(x + y - 31) < 2) return [107 + n * 0.5, 70 + n * 0.4, 34];
    if (y % 8 === 0) return [128, 86, 44];
    return [168 + n, 118 + n, 62 + n * 0.6];
  }));

  // Collines et ruines à l'horizon (élévation en radians, sur 360°)
  const SKY_N = 720;
  const SKYLINE = new Float32Array(SKY_N);
  for (let i = 0; i < SKY_N; i++) {
    const a = i / SKY_N * TAU;
    SKYLINE[i] = 0.035 + 0.02 * Math.sin(a * 3 + 1) + 0.012 * Math.sin(a * 7 + 2) + 0.006 * Math.sin(a * 17);
  }
  for (let k = 0; k < 14; k++) {
    const c = (hash(k, 1, 11) * SKY_N) | 0, w = (3 + hash(k, 2, 11) * 9) | 0, h = 0.02 + hash(k, 3, 11) * 0.04;
    for (let j = 0; j < w; j++) SKYLINE[(c + j) % SKY_N] += h;
  }

  /* Découpe d'un polygone (espace caméra) contre le plan proche */
  function clipNear(poly) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ain = a.d >= NEAR, bin = b.d >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const k = (NEAR - a.d) / (b.d - a.d);
        out.push({ l: a.l + (b.l - a.l) * k, d: NEAR, h: a.h + (b.h - a.h) * k });
      }
    }
    return out;
  }

  class Cockpit {
    constructor(game) {
      this.g = game;
      this.buf = document.createElement('canvas');
      this.bx = this.buf.getContext('2d');
      this.rw = 0; this.rh = 0;
      this.camA = null; this.cx = 0; this.cy = 0;
      this.F = { x: 1, y: 0 }; this.R = { x: 0, y: 1 };
      this.eye = EYE; this.hor = 0; this.jx = 0; this.bobPh = 0;
      this.groundT = 0; this.gpx = null;
      this.msgs = []; this.watch = null; this.prev = null; this.said = {};
      this.tags = []; this.radar = null; this.hintT = 0; this.sndT = 0;
    }

    /* Entrée / sortie de la vue */
    enter() { this.watch = null; this.camA = null; this.hintT = 6; this.msgs = []; }
    leave() { HB.sfx.listener = null; HB.sfx.engine(-1); }

    /* Mise en page : vue 3D en haut, tableau de bord en bas */
    layout() {
      const W = HB.W, H = HB.H, portrait = H > W;
      const phone = !!this.g.options.lowFx; // téléphone : l'image est petite, on grossit le texte
      const vh = Math.round(H * (portrait ? 0.6 : phone ? 0.7 : 0.775));
      return { W, H, portrait, s: portrait ? 1.35 : phone ? 1.5 : 1, vw: W, vh, py: vh, ph: H - vh };
    }

    ensure(L) {
      const px = this.g.options.lowFx ? (L.portrait ? 2.5 : 4) : 3; // taille d'un « pixel » de la vue 3D
      const rw = Math.round(L.vw / px), rh = Math.round(L.vh / px);
      if (rw === this.rw && rh === this.rh) return;
      this.rw = rw; this.rh = rh;
      this.buf.width = rw; this.buf.height = rh;
      this.img = this.bx.createImageData(rw, rh);
      this.px = new Uint32Array(this.img.data.buffer);
      this.zbuf = new Float32Array(rw);
      this.skyTop = new Float32Array(rw);
      this.fov = L.portrait ? 1.2 : 1.32;
      this.tanHalf = Math.tan(this.fov / 2);
      this.proj = (rw / 2) / this.tanHalf;
    }

    /* Copie réduite du sol (traces, brûlures) pour le texturer en 3D */
    refreshGround() {
      const gw = HB.W >> 1, gh = HB.H >> 1;
      if (!this.gcan) {
        this.gcan = document.createElement('canvas');
        this.gcan.width = gw; this.gcan.height = gh;
        this.gctx = this.gcan.getContext('2d', { willReadFrequently: true });
      }
      this.gctx.drawImage(this.g.ground, 0, 0, gw, gh);
      this.gpx = new Uint32Array(this.gctx.getImageData(0, 0, gw, gh).data.buffer);
      this.gw = gw; this.gh = gh;
    }

    /* ================= Rendu ================= */
    render(dt) {
      const g = this.g, ctx = g.ctx, L = this.layout(), t = g.cam.follow;
      this.ensure(L);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(0, 0, L.W, L.H);
      if (t) {
        this.update(t, dt);
        this.groundT -= dt;
        if (!this.gpx || this.groundT <= 0) { this.refreshGround(); this.groundT = 2.5; }
        this.drawWorld();
        this.bx.putImageData(this.img, 0, 0);
        this.drawObjects(t);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.buf, 0, 0, this.rw, this.rh, 0, 0, L.vw, L.vh);
        ctx.imageSmoothingEnabled = true;
        this.drawOverlay(ctx, L, t);
        this.drawPanel(ctx, L, t);
      }
      ctx.restore();
    }

    update(t, dt) {
      const g = this.g;
      const fresh = this.watch !== t;
      if (this.camA == null || fresh) this.camA = t.turret;
      // la vue suit la tourelle (qui tourne déjà en douceur), avec un léger lissage en plus
      this.camA += angDiff(t.turret, this.camA) * Math.min(1, dt * 12);
      const a = this.camA;
      const F = this.F = { x: Math.cos(a), y: Math.sin(a) };
      const R = this.R = { x: -F.y, y: F.x };
      this.cx = t.x - F.x * 2 + R.x * 7; // viseur à droite du canon
      this.cy = t.y - F.y * 2 + R.y * 7;
      const sp = Math.hypot(t.vx, t.vy);
      this.bobPh += sp * dt * 0.11;
      const sh = g.shake + (t.flash || 0) * 2 + (t.hitFlash || 0) * 3;
      const jit = () => (sh > 0.1 ? (Math.random() - 0.5) * sh * 0.45 : 0);
      this.jx = jit();
      this.eye = t.alive ? EYE + Math.sin(this.bobPh) * Math.min(1, sp / 90) * 0.7 : EYE - 7; // épave : affaissée
      this.hor = this.rh * 0.5 + jit() + (t.recoil || 0) * 1.4 + (t.alive ? 0 : 6);
      for (const m of this.msgs) m.life -= dt;
      this.msgs = this.msgs.filter(m => m.life > 0);
      this.hintT -= dt;
      this.track(t, g.time);
    }

    /* ---------- Murs, sol, ciel (pixel par pixel) ---------- */
    drawWorld() {
      const g = this.g, map = g.map, px = this.px, rw = this.rw, rh = this.rh, zb = this.zbuf;
      const proj = this.proj, eye = this.eye, hor = this.hor, half = rw / 2;
      const F = this.F, R = this.R, cx = this.cx, cy = this.cy, a = this.camA;
      const z = g.zone, zoneOn = z.active, zr2 = z.r * z.r;
      const fr = FOG[0], fg = FOG[1], fb = FOG[2];

      // Ciel et collines lointaines
      const hi = clamp(Math.ceil(hor), 0, rh);
      for (let x = 0; x < rw; x++) {
        const ang = a + Math.atan((x + 0.5 - half) / proj);
        const k = ((ang / TAU) % 1 + 1) % 1;
        this.skyTop[x] = hor - SKYLINE[(k * SKY_N) | 0] * proj;
      }
      for (let y = 0; y < hi; y++) {
        const el = (hor - y) / proj;
        const e = clamp(el / 0.5, 0, 1);
        const skyC = pack(lerp(fr, SKY_TOP[0], e) | 0, lerp(fg, SKY_TOP[1], e) | 0, lerp(fb, SKY_TOP[2], e) | 0);
        const hk = 0.35 + 0.4 * clamp(el / 0.09, 0, 1);
        const hillC = pack(lerp(fr, HILL[0], hk) | 0, lerp(fg, HILL[1], hk) | 0, lerp(fb, HILL[2], hk) | 0);
        const st = this.skyTop;
        let i = y * rw;
        for (let x = 0; x < rw; x++, i++) px[i] = y >= st[x] ? hillC : skyC;
      }

      // Sol : la vraie texture de la carte (traces de chenilles, brûlures…)
      const gpx = this.gpx, gw = this.gw, gh = this.gh;
      for (let y = hi; y < rh; y++) {
        const rowD = eye * proj / (y - hor + 0.5);
        const f = clamp((rowD - FOG0) / (FOG1 - FOG0), 0, 0.88), f1 = 1 - f;
        const fR = fr * f, fG = fg * f, fB = fb * f;
        let wx = cx + rowD * (F.x - R.x * half / proj), wy = cy + rowD * (F.y - R.y * half / proj);
        const sx = rowD * R.x / proj, sy = rowD * R.y / proj;
        let i = y * rw;
        for (let x = 0; x < rw; x++, i++, wx += sx, wy += sy) {
          let gx = (wx * 0.5) | 0, gy = (wy * 0.5) | 0;
          if (gx < 0) gx = 0; else if (gx >= gw) gx = gw - 1;
          if (gy < 0) gy = 0; else if (gy >= gh) gy = gh - 1;
          const c = gpx[gy * gw + gx];
          let r = c & 255, gg = (c >>> 8) & 255, b = (c >>> 16) & 255;
          if (zoneOn) {
            const dx = wx - z.x, dy = wy - z.y;
            if (dx * dx + dy * dy > zr2) { r = r * 0.6 + 100; gg *= 0.55; b = b * 0.6 + 25; }
          }
          px[i] = (0xff000000 | (((b * f1 + fB) | 0) << 16) | (((gg * f1 + fG) | 0) << 8) | ((r * f1 + fR) | 0)) >>> 0;
        }
      }

      // Murs et caisses : un rayon par colonne
      for (let x = 0; x < rw; x++) {
        const u = (x + 0.5 - half) / proj;
        const dx = F.x + R.x * u, dy = F.y + R.y * u; // composante avant = 1 → t = profondeur
        let mx = Math.floor(cx / C), my = Math.floor(cy / C);
        const stx = dx < 0 ? -1 : 1, sty = dy < 0 ? -1 : 1;
        const ddx = dx === 0 ? 1e9 : Math.abs(C / dx), ddy = dy === 0 ? 1e9 : Math.abs(C / dy);
        let sdx = dx === 0 ? 1e9 : (dx < 0 ? (cx - mx * C) / -dx : ((mx + 1) * C - cx) / dx);
        let sdy = dy === 0 ? 1e9 : (dy < 0 ? (cy - my * C) / -dy : ((my + 1) * C - cy) / dy);
        let side = 0, cell = T.WALL, d = 1e9;
        for (let n = 0; n < 128; n++) {
          if (sdx < sdy) { d = sdx; sdx += ddx; mx += stx; side = 0; }
          else { d = sdy; sdy += ddy; my += sty; side = 1; }
          cell = map.cell(mx, my);
          if (cell !== T.EMPTY) break;
        }
        if (d < 0.5) d = 0.5;
        zb[x] = d;
        const w = side === 0 ? cy + d * dy : cx + d * dx;
        let tu = (w / C) % 1;
        if (tu < 0) tu += 1;
        if ((side === 0 && dx > 0) || (side === 1 && dy < 0)) tu = 1 - tu;
        const tx = Math.min(31, (tu * 32) | 0);
        let tex = STONE;
        if (cell === T.CRATE) {
          const hp = map.crateHp[map.idx(mx, my)] / HB.CRATE_HP;
          tex = CRATES[hp < 0.4 ? 2 : hp < 0.7 ? 1 : 0];
        }
        // ombrage selon l'orientation de la face, puis brume selon la distance
        const nx = side === 0 ? -stx : 0, ny = side === 1 ? -sty : 0;
        const lit = 0.6 + 0.4 * Math.max(0, -(nx * LIGHT.x + ny * LIGHT.y));
        const f = clamp((d - FOG0) / (FOG1 - FOG0), 0, 0.9), m = lit * (1 - f);
        const fR = fr * f, fG = fg * f, fB = fb * f;
        const lineH = WALL_H * proj / d, top = hor - (WALL_H - eye) * proj / d;
        const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(rh, Math.ceil(top + lineH));
        const step = 32 / lineH;
        let tp = (y0 - top) * step;
        let i = y0 * rw + x;
        for (let y = y0; y < y1; y++, i += rw, tp += step) {
          const c = tex[(((tp | 0) & 31) << 5) + tx];
          px[i] = (0xff000000 | (((((c >>> 16) & 255) * m + fB) | 0) << 16) | (((((c >>> 8) & 255) * m + fG) | 0) << 8) | ((((c & 255) * m) + fR) | 0)) >>> 0;
        }

        // Zone mortelle : un rideau d'énergie rouge translucide
        if (zoneOn) {
          const ox = cx - z.x, oy = cy - z.y;
          const A = dx * dx + dy * dy, B = 2 * (ox * dx + oy * dy), Cc = ox * ox + oy * oy - zr2;
          const disc = B * B - 4 * A * Cc;
          if (disc > 0) {
            const sq = Math.sqrt(disc);
            const tz = Cc < 0 ? (-B + sq) / (2 * A) : (-B - sq) / (2 * A);
            if (tz > NEAR && tz < d) {
              const zt = hor - (80 - eye) * proj / tz, zbt = hor + eye * proj / tz;
              const ya = Math.max(0, Math.ceil(zt)), yb = Math.min(rh, Math.ceil(zbt));
              const tick = (g.time * 30) | 0;
              let j = ya * rw + x;
              for (let y = ya; y < yb; y++, j += rw) {
                const al = ((y + tick) % 4 === 0) ? 0.42 : 0.24;
                const c = px[j], ia = 1 - al;
                px[j] = (0xff000000 | (((((c >>> 16) & 255) * ia + ZONE_RGB[2] * al) | 0) << 16) |
                  (((((c >>> 8) & 255) * ia + ZONE_RGB[1] * al) | 0) << 8) | (((c & 255) * ia + ZONE_RGB[0] * al) | 0)) >>> 0;
              }
            }
          }
        }
      }
    }

    /* ---------- Projection ---------- */
    proj3(wx, wy, wz) {
      const dx = wx - this.cx, dy = wy - this.cy;
      const d = dx * this.F.x + dy * this.F.y;
      if (d < NEAR) return null;
      const s = this.proj / d;
      return { d, x: this.rw / 2 + (dx * this.R.x + dy * this.R.y) * s + this.jx, y: this.hor + (this.eye - wz) * s, s };
    }

    /* Masque : seulement les colonnes où rien de plus proche (mur, caisse) ne cache l'objet */
    clip(x0, x1, depth) {
      const bx = this.bx, zb = this.zbuf, rw = this.rw;
      x0 = Math.max(0, Math.floor(x0)); x1 = Math.min(rw - 1, Math.ceil(x1));
      if (x1 < x0) return false;
      bx.beginPath();
      let any = false, run = -1;
      for (let x = x0; x <= x1 + 1; x++) {
        const vis = x <= x1 && zb[x] > depth;
        if (vis && run < 0) run = x;
        else if (!vis && run >= 0) { bx.rect(run, 0, x - run, this.rh); run = -1; any = true; }
      }
      if (any) bx.clip();
      return any;
    }
    visibleAt(x, depth) {
      const i = x | 0;
      return i >= 0 && i < this.rw && this.zbuf[i] > depth;
    }

    /* ---------- Objets : tanks, obus, particules, kits, mines, fumée ---------- */
    drawObjects(t) {
      const g = this.g, rw = this.rw;
      const items = [];
      const onScreen = (p, m) => p.x > -m && p.x < rw + m;
      this.tags = [];

      for (const o of g.tanks) {
        if (o === t) continue;
        const p = this.proj3(o.x, o.y, 0);
        if (!p || p.d > FOG1 + 300 || !onScreen(p, 34 * p.s + 4)) continue;
        items.push({ d: p.d, f: () => this.drawTank(o, p) });
      }
      for (const s of g.shells) {
        const p = this.proj3(s.x, s.y, 13);
        if (!p || !onScreen(p, 12)) continue;
        items.push({ d: p.d, f: () => this.drawShell(s, p) });
      }
      for (const q of g.particles) {
        if (q.z == null) q.z = q.kind === 'smoke' ? 4 + Math.random() * 8 : q.kind === 'fire' ? 6 + Math.random() * 8 : 3 + Math.random() * 13;
        const age = q.maxLife - q.life;
        const z = q.kind === 'smoke' ? q.z + age * 14 : q.confetti ? 18 + age * 22 : q.kind === 'spark' ? Math.max(0, q.z + age * 30 - age * age * 90) : q.z;
        const p = this.proj3(q.x, q.y, z);
        if (!p || p.d < 9 || !onScreen(p, q.size * p.s * 2 + 2)) continue;
        items.push({ d: p.d, f: () => this.drawParticle(q, p) });
      }
      for (const sm of g.smokes) {
        const fade = Math.min(1, sm.t / 0.8, (sm.max - sm.t) / 0.3 + 0.3);
        for (const pf of sm.puffs) {
          const wob = Math.sin(g.time * 1.5 + pf.ph) * 4;
          const pr = sm.r * pf.s;
          const p = this.proj3(sm.x + pf.dx * sm.r + wob, sm.y + pf.dy * sm.r - wob * 0.5, pr * 0.6);
          if (!p || !onScreen(p, pr * p.s + 4)) continue;
          items.push({ d: p.d, f: () => this.drawPuff(p, pr, fade) });
        }
      }
      for (const k of g.pickups) {
        const p = this.proj3(k.x, k.y, 8 + Math.sin(k.t * 3) * 1.5);
        if (!p || !onScreen(p, 12 * p.s)) continue;
        items.push({ d: p.d, f: () => this.drawPickup(k, p) });
      }
      for (const m of g.mines) {
        const p = this.proj3(m.x, m.y, 0.8);
        if (!p || !onScreen(p, 8 * p.s)) continue;
        items.push({ d: p.d, f: () => this.drawMine(m, p) });
      }

      items.sort((a, b) => b.d - a.d); // du plus loin au plus proche
      for (const it of items) it.f();
      if (t.alive) this.drawOwnBarrel(t);
    }

    /* Volumes d'un tank, proportions identiques au dessin vu de dessus */
    tankBoxes(o) {
      const s = o.stats, b = s.blindage, p = s.puissance, r = s.portee;
      const L = 28 + b * 0.8, W = 20 + b * 0.6;
      const bl = 14 + r * 1.6, bw = 3 + p * 0.5, tr = 6 + p * 0.45 + b * 0.15;
      const dead = !o.alive;
      if (!o._rgb) o._rgb = hexRgb(o.color);
      const col = dead ? [58, 54, 50] : o._rgb;
      const tur = dead ? [67, 62, 57] : col.map(v => Math.min(255, v * 1.1 + 6));
      const trk = dead ? [32, 32, 32] : [44, 44, 46];
      const ca = Math.cos(o.angle), sa = Math.sin(o.angle), rx = -sa, ry = ca;
      const off = W / 2 - 2.75;
      const tc = Math.cos(o.turret), ts = Math.sin(o.turret);
      const bmid = (2 + bl) / 2 - (o.recoil || 0) * 1.2;
      return [
        { x: o.x + rx * off, y: o.y + ry * off, ang: o.angle, hl: L / 2, hw: 2.75, z0: 0, z1: 7, rgb: trk },
        { x: o.x - rx * off, y: o.y - ry * off, ang: o.angle, hl: L / 2, hw: 2.75, z0: 0, z1: 7, rgb: trk },
        { x: o.x, y: o.y, ang: o.angle, hl: L / 2 - 2, hw: W / 2 - 3, z0: 4, z1: 11, rgb: col },
        { x: o.x, y: o.y, ang: o.turret, hl: tr * 1.05, hw: tr * 0.9, z0: 11, z1: 16, rgb: tur },
        { x: o.x + tc * bmid, y: o.y + ts * bmid, ang: o.turret, hl: (bl - 2) / 2, hw: bw / 2, z0: 13.5 - bw * 0.4, z1: 13.5 + bw * 0.4, rgb: dead ? [42, 39, 37] : [60, 60, 62] },
      ];
    }

    addBox(b, out, fogF, flash) {
      const ca = Math.cos(b.ang), sa = Math.sin(b.ang);
      const fx = ca * b.hl, fy = sa * b.hl, rx = -sa * b.hw, ry = ca * b.hw;
      const xs = [b.x + fx + rx, b.x + fx - rx, b.x - fx - rx, b.x - fx + rx];
      const ys = [b.y + fy + ry, b.y + fy - ry, b.y - fy - ry, b.y - fy + ry];
      const nx = [ca, sa, -ca, -sa], ny = [sa, -ca, -sa, ca]; // normales des faces avant, droite, arrière, gauche
      for (let k = 0; k < 4; k++) {
        const k2 = (k + 1) & 3;
        if ((xs[k] - this.cx) * nx[k] + (ys[k] - this.cy) * ny[k] >= 0) continue; // face cachée
        const lit = 0.55 + 0.4 * Math.max(0, -(nx[k] * LIGHT.x + ny[k] * LIGHT.y));
        this.face(out, [xs[k], ys[k], b.z0, xs[k2], ys[k2], b.z0, xs[k2], ys[k2], b.z1, xs[k], ys[k], b.z1], b.rgb, lit, fogF, flash);
      }
      if (this.eye > b.z1) this.face(out, [xs[0], ys[0], b.z1, xs[1], ys[1], b.z1, xs[2], ys[2], b.z1, xs[3], ys[3], b.z1], b.rgb, 1.05, fogF, flash);
    }

    face(out, pts, rgb, lit, fogF, flash) {
      const F = this.F, R = this.R, cx = this.cx, cy = this.cy;
      let poly = [], dsum = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const dx = pts[i] - cx, dy = pts[i + 1] - cy;
        const d = dx * F.x + dy * F.y;
        dsum += d;
        poly.push({ l: dx * R.x + dy * R.y, d, h: pts[i + 2] });
      }
      poly = clipNear(poly);
      if (poly.length < 3) return;
      const half = this.rw / 2, proj = this.proj, hor = this.hor, eye = this.eye, jx = this.jx;
      const s = poly.map(p => [half + p.l * proj / p.d + jx, hor + (eye - p.h) * proj / p.d]);
      let r = rgb[0] * lit, g = rgb[1] * lit, b = rgb[2] * lit;
      if (flash > 0) { r += (255 - r) * flash; g += (255 - g) * flash; b += (255 - b) * flash; }
      r = r * (1 - fogF) + FOG[0] * fogF; g = g * (1 - fogF) + FOG[1] * fogF; b = b * (1 - fogF) + FOG[2] * fogF;
      out.push({ d: dsum / 4, s, c: rgbStr(r, g, b) });
    }

    fillFaces(faces) {
      const bx = this.bx;
      faces.sort((a, b) => b.d - a.d);
      for (const f of faces) {
        bx.fillStyle = f.c;
        bx.beginPath();
        bx.moveTo(f.s[0][0], f.s[0][1]);
        for (let i = 1; i < f.s.length; i++) bx.lineTo(f.s[i][0], f.s[i][1]);
        bx.closePath();
        bx.fill();
      }
    }

    drawTank(o, p) {
      const bx = this.bx;
      const ext = 34 * p.s + 3;
      bx.save();
      if (!this.clip(p.x - ext, p.x + ext, p.d - 18)) { bx.restore(); return; }
      const fogF = clamp((p.d - FOG0) / (FOG1 - FOG0), 0, 0.9);
      const faces = [];
      for (const b of this.tankBoxes(o)) this.addBox(b, faces, fogF, o.alive ? (o.hitFlash || 0) * 0.6 : 0);
      this.fillFaces(faces);
      if (o.alive) {
        const s = o.stats;
        const bl = 14 + s.portee * 1.6;
        const tip = this.proj3(o.x + Math.cos(o.turret) * bl, o.y + Math.sin(o.turret) * bl, 13.5);
        if (tip && o.flash > 0) {
          bx.globalAlpha = o.flash;
          bx.fillStyle = '#ffd36b';
          bx.beginPath(); bx.arc(tip.x, tip.y, Math.max(1.2, (6 + s.puissance * 1.2) * tip.s * 0.7), 0, TAU); bx.fill();
          bx.fillStyle = '#fff6d0';
          bx.beginPath(); bx.arc(tip.x, tip.y, Math.max(0.8, (6 + s.puissance * 1.2) * tip.s * 0.35), 0, TAU); bx.fill();
          bx.globalAlpha = 1;
        }
        if (tip && o.explosiveNext) {
          bx.fillStyle = 'rgba(255,140,40,0.9)';
          bx.beginPath(); bx.arc(tip.x, tip.y, Math.max(1, 3.5 * tip.s), 0, TAU); bx.fill();
        }
        if (o.shieldT > 0) {
          const c = this.proj3(o.x, o.y, 9);
          if (c) {
            const rr = (25 + s.blindage * 0.5) * c.s;
            bx.globalAlpha = Math.min(1, o.shieldT * 2);
            bx.fillStyle = 'rgba(90,190,255,0.2)';
            bx.strokeStyle = 'rgba(150,220,255,0.9)';
            bx.lineWidth = Math.max(0.6, c.s * 1.5);
            bx.beginPath(); bx.ellipse(c.x, c.y, rr, rr * 0.75, 0, 0, TAU); bx.fill(); bx.stroke();
            bx.globalAlpha = 1;
          }
        }
      }
      bx.restore();
      if (o.alive && this.visibleAt(p.x, p.d - 18)) {
        const top = this.proj3(o.x, o.y, 24);
        if (top) this.tags.push({ o, x: top.x, y: top.y, d: p.d });
      }
    }

    drawShell(s, p) {
      if (!this.visibleAt(p.x, p.d)) return;
      const bx = this.bx;
      const r = Math.max(0.7, s.r * 0.45 * p.s);
      const tail = s.trail.length ? this.proj3(s.trail[0].x, s.trail[0].y, 13) : null;
      if (tail) {
        bx.strokeStyle = s.explosive ? 'rgba(255,170,80,0.55)' : 'rgba(255,230,160,0.5)';
        bx.lineWidth = Math.max(0.6, r * 0.9);
        bx.lineCap = 'round';
        bx.beginPath(); bx.moveTo(tail.x, tail.y); bx.lineTo(p.x, p.y); bx.stroke();
      }
      bx.fillStyle = s.explosive ? 'rgba(255,140,40,0.4)' : 'rgba(255,240,190,0.35)';
      bx.beginPath(); bx.arc(p.x, p.y, r * 1.9, 0, TAU); bx.fill();
      bx.fillStyle = s.explosive ? '#ffb347' : '#fff4c2';
      bx.beginPath(); bx.arc(p.x, p.y, r, 0, TAU); bx.fill();
    }

    drawParticle(q, p) {
      if (!this.visibleAt(p.x, p.d)) return;
      const bx = this.bx;
      const k = q.life / q.maxLife;
      const near = clamp((p.d - 25) / 90, 0, 1); // tout près : on estompe (fumée de son propre canon)
      if (q.kind === 'smoke') {
        bx.globalAlpha = k * 0.38 * near;
        bx.fillStyle = q.color;
        bx.beginPath(); bx.arc(p.x, p.y, Math.max(0.8, q.size * p.s), 0, TAU); bx.fill();
      } else if (q.kind === 'fire') {
        const r = Math.max(1, q.size * p.s);
        bx.globalAlpha = k * 0.85 * near;
        bx.fillStyle = '#ff9a3c';
        bx.beginPath(); bx.arc(p.x, p.y, r, 0, TAU); bx.fill();
        bx.fillStyle = '#fff2b0';
        bx.beginPath(); bx.arc(p.x, p.y, r * 0.45, 0, TAU); bx.fill();
      } else {
        bx.globalAlpha = Math.min(1, k * 1.5) * near;
        bx.fillStyle = q.color;
        const r = Math.max(0.6, q.size * p.s * 0.6);
        if (q.square || q.confetti) bx.fillRect(p.x - r, p.y - r * (q.confetti ? 0.5 : 1), r * 2, r * (q.confetti ? 1 : 2));
        else { bx.beginPath(); bx.arc(p.x, p.y, r, 0, TAU); bx.fill(); }
      }
      bx.globalAlpha = 1;
    }

    drawPuff(p, pr, fade) {
      const bx = this.bx, r = pr * p.s;
      bx.save();
      if (this.clip(p.x - r, p.x + r, p.d - pr * 0.5)) {
        const grd = bx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grd.addColorStop(0, `rgba(205,205,200,${0.85 * fade})`);
        grd.addColorStop(1, 'rgba(205,205,200,0)');
        bx.fillStyle = grd;
        bx.beginPath(); bx.arc(p.x, p.y, r, 0, TAU); bx.fill();
      }
      bx.restore();
    }

    drawPickup(k, p) {
      if (!this.visibleAt(p.x, p.d)) return;
      const bx = this.bx, s = 9 * p.s * (1 + Math.sin(k.t * 5) * 0.08);
      bx.fillStyle = 'rgba(80,255,120,0.22)';
      bx.beginPath(); bx.arc(p.x, p.y, s * 1.7, 0, TAU); bx.fill();
      bx.fillStyle = '#f4f4f4';
      bx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
      bx.fillStyle = '#2fbf4f';
      bx.fillRect(p.x - s * 0.28, p.y - s * 0.7, s * 0.56, s * 1.4);
      bx.fillRect(p.x - s * 0.7, p.y - s * 0.28, s * 1.4, s * 0.56);
    }

    drawMine(m, p) {
      if (!this.visibleAt(p.x, p.d)) return;
      const bx = this.bx, rx = Math.max(1, 6.5 * p.s), ry = Math.max(0.5, rx * clamp(this.eye / p.d, 0.08, 1));
      bx.fillStyle = 'rgba(25,25,25,0.9)';
      bx.beginPath(); bx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU); bx.fill();
      bx.strokeStyle = m.owner.color; bx.lineWidth = Math.max(0.5, p.s);
      bx.stroke();
      const on = m.armT <= 0 && Math.sin(this.g.time * 9 + m.x) > 0;
      bx.fillStyle = on ? '#ff3b3b' : '#5a1a1a';
      bx.beginPath(); bx.arc(p.x, p.y - ry * 0.3, Math.max(0.7, 2 * p.s), 0, TAU); bx.fill();
    }

    /* Tube à 8 pans le long de l'axe ang (pour son propre canon) */
    addTube(ox, oy, ang, a0, a1, rad, zc, rgb, out) {
      const ca = Math.cos(ang), sa = Math.sin(ang), rx = -sa, ry = ca;
      const N = 8, ex = this.cx, ey = this.cy, ez = this.eye;
      for (let k = 0; k < N; k++) {
        const p0 = (k / N) * TAU, p1 = ((k + 1) / N) * TAU, pm = (p0 + p1) / 2;
        const nl = Math.cos(pm), nz = Math.sin(pm);
        // centre de la face et visibilité
        const am = (a0 + a1) / 2;
        const fx = ox + ca * am + rx * nl * rad, fy = oy + sa * am + ry * nl * rad, fz = zc + nz * rad;
        if ((fx - ex) * rx * nl + (fy - ey) * ry * nl + (fz - ez) * nz >= 0) continue;
        const lit = 0.45 + 0.4 * Math.max(0, nz) + 0.2 * Math.max(0, -(rx * nl * LIGHT.x + ry * nl * LIGHT.y));
        const c0 = Math.cos(p0) * rad, s0 = Math.sin(p0) * rad, c1 = Math.cos(p1) * rad, s1 = Math.sin(p1) * rad;
        this.face(out, [
          ox + ca * a0 + rx * c0, oy + sa * a0 + ry * c0, zc + s0,
          ox + ca * a1 + rx * c0, oy + sa * a1 + ry * c0, zc + s0,
          ox + ca * a1 + rx * c1, oy + sa * a1 + ry * c1, zc + s1,
          ox + ca * a0 + rx * c1, oy + sa * a0 + ry * c1, zc + s1,
        ], rgb, lit, 0, 0);
      }
    }

    /* Le canon de son propre tank, en bas à gauche du viseur */
    drawOwnBarrel(t) {
      const s = t.stats, p = s.puissance;
      // Vu de si près, le canon de la carte paraîtrait trapu : on l'allonge (portée = canon long)
      const bl = 36 + s.portee * 3, rad = (3 + p * 0.5) * 0.42;
      const rec = (t.recoil || 0) * 2;
      const F = this.F;
      const faces = [];
      // le début du canon est caché dans la tourelle ; frein de bouche au bout
      this.addTube(t.x, t.y, this.camA, 12 - rec, bl - 5 - rec, rad, 13.5, [70, 72, 76], faces);
      this.addTube(t.x, t.y, this.camA, bl - 5 - rec, bl - rec, rad + 1, 13.5, [92, 94, 98], faces);
      this.fillFaces(faces);
      if (t.flash > 0) {
        const tip = this.proj3(t.x + F.x * (bl + 3), t.y + F.y * (bl + 3), 13.5);
        if (tip) {
          const bx = this.bx, r = (2.5 + p * 0.35) * tip.s * (0.6 + t.flash * 0.6);
          bx.globalAlpha = Math.min(1, t.flash * 1.2);
          bx.fillStyle = '#ffc04a';
          bx.beginPath(); bx.arc(tip.x, tip.y, r, 0, TAU); bx.fill();
          bx.fillStyle = '#fff7d6';
          bx.beginPath(); bx.arc(tip.x, tip.y, r * 0.5, 0, TAU); bx.fill();
          bx.globalAlpha = 1;
        }
      }
    }

    /* ================= Par-dessus la vue (pleine résolution) ================= */
    drawOverlay(ctx, L, t) {
      const g = this.g, s = L.s, W = L.vw, H = L.vh;
      const kx = W / this.rw, ky = H / this.rh;
      const cxv = W / 2 + this.jx * kx, hy = this.hor * ky;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

      // Pris dans un nuage de fumée : on n'y voit plus rien
      for (const sm of g.smokes) {
        const d = Math.hypot(this.cx - sm.x, this.cy - sm.y);
        if (d < sm.r * 0.85) {
          const fade = Math.min(1, sm.t / 0.8, (sm.max - sm.t) / 0.3 + 0.3);
          ctx.fillStyle = `rgba(200,200,195,${0.7 * fade * clamp(1.2 - d / sm.r, 0, 1)})`;
          ctx.fillRect(0, 0, W, H);
        }
      }
      // Hors de la zone : tout vire au rouge
      const z = g.zone;
      if (z.active && Math.hypot(t.x - z.x, t.y - z.y) > z.r && t.alive) {
        ctx.fillStyle = `rgba(200,20,50,${0.18 + 0.1 * Math.sin(g.time * 8)})`;
        ctx.fillRect(0, 0, W, H);
        this.banner(ctx, W / 2, H * 0.3, '☢️ OUTSIDE THE ZONE', '#ffb0c0', 22 * s);
      }
      // Lueur du tir
      if (t.flash > 0) { ctx.fillStyle = `rgba(255,220,150,${t.flash * 0.12})`; ctx.fillRect(0, 0, W, H); }

      // Vignettage (effet de viseur)
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.58);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      // Touché : bords rouges
      if (t.hitFlash > 0 && t.alive) {
        const hg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
        hg.addColorStop(0, 'rgba(255,30,30,0)');
        hg.addColorStop(1, `rgba(255,30,30,${t.hitFlash * 0.75})`);
        ctx.fillStyle = hg;
        ctx.fillRect(0, 0, W, H);
      }

      // Étiquettes des tanks visibles
      const tg = t.alive && t.brain.target && t.brain.target.alive ? t.brain.target : null;
      let tgTag = null;
      ctx.textAlign = 'center';
      for (const tag of this.tags) {
        const o = tag.o, X = tag.x * kx, Y = tag.y * ky;
        if (o === tg) tgTag = tag;
        const a = clamp(1.3 - tag.d / 900, 0.35, 1);
        ctx.globalAlpha = a;
        ctx.font = `bold ${Math.round(12 * s)}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(o.name, X + 1, Y + 1);
        ctx.fillStyle = HB.isEnemy(t, o) ? o.color : '#9fe8a8';
        ctx.fillText(o.name, X, Y);
        const bw = 40 * s, bh = 4 * s;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(X - bw / 2 - 1, Y + 4 * s - 1, bw + 2, bh + 2);
        const r = o.hpRatio;
        ctx.fillStyle = r > 0.5 ? '#4fdc6a' : r > 0.25 ? '#f2c230' : '#ff4d4d';
        ctx.fillRect(X - bw / 2, Y + 4 * s, bw * r, bh);
        ctx.globalAlpha = 1;
      }

      // Cible du pilote : crochets si on la voit, flèche sur le bord sinon
      if (tg) {
        if (tgTag) {
          const p = this.proj3(tg.x, tg.y, 8);
          if (p) {
            const X = p.x * kx, Y = p.y * ky, r = Math.max(16 * s, 22 * p.s * kx);
            const locked = !!t.brain.aimTarget;
            ctx.strokeStyle = locked ? '#ff4a4a' : 'rgba(255,233,168,0.85)';
            ctx.lineWidth = 2 * s;
            const q = r * 0.4;
            ctx.beginPath();
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
              ctx.moveTo(X + sx * r, Y + sy * r - sy * q); ctx.lineTo(X + sx * r, Y + sy * r); ctx.lineTo(X + sx * r - sx * q, Y + sy * r);
            }
            ctx.stroke();
          }
        } else {
          const rel = angDiff(Math.atan2(tg.y - this.cy, tg.x - this.cx), this.camA);
          if (Math.abs(rel) > this.fov / 2) {
            const right = rel > 0, X = right ? W - 34 * s : 34 * s;
            ctx.fillStyle = '#ffe9a8';
            ctx.beginPath();
            ctx.moveTo(X + (right ? 16 : -16) * s, hy);
            ctx.lineTo(X + (right ? -6 : 6) * s, hy - 13 * s);
            ctx.lineTo(X + (right ? -6 : 6) * s, hy + 13 * s);
            ctx.closePath(); ctx.fill();
            ctx.font = `bold ${Math.round(11 * s)}px system-ui, sans-serif`;
            ctx.textAlign = right ? 'right' : 'left';
            ctx.fillText(tg.name, X + (right ? -10 : 10) * s, hy + 30 * s);
            ctx.textAlign = 'center';
          }
        }
      }

      // Dégâts flottants
      ctx.font = `bold ${Math.round(14 * s)}px system-ui, sans-serif`;
      for (const tx of g.texts) {
        if (tx.wx == null) { tx.wx = tx.x; tx.wy = tx.y + 24; }
        const p = this.proj3(tx.wx, tx.wy, 26 + (tx.maxLife - tx.life) * 28);
        if (!p || p.d < 30 || !this.visibleAt(p.x, p.d - 16)) continue;
        ctx.globalAlpha = Math.min(1, tx.life / tx.maxLife * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(tx.str, p.x * kx + 1, p.y * ky + 1);
        ctx.fillStyle = tx.color;
        ctx.fillText(tx.str, p.x * kx, p.y * ky);
      }
      ctx.globalAlpha = 1;

      if (t.alive) this.drawReticle(ctx, cxv, hy, s, t);
      this.drawCompass(ctx, W / 2, 10 * s, s, tg);

      // Messages du pilote
      ctx.textAlign = 'left';
      ctx.font = `bold ${Math.round(14 * s)}px system-ui, sans-serif`;
      this.msgs.forEach((m, i) => {
        const y = 62 * s + i * 22 * s;
        ctx.globalAlpha = clamp(m.life / 0.6, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        const w = ctx.measureText(m.text).width;
        ctx.fillRect(12 * s, y - 15 * s, w + 16 * s, 21 * s);
        ctx.fillStyle = m.color;
        ctx.fillText(m.text, 20 * s, y);
      });
      ctx.globalAlpha = 1;

      // Épave : écran « détruit »
      if (!t.alive) {
        ctx.fillStyle = 'rgba(40,0,0,0.45)';
        ctx.fillRect(0, 0, W, H);
        this.banner(ctx, W / 2, H * 0.42, '💥 DESTROYED', '#ff8a7a', 34 * s);
        const by = t.killer ? `by ${t.killer.name}` : (t.place ? 'swallowed by the zone' : '');
        if (by) this.banner(ctx, W / 2, H * 0.42 + 40 * s, by, '#ffd0c0', 16 * s);
      } else if (this.hintT > 0) {
        ctx.globalAlpha = clamp(this.hintT, 0, 1);
        const capped = g.speed > 2;
        const hint = (HB.isTouch ? 'Inside view · tap the radar to go back to the map' : 'Inside view · press V or Esc to go back to the map') +
          (capped ? ' · speed limited to ×2' : '');
        this.banner(ctx, W / 2, H - 22 * s, hint, '#e8e2cf', 13 * s);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    banner(ctx, x, y, text, color, size) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.round(size)}px system-ui, sans-serif`;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - w / 2 - size * 0.6, y - size, w + size * 1.2, size * 1.45);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.restore();
    }

    /* Viseur : l'anneau se remplit pendant le rechargement */
    drawReticle(ctx, x, y, s, t) {
      const ready = t.reloadT <= 0;
      const k = 1 - clamp(t.reloadT / t.d.reload, 0, 1);
      const locked = !!t.brain.aimTarget;
      const col = ready ? (locked ? '#ff5a4a' : '#7dffa0') : 'rgba(255,255,255,0.75)';
      const r = 20 * s;
      ctx.save();
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r - 12 * s, y); ctx.lineTo(x - r + 5 * s, y);
      ctx.moveTo(x + r - 5 * s, y); ctx.lineTo(x + r + 12 * s, y);
      ctx.moveTo(x, y + r - 5 * s); ctx.lineTo(x, y + r + 12 * s);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(x - 1.5 * s, y - 1.5 * s, 3 * s, 3 * s);
      ctx.restore();
    }

    /* Boussole : N en haut de la carte */
    drawCompass(ctx, x, y, s, tg) {
      const w = 380 * s, h = 26 * s, span = Math.PI / 3;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x - w / 2, y, w, h);
      ctx.beginPath(); ctx.rect(x - w / 2, y, w, h); ctx.clip();
      ctx.textAlign = 'center';
      ctx.lineWidth = 1.5 * s;
      for (let deg = 0; deg < 360; deg += 15) {
        const ang = (deg - 90) * Math.PI / 180;
        const rel = angDiff(ang, this.camA);
        if (Math.abs(rel) > span + 0.2) continue;
        const X = x + rel / span * w / 2;
        const major = deg % 90 === 0;
        ctx.strokeStyle = major ? '#ffe9a8' : 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.moveTo(X, y + h); ctx.lineTo(X, y + h - (major ? 9 : 5) * s); ctx.stroke();
        if (major || deg % 45 === 0) {
          ctx.font = `bold ${Math.round((major ? 13 : 10) * s)}px system-ui, sans-serif`;
          ctx.fillStyle = major ? '#ffe9a8' : 'rgba(255,255,255,0.6)';
          ctx.fillText(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][deg / 45], X, y + 13 * s);
        }
      }
      if (tg) {
        const rel = clamp(angDiff(Math.atan2(tg.y - this.cy, tg.x - this.cx), this.camA), -span, span);
        ctx.fillStyle = '#ff5a4a';
        ctx.beginPath(); ctx.arc(x + rel / span * w / 2, y + h - 4 * s, 3.5 * s, 0, TAU); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath(); ctx.moveTo(x, y + h + 1); ctx.lineTo(x - 6 * s, y + h + 9 * s); ctx.lineTo(x + 6 * s, y + h + 9 * s); ctx.closePath(); ctx.fill();
    }

    /* ================= Tableau de bord ================= */
    drawPanel(ctx, L, t) {
      const g = this.g, s = L.s, y0 = L.py, W = L.W, H = L.ph;
      ctx.save();
      const bg = ctx.createLinearGradient(0, y0, 0, y0 + H);
      bg.addColorStop(0, '#24282e'); bg.addColorStop(1, '#121417');
      ctx.fillStyle = bg;
      ctx.fillRect(0, y0, W, H);
      ctx.fillStyle = '#3d434b';
      ctx.fillRect(0, y0, W, 3 * s);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, y0 + 3 * s, W, 2 * s);
      // rivets
      ctx.fillStyle = '#4a5058';
      for (const rx of [14 * s, W - 14 * s]) for (const ry of [y0 + 16 * s, y0 + H - 14 * s]) { ctx.beginPath(); ctx.arc(rx, ry, 3 * s, 0, TAU); ctx.fill(); }

      const pad = 26 * s;
      const R = L.portrait ? 160 : Math.min(74 * s, H * 0.42);
      const rcx = W - pad - R, rcy = L.portrait ? y0 + H * 0.47 : y0 + H / 2 + 2;
      this.drawRadar(ctx, t, rcx, rcy, R, s);

      const x0 = pad, colW = L.portrait ? rcx - R - pad * 1.6 - x0 : 380 * s;
      let y = y0 + 34 * s;
      // En-tête : nom + pilote
      const beh = HB.BEHAVIORS[t.cfg.behavior] || {};
      ctx.textAlign = 'left';
      ctx.fillStyle = t.color;
      ctx.beginPath(); ctx.arc(x0 + 7 * s, y - 6 * s, 7 * s, 0, TAU); ctx.fill();
      ctx.font = `bold ${Math.round(20 * s)}px system-ui, sans-serif`;
      ctx.fillStyle = '#f2ecd8';
      ctx.fillText(t.name, x0 + 22 * s, y);
      const nw = ctx.measureText(t.name).width;
      ctx.font = `${Math.round(14 * s)}px system-ui, sans-serif`;
      ctx.fillStyle = '#a7a08a';
      ctx.fillText(`${beh.icon || ''} ${beh.label || ''}${g.player === t ? ' · YOU' : ''}`, x0 + 30 * s + nw, y);

      // Jauges
      y += 20 * s;
      const hpC = t.hpRatio > 0.5 ? '#4fdc6a' : t.hpRatio > 0.25 ? '#f2c230' : '#ff4d4d';
      this.gauge(ctx, x0, y, colW, s, t.shieldT > 0 ? 'ARMOR 💠' : 'ARMOR', t.alive ? `${Math.ceil(t.hp)} / ${t.d.maxHp}` : 'DESTROYED', t.hpRatio, t.shieldT > 0 ? '#7cc8ff' : hpC);
      y += 40 * s;
      const rl = 1 - clamp(t.reloadT / t.d.reload, 0, 1);
      this.gauge(ctx, x0, y, colW, s, 'RELOAD', !t.alive ? '—' : t.reloadT <= 0 ? 'READY' : `${t.reloadT.toFixed(1)} s`, t.alive ? rl : 0, rl >= 1 ? '#9ad7ff' : '#5b8bb0');
      y += 44 * s;
      const sp = Math.hypot(t.vx, t.vy) * 0.4;
      ctx.font = `bold ${Math.round(15 * s)}px system-ui, sans-serif`;
      ctx.fillStyle = '#e8e2cf';
      ctx.fillText(`${t.nitroT > 0 ? '🔥 ' : ''}${Math.round(sp)} km/h`, x0, y);
      ctx.fillStyle = '#a7a08a';
      ctx.font = `${Math.round(14 * s)}px system-ui, sans-serif`;
      const score = `⚔ ${t.kills} kill${t.kills === 1 ? '' : 's'} · ${Math.round(t.damageDealt)} dmg · ${t.shots ? Math.round(100 * t.hits / t.shots) : 0}% hits`;
      if (L.portrait) { y += 28 * s; ctx.fillText(score, x0, y); }
      else ctx.fillText(score, x0 + 120 * s, y);

      // Pilote et modules : à droite des jauges en paysage, dessous en portrait
      let mx, my, mw;
      if (L.portrait) { mx = x0; my = y + 34 * s; mw = colW; }
      else { mx = x0 + colW + 40; my = y0 + 34 * s; mw = rcx - R - 30 - mx; }
      ctx.font = `italic ${Math.round(15 * s)}px system-ui, sans-serif`;
      ctx.fillStyle = '#ffe9a8';
      const status = t.alive ? `🧠 ${t.brain.shown}` : '💀 Out of the fight';
      ctx.fillText(this.fit(ctx, status, mw), mx, my);
      my += 18 * s;
      if (t.mods.length) {
        const box = 44 * s;
        t.mods.forEach((m, i) => {
          const bx = mx + i * (box + 100 * s), by = my;
          const ready = m.cd <= 0 && m.uses > 0;
          ctx.fillStyle = ready ? '#2f3a2f' : '#25282c';
          HB.roundRect(ctx, bx, by, box, box, 8 * s); ctx.fill();
          ctx.strokeStyle = ready ? '#7dffa0' : '#454b53';
          ctx.lineWidth = 2 * s; ctx.stroke();
          ctx.textAlign = 'center';
          ctx.font = `${Math.round(24 * s)}px system-ui, sans-serif`;
          ctx.globalAlpha = ready ? 1 : 0.45;
          ctx.fillText(m.def.icon, bx + box / 2, by + box * 0.7);
          ctx.globalAlpha = 1;
          if (!ready && m.uses > 0 && m.def.cooldown) {
            const k = clamp(m.cd / m.def.cooldown, 0, 1);
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath(); ctx.moveTo(bx + box / 2, by + box / 2);
            ctx.arc(bx + box / 2, by + box / 2, box * 0.42, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.closePath(); ctx.fill();
          }
          ctx.textAlign = 'left';
          ctx.font = `bold ${Math.round(13 * s)}px system-ui, sans-serif`;
          ctx.fillStyle = '#e8e2cf';
          ctx.fillText(m.def.label, bx + box + 8 * s, by + 18 * s);
          ctx.font = `${Math.round(12 * s)}px system-ui, sans-serif`;
          ctx.fillStyle = ready ? '#7dffa0' : '#a7a08a';
          ctx.fillText(m.uses <= 0 ? 'Used' : ready ? 'Ready' : `${Math.ceil(m.cd)} s`, bx + box + 8 * s, by + 36 * s);
        });
      } else {
        ctx.font = `${Math.round(13 * s)}px system-ui, sans-serif`;
        ctx.fillStyle = '#7d7868';
        ctx.fillText('No modules', mx, my + 22 * s);
      }
      ctx.restore();
    }

    fit(ctx, text, w) {
      if (ctx.measureText(text).width <= w) return text;
      let s = text;
      while (s.length > 4 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
      return s + '…';
    }

    gauge(ctx, x, y, w, s, label, value, ratio, color) {
      ctx.font = `bold ${Math.round(11 * s)}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8f8a78';
      ctx.fillText(label, x, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#e8e2cf';
      ctx.fillText(value, x + w, y);
      ctx.textAlign = 'left';
      const by = y + 6 * s, bh = 13 * s;
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(x, by, w, bh);
      ctx.fillStyle = color;
      ctx.fillRect(x + 2, by + 2, Math.max(0, (w - 4) * clamp(ratio, 0, 1)), bh - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 2, by + 2, Math.max(0, (w - 4) * clamp(ratio, 0, 1)), (bh - 4) * 0.4);
    }

    /* Radar : la carte tourne pour que l'avant soit en haut */
    drawRadar(ctx, t, cx, cy, R, s) {
      const g = this.g;
      this.radar = { x: cx, y: cy, r: R };
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU);
      ctx.fillStyle = '#0c1610'; ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.translate(cx, cy);
      ctx.rotate(-this.camA - Math.PI / 2);
      const k = R / RADAR_RANGE;
      ctx.scale(k, k);
      ctx.translate(-t.x, -t.y);
      ctx.globalAlpha = 0.5; ctx.drawImage(g.ground, 0, 0); ctx.globalAlpha = 1;
      ctx.drawImage(g.walls, 0, 0);
      ctx.fillStyle = '#8a5f30';
      g.forCells(T.CRATE, (x, y) => ctx.fillRect(x * C + 3, y * C + 3, C - 6, C - 6));
      const z = g.zone;
      if (z.active) {
        ctx.fillStyle = 'rgba(190,20,50,0.3)';
        ctx.beginPath(); ctx.rect(-2000, -2000, HB.W + 4000, HB.H + 4000); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(255,60,90,0.9)'; ctx.lineWidth = 2.5 / k;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
      }
      for (const p of g.pickups) { ctx.fillStyle = '#5f5'; ctx.beginPath(); ctx.arc(p.x, p.y, 3 / k, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#fff4c2';
      for (const sh of g.shells) { ctx.beginPath(); ctx.arc(sh.x, sh.y, 1.6 / k, 0, TAU); ctx.fill(); }
      const tg = t.brain.target;
      for (const o of g.tanks) {
        if (o === t) continue;
        if (!o.alive) { ctx.fillStyle = '#555'; ctx.fillRect(o.x - 2.5 / k, o.y - 2.5 / k, 5 / k, 5 / k); continue; }
        ctx.fillStyle = o.color;
        ctx.beginPath(); ctx.arc(o.x, o.y, 5 * s / k, 0, TAU); ctx.fill();
        if (o === tg) { ctx.strokeStyle = '#ff5a4a'; ctx.lineWidth = 2 / k; ctx.beginPath(); ctx.arc(o.x, o.y, 9 * s / k, 0, TAU); ctx.stroke(); }
      }
      ctx.restore();
      // champ de vision
      ctx.fillStyle = 'rgba(255,240,180,0.10)';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, -Math.PI / 2 - this.fov / 2, -Math.PI / 2 + this.fov / 2); ctx.closePath(); ctx.fill();
      // balayage
      const sw = (g.time * 2) % TAU;
      ctx.strokeStyle = 'rgba(125,255,160,0.25)'; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sw) * R, cy + Math.sin(sw) * R); ctx.stroke();
      // soi-même
      ctx.fillStyle = t.alive ? t.color : '#777';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * s;
      ctx.beginPath(); ctx.moveTo(cx, cy - 9 * s); ctx.lineTo(cx - 6 * s, cy + 6 * s); ctx.lineTo(cx + 6 * s, cy + 6 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
      // cadre
      ctx.strokeStyle = '#4a5058'; ctx.lineWidth = 4 * s;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(125,255,160,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, TAU); ctx.stroke();
      if (HB.isTouch) {
        ctx.font = `bold ${Math.round(10 * s)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(232,226,207,0.7)';
        ctx.fillText('TAP FOR MAP', cx, cy + R - 10 * s);
      }
      ctx.restore();
    }

    /* ================= Son ================= */
    sound(dt) {
      const t = this.g.cam.follow;
      if (!t) return;
      HB.sfx.listener = { x: t.x, y: t.y, a: this.camA == null ? t.turret : this.camA };
      this.sndT -= dt;
      if (this.sndT > 0) return;
      this.sndT = 0.1;
      const lvl = t.alive && !this.g.paused ? clamp(Math.hypot(t.vx, t.vy) / Math.max(40, t.d.speed), 0, 1.3) : -1;
      HB.sfx.engine(lvl, t.nitroT > 0);
    }

    /* ================= Le pilote parle ================= */
    say(text, color, key, gap) {
      const now = this.g.time;
      if (key) { if (now - (this.said[key] ?? -99) < gap) return; this.said[key] = now; }
      this.msgs.unshift({ text, color: color || '#e8e2cf', life: 3.2 });
      if (this.msgs.length > 4) this.msgs.length = 4;
    }
    snap(t) {
      return { kills: t.kills, hits: t.hits, taken: t.damageTaken, target: t.brain.target, mode: t.brain.mode,
        low: t.hpRatio < 0.25, cds: t.mods.map(m => m.cd), alive: t.alive };
    }
    track(t) {
      if (this.watch !== t) {
        this.watch = t; this.prev = this.snap(t); this.said = {}; this.msgs = [];
        this.say(`🎧 Inside ${t.name}`, '#e8e2cf');
        return;
      }
      const p = this.prev, n = this.snap(t);
      if (!n.alive) { if (p.alive) this.say('💥 We are destroyed!', '#ff6b6b'); this.prev = n; return; }
      if (n.kills > p.kills) this.say('💀 Target destroyed!', '#ffd84a');
      else if (n.hits > p.hits) this.say('🎯 Hit!', '#8cff9a', 'hit', 0.8);
      if (n.taken - p.taken >= 3) this.say("💥 We're hit!", '#ff8a7a', 'hurt', 1.5);
      n.cds.forEach((cd, i) => {
        if (cd > (p.cds[i] ?? 0) + 0.5) { const d = t.mods[i].def; this.say(`${d.icon} ${d.label}!`, '#9fd8ff'); }
      });
      if (n.low && !p.low) this.say('⚠️ Armor critical!', '#ff6b6b');
      if (n.target && n.target !== p.target) this.say(`👁 Target: ${n.target.name}`, '#ffe9a8', 'target', 3);
      if (n.mode !== p.mode && n.mode === 'retreat') this.say('↩️ Falling back!', '#ffe9a8', 'retreat', 5);
      this.prev = n;
    }
  }

  HB.Cockpit = Cockpit;
})();
