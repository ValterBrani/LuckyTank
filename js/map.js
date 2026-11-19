'use strict';
/* =========================================================================
 * Carte : génération aléatoire, ligne de vue, pathfinding A*
 * ========================================================================= */
(function () {
  const HB = window.HB;

  HB.CELL = 32;
  /* Paysage 40×25 (1280×800) par défaut ; portrait 25×40 sur téléphone tenu droit.
   * Même nombre de cases dans les deux cas : l'équilibrage ne change pas. */
  HB.setOrientation = portrait => {
    HB.COLS = portrait ? 25 : 40;
    HB.ROWS = portrait ? 40 : 25;
    HB.W = HB.CELL * HB.COLS;
    HB.H = HB.CELL * HB.ROWS;
    HB.portrait = !!portrait;
  };
  HB.setOrientation(false);

  const EMPTY = 0, WALL = 1, CRATE = 2;
  HB.T = { EMPTY, WALL, CRATE };
  HB.CRATE_HP = 60;

  const DENSITY = { faible: 9, normale: 15, forte: 23 };

  class GameMap {
    constructor(seed, density = 'normale', tankCount = 4) {
      this.seed = seed;
      this.cols = HB.COLS;
      this.rows = HB.ROWS;
      this.grid = new Uint8Array(this.cols * this.rows);
      this.crateHp = new Float32Array(this.cols * this.rows);
      this.nearWall = new Uint8Array(this.cols * this.rows);
      this.rng = HB.makeRng(seed);
      this.version = 0; // incrémenté quand la carte change (caisse détruite)
      this.generate(DENSITY[density] || DENSITY.normale);
      this.spawns = this.pickSpawns(tankCount);
      this.decor = this.makeDecor();
    }

    idx(cx, cy) { return cy * this.cols + cx; }
    inBounds(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows; }
    cell(cx, cy) { return this.inBounds(cx, cy) ? this.grid[this.idx(cx, cy)] : WALL; }
    cellAt(x, y) { return this.cell(Math.floor(x / HB.CELL), Math.floor(y / HB.CELL)); }
    isFree(cx, cy) { return this.cell(cx, cy) === EMPTY; }
    center(cx, cy) { return { x: (cx + 0.5) * HB.CELL, y: (cy + 0.5) * HB.CELL }; }

    generate(blockCount) {
      const { cols, rows, rng } = this;
      for (let attempt = 0; attempt < 6; attempt++) {
        this.grid.fill(EMPTY);
        for (let x = 0; x < cols; x++) { this.grid[this.idx(x, 0)] = WALL; this.grid[this.idx(x, rows - 1)] = WALL; }
        for (let y = 0; y < rows; y++) { this.grid[this.idx(0, y)] = WALL; this.grid[this.idx(cols - 1, y)] = WALL; }

        // Blocs (murs ou tas de caisses) espacés d'au moins 2 cases
        let placed = 0;
        for (let tries = 0; tries < blockCount * 40 && placed < blockCount; tries++) {
          let w = 1 + Math.floor(rng() * 4), h = 1 + Math.floor(rng() * 3);
          if (rng() < 0.5) [w, h] = [h, w];
          const x = 2 + Math.floor(rng() * (cols - 4 - w));
          const y = 2 + Math.floor(rng() * (rows - 4 - h));
          if (!this.areaFree(x - 2, y - 2, w + 4, h + 4)) continue;
          const type = rng() < 0.28 ? CRATE : WALL;
          for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.setCell(xx, yy, type);
          placed++;
          // Parfois un bloc en "L"
          if (type === WALL && rng() < 0.3 && w + h > 3) {
            const lx = rng() < 0.5 ? x : x + w - 1, ly = y + h;
            if (ly < rows - 3 && this.areaFree(lx - 1, ly, 3, 3)) this.setCell(lx, ly, WALL);
          }
        }
        // Caisses isolées
        const crates = 6 + Math.floor(rng() * 8);
        for (let i = 0, tries = 0; i < crates && tries < 400; tries++) {
          const x = 2 + Math.floor(rng() * (cols - 4)), y = 2 + Math.floor(rng() * (rows - 4));
          if (!this.areaFree(x - 1, y - 1, 3, 3)) continue;
          this.setCell(x, y, CRATE);
          i++;
        }
        if (this.fixConnectivity()) break;
      }
      this.computeNearWall();
    }

    setCell(cx, cy, type) {
      const i = this.idx(cx, cy);
      this.grid[i] = type;
      this.crateHp[i] = type === CRATE ? HB.CRATE_HP : 0;
    }

    /* Vrai si aucune case intérieure de la zone n'est occupée (bordure ignorée) */
    areaFree(x0, y0, w, h) {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        if (x <= 0 || y <= 0 || x >= this.cols - 1 || y >= this.rows - 1) continue;
        if (this.grid[this.idx(x, y)] !== EMPTY) return false;
      }
      return true;
    }

    /* Remplit les poches inaccessibles ; renvoie false si la carte est trop morcelée */
    fixConnectivity() {
      const { cols, rows } = this;
      const seen = new Uint8Array(cols * rows);
      let start = -1, free = 0;
      for (let i = 0; i < this.grid.length; i++) if (this.grid[i] === EMPTY) { free++; if (start < 0) start = i; }
      if (start < 0) return false;
      const stack = [start];
      seen[start] = 1;
      let reached = 0;
      while (stack.length) {
        const i = stack.pop();
        reached++;
        const x = i % cols, y = (i / cols) | 0;
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dx, dy] of nb) {
          const nx = x + dx, ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (!seen[j] && this.grid[j] === EMPTY) { seen[j] = 1; stack.push(j); }
        }
      }
      if (reached < free * 0.9) return false;
      for (let i = 0; i < this.grid.length; i++) if (this.grid[i] === EMPTY && !seen[i]) this.grid[i] = WALL;
      return true;
    }

    computeNearWall() {
      const { cols, rows } = this;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && this.cell(x + dx, y + dy) !== EMPTY) n = 1;
        }
        this.nearWall[this.idx(x, y)] = n;
      }
    }

    /* Points d'apparition éloignés les uns des autres (échantillonnage du point le plus lointain) */
    pickSpawns(n) {
      const cand = [];
      for (let y = 2; y < this.rows - 2; y++) for (let x = 2; x < this.cols - 2; x++) {
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (!this.isFree(x + dx, y + dy)) { ok = false; break; }
        if (ok) cand.push(this.center(x, y));
      }
      const chosen = [];
      if (!cand.length) return chosen;
      // Commence près d'un coin aléatoire pour bien étaler
      const corner = { x: this.rng() < 0.5 ? 0 : HB.W, y: this.rng() < 0.5 ? 0 : HB.H };
      cand.sort((a, b) => HB.dist(a.x, a.y, corner.x, corner.y) - HB.dist(b.x, b.y, corner.x, corner.y));
      chosen.push(cand[Math.floor(this.rng() * Math.min(10, cand.length))]);
      while (chosen.length < n) {
        let best = null, bestD = -1;
        for (const c of cand) {
          let md = Infinity;
          for (const s of chosen) md = Math.min(md, HB.dist(c.x, c.y, s.x, s.y));
          md += this.rng() * 40; // un peu de hasard
          if (md > bestD) { bestD = md; best = c; }
        }
        chosen.push(best);
      }
      return chosen;
    }

    makeDecor() {
      const d = [];
      for (let i = 0; i < 70; i++) {
        d.push({ x: this.rng() * HB.W, y: this.rng() * HB.H, r: 6 + this.rng() * 26, a: 0.03 + this.rng() * 0.05, dark: this.rng() < 0.5 });
      }
      for (let i = 0; i < 40; i++) {
        d.push({ x: this.rng() * HB.W, y: this.rng() * HB.H, r: 1.5 + this.rng() * 2.5, a: 0.25, pebble: true });
      }
      return d;
    }

    randomFreePoint(rng = Math.random, margin = 1) {
      for (let i = 0; i < 500; i++) {
        const cx = 1 + Math.floor(rng() * (this.cols - 2)), cy = 1 + Math.floor(rng() * (this.rows - 2));
        let ok = true;
        for (let dy = -margin; dy <= margin && ok; dy++) for (let dx = -margin; dx <= margin; dx++) if (!this.isFree(cx + dx, cy + dy)) { ok = false; break; }
        if (ok) return this.center(cx, cy);
      }
      return { x: HB.W / 2, y: HB.H / 2 };
    }

    nearestFreeCell(x, y) {
      const cx0 = Math.floor(x / HB.CELL), cy0 = Math.floor(y / HB.CELL);
      if (this.isFree(cx0, cy0)) return { cx: cx0, cy: cy0 };
      for (let r = 1; r < 12; r++) {
        let best = null, bd = Infinity;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const cx = cx0 + dx, cy = cy0 + dy;
          if (!this.isFree(cx, cy)) continue;
          const c = this.center(cx, cy), d = HB.dist(x, y, c.x, c.y);
          if (d < bd) { bd = d; best = { cx, cy }; }
        }
        if (best) return best;
      }
      return { cx: cx0, cy: cy0 };
    }

    /* Dégâts sur une caisse ; renvoie true si elle est détruite */
    damageCrate(cx, cy, dmg) {
      const i = this.idx(cx, cy);
      if (this.grid[i] !== CRATE) return false;
      this.crateHp[i] -= dmg;
      if (this.crateHp[i] <= 0) {
        this.grid[i] = EMPTY;
        this.crateHp[i] = 0;
        this.computeNearWall();
        this.version++;
        return true;
      }
      return false;
    }

    /* Premier obstacle sur le segment (pas de 6 px). crates=false → les caisses ne bloquent pas */
    raycast(x0, y0, x1, y1, crates = true) {
      const len = HB.dist(x0, y0, x1, y1);
      const steps = Math.max(1, Math.ceil(len / 6));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const cx = Math.floor(x / HB.CELL), cy = Math.floor(y / HB.CELL);
        const c = this.cell(cx, cy);
        if (c === WALL || (crates && c === CRATE)) return { x, y, cx, cy, type: c };
      }
      return null;
    }

    hasLos(x0, y0, x1, y1, crates = true) { return !this.raycast(x0, y0, x1, y1, crates); }

    /* Ligne de vue "épaisse" : le tank peut-il rouler tout droit jusque-là ? */
    canDrive(x0, y0, x1, y1, radius = 14) {
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l * radius, ny = dx / l * radius;
      return this.hasLos(x0, y0, x1, y1) && this.hasLos(x0 + nx, y0 + ny, x1 + nx, y1 + ny) && this.hasLos(x0 - nx, y0 - ny, x1 - nx, y1 - ny);
    }

    /* A* 8 directions, sans couper les coins, pénalité près des murs */
    findPath(sx, sy, tx, ty) {
      const { cols, rows } = this;
      const s = this.nearestFreeCell(sx, sy), g = this.nearestFreeCell(tx, ty);
      const start = this.idx(s.cx, s.cy), goal = this.idx(g.cx, g.cy);
      if (start === goal) return [{ x: tx, y: ty }];
      const N = cols * rows;
      const gScore = new Float32Array(N).fill(Infinity);
      const came = new Int32Array(N).fill(-1);
      const closed = new Uint8Array(N);
      const heap = new MinHeap();
      const h = i => {
        const x = i % cols, y = (i / cols) | 0;
        const dx = Math.abs(x - g.cx), dy = Math.abs(y - g.cy);
        return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
      };
      gScore[start] = 0;
      heap.push(start, h(start));
      const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
      let found = false, iter = 0;
      while (heap.size && iter++ < 4000) {
        const cur = heap.pop();
        if (cur === goal) { found = true; break; }
        if (closed[cur]) continue;
        closed[cur] = 1;
        const x = cur % cols, y = (cur / cols) | 0;
        for (const [dx, dy, cost] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (!this.isFree(nx, ny)) continue;
          if (dx && dy && (!this.isFree(x + dx, y) || !this.isFree(x, y + dy))) continue;
          const ni = this.idx(nx, ny);
          if (closed[ni]) continue;
          const ng = gScore[cur] + cost + (this.nearWall[ni] ? 0.6 : 0);
          if (ng < gScore[ni]) {
            gScore[ni] = ng;
            came[ni] = cur;
            heap.push(ni, ng + h(ni));
          }
        }
      }
      if (!found) return null;
      const path = [];
      for (let c = goal; c !== start && c >= 0; c = came[c]) {
        path.push(this.center(c % cols, (c / cols) | 0));
      }
      path.reverse();
      if (path.length) path[path.length - 1] = { x: tx, y: ty };
      return path;
    }
  }

  class MinHeap {
    constructor() { this.items = []; this.prio = []; }
    get size() { return this.items.length; }
    push(item, p) {
      const a = this.items, q = this.prio;
      a.push(item); q.push(p);
      let i = a.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (q[parent] <= q[i]) break;
        [a[parent], a[i]] = [a[i], a[parent]];
        [q[parent], q[i]] = [q[i], q[parent]];
        i = parent;
      }
    }
    pop() {
      const a = this.items, q = this.prio;
      const top = a[0];
      const lastI = a.pop(), lastP = q.pop();
      if (a.length) {
        a[0] = lastI; q[0] = lastP;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && q[l] < q[m]) m = l;
          if (r < a.length && q[r] < q[m]) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          [q[m], q[i]] = [q[i], q[m]];
          i = m;
        }
      }
      return top;
    }
  }

  HB.GameMap = GameMap;
})();
