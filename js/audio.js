'use strict';
/* =========================================================================
 * Sons générés en direct (Web Audio) : aucun fichier audio nécessaire.
 * HB.sfx.shot(), .impact(), .explosion(), .crate(), .ram(), .pickup(),
 * .alarm(), .victory(), .start(), .ability(), .unlock()
 * Vue intérieure : .cabin(true) étouffe les bruits du dehors, .listener place
 * l'oreille dans le tank (gauche/droite et distance), .engine() fait gronder le moteur.
 * ========================================================================= */
(function () {
  const HB = window.HB;
  const STORE = 'hasardBattle.audio';

  class Sfx {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.noise = null;
      this.muted = false;
      this.volume = 0.6;
      this.last = {};
      this.voices = 0;
      this.maxVoices = 26;
      this.listener = null; // { x, y, a } : position et orientation de l'oreille (vue intérieure)
      this.eng = null;
      try {
        const d = JSON.parse(localStorage.getItem(STORE) || '{}');
        if (typeof d.volume === 'number') this.volume = HB.clamp(d.volume, 0, 1);
        if (d.muted) this.muted = true;
      } catch (e) { /* ignore */ }
    }

    /* Le navigateur n'autorise le son qu'après un clic ou une touche */
    unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) {
        const ctx = this.ctx = new AC();
        this.master = ctx.createGain();
        const comp = ctx.createDynamicsCompressor(); // évite la saturation quand tout explose
        comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5;
        comp.attack.value = 0.003; comp.release.value = 0.2;
        this.master.connect(comp);
        comp.connect(ctx.destination);
        // Bus « dehors » (passe par le filtre de l'habitacle en vue intérieure) et bus « dedans »
        this.world = ctx.createGain();
        this.world.connect(this.master);
        this.cabinF = ctx.createBiquadFilter();
        this.cabinF.type = 'lowpass'; this.cabinF.frequency.value = 1400; this.cabinF.Q.value = 0.9;
        this.cabinF.connect(this.master);
        this.near = ctx.createGain();
        this.near.connect(this.master);
        if (this.cabinOn) this.cabin(true);
        const len = Math.floor(ctx.sampleRate * 2);
        this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        this.applyVolume();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    applyVolume() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 0.9; }
    setVolume(v) { this.volume = HB.clamp(v, 0, 1); if (this.volume > 0) this.muted = false; this.applyVolume(); this.save(); }
    toggleMute() { this.muted = !this.muted; this.applyVolume(); this.save(); }
    get audible() { return !this.muted && this.volume > 0; }
    save() { try { localStorage.setItem(STORE, JSON.stringify({ volume: this.volume, muted: this.muted })); } catch (e) { /* ignore */ } }

    /* Limiteur : écart minimal par type de son + nombre de voix simultanées */
    ok(type, gap, dur) {
      const c = this.ctx;
      if (!c || c.state !== 'running' || !this.audible) return false;
      const now = c.currentTime;
      if (gap && now - (this.last[type] ?? -9) < gap) return false;
      if (this.voices >= this.maxVoices) return false;
      this.last[type] = now;
      this.voices++;
      setTimeout(() => { this.voices--; }, (dur || 0.3) * 1000 + 30);
      return true;
    }

    /* Sortie stéréo : le son vient du côté de l'écran où il se produit.
     * En vue intérieure : du côté du tank où il se produit, moins fort de loin,
     * et nos propres tirs (tout près de l'oreille) ne sont pas étouffés. */
    out(x, y) {
      const c = this.ctx;
      const L = this.listener;
      if (L && x != null && y != null) {
        const dx = x - L.x, dy = y - L.y, d = Math.hypot(dx, dy);
        const g = c.createGain();
        if (d < 46) { g.gain.value = 1.3; g.connect(this.near); return g; }
        g.gain.value = HB.clamp(1.2 - d / 750, 0.28, 1);
        if (c.createStereoPanner) {
          const p = c.createStereoPanner();
          p.pan.value = HB.clamp((-dx * Math.sin(L.a) + dy * Math.cos(L.a)) / Math.max(d, 80), -1, 1) * 0.8;
          g.connect(p); p.connect(this.world);
        } else g.connect(this.world);
        return g;
      }
      if (x == null || !c.createStereoPanner) return this.master;
      const p = c.createStereoPanner();
      p.pan.value = HB.clamp((x / HB.W) * 2 - 1, -1, 1) * 0.7;
      p.connect(this.world);
      return p;
    }

    /* Habitacle : les bruits du dehors passent à travers le blindage */
    cabin(on) {
      this.cabinOn = on;
      if (!on) { this.listener = null; this.engine(-1); }
      if (!this.world) return;
      this.world.disconnect();
      this.world.connect(on ? this.cabinF : this.master);
      this.world.gain.value = on ? 0.9 : 1;
    }

    /* Moteur (vue intérieure) : level 0..1 selon la vitesse, -1 pour couper */
    engine(level, boost) {
      const c = this.ctx;
      if (!c) return;
      if (level < 0 || c.state !== 'running') {
        const e = this.eng;
        if (!e) return;
        this.eng = null;
        e.g.gain.setTargetAtTime(0, c.currentTime, 0.06);
        setTimeout(() => { try { e.o1.stop(); e.o2.stop(); e.n.stop(); } catch (err) { /* ignore */ } }, 500);
        return;
      }
      if (!this.eng) {
        const o1 = c.createOscillator(), o2 = c.createOscillator();
        o1.type = 'sawtooth'; o2.type = 'square';
        const f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 240; f.Q.value = 2;
        const n = c.createBufferSource();
        n.buffer = this.noise; n.loop = true;
        const nf = c.createBiquadFilter();
        nf.type = 'bandpass'; nf.frequency.value = 160; nf.Q.value = 0.7;
        const ng = c.createGain(); ng.gain.value = 0.6;
        const g = c.createGain(); g.gain.value = 0;
        o1.connect(f); o2.connect(f); n.connect(nf); nf.connect(ng); ng.connect(f);
        f.connect(g); g.connect(this.near);
        o1.start(); o2.start(); n.start();
        this.eng = { o1, o2, n, f, g };
      }
      const e = this.eng, t = c.currentTime, k = HB.clamp(level, 0, 1.3);
      const fr = 30 + k * 32 + (boost ? 18 : 0);
      e.o1.frequency.setTargetAtTime(fr, t, 0.15);
      e.o2.frequency.setTargetAtTime(fr * 0.505, t, 0.15);
      e.f.frequency.setTargetAtTime(200 + k * 260 + (boost ? 320 : 0), t, 0.2);
      e.g.gain.setTargetAtTime(0.05 + k * 0.07 + (boost ? 0.05 : 0), t, 0.2);
    }

    env(param, t, peak, attack, decay) {
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
      param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    /* Bruit filtré avec enveloppe */
    burst(dest, t, { type = 'lowpass', freq = 1000, freqEnd = null, q = 0.8, peak = 0.4, attack = 0.002, decay = 0.1 }) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(freq, t);
      if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
      const g = c.createGain();
      this.env(g.gain, t, peak, attack, decay);
      src.connect(f); f.connect(g); g.connect(dest);
      const dur = attack + decay + 0.05;
      src.start(t, Math.random() * Math.max(0, this.noise.duration - dur - 0.05), dur);
    }

    /* Oscillateur avec glissando et enveloppe */
    tone(dest, t, { wave = 'sine', freq = 440, freqEnd = null, peak = 0.2, attack = 0.005, decay = 0.2, filter = null }) {
      const c = this.ctx;
      const o = c.createOscillator();
      o.type = wave;
      o.frequency.setValueAtTime(freq, t);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
      const g = c.createGain();
      this.env(g.gain, t, peak, attack, decay);
      let node = o;
      if (filter) {
        const f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = filter;
        o.connect(f); node = f;
      }
      node.connect(g); g.connect(dest);
      o.start(t);
      o.stop(t + attack + decay + 0.05);
    }

    /* ---------------- Sons du jeu ---------------- */

    /* Tir : plus la puissance est élevée, plus c'est grave et long */
    shot(puissance, x, y) {
      const k = (puissance - 1) / 9;
      const dur = 0.12 + k * 0.35;
      if (!this.ok('shot', 0.03, dur)) return;
      const t = this.ctx.currentTime, out = this.out(x, y);
      this.burst(out, t, { freq: 5200 - k * 4200, freqEnd: 300, peak: 0.35 + k * 0.2, decay: 0.07 + k * 0.22 });
      this.tone(out, t, { freq: 190 - k * 130, freqEnd: 38, peak: 0.3 + k * 0.5, decay: 0.09 + k * 0.3 });
      if (k < 0.35) this.tone(out, t, { wave: 'square', freq: 900, freqEnd: 300, peak: 0.05, decay: 0.04, filter: 2500 });
    }

    /* Impact d'obus : sourd sur un mur, métallique sur un tank */
    impact(power, onTank, x, y) {
      const dur = 0.1 + power * 0.2;
      if (!this.ok(onTank ? 'hit' : 'thud', 0.03, dur)) return;
      const t = this.ctx.currentTime, out = this.out(x, y);
      if (onTank) {
        this.burst(out, t, { type: 'bandpass', freq: 1800, q: 1.2, peak: 0.3 + power * 0.25, decay: 0.08 + power * 0.12 });
        const f = 700 + Math.random() * 500;
        this.tone(out, t, { wave: 'triangle', freq: f, freqEnd: f * 0.92, peak: 0.1, decay: 0.18 });
        this.tone(out, t, { wave: 'triangle', freq: f * 1.53, peak: 0.06, decay: 0.12 });
        this.tone(out, t, { freq: 120, freqEnd: 50, peak: 0.25 + power * 0.3, decay: 0.12 + power * 0.1 });
      } else {
        this.burst(out, t, { freq: 1400, freqEnd: 200, peak: 0.18 + power * 0.2, decay: 0.07 + power * 0.12 });
      }
    }

    /* Destruction d'un tank */
    explosion(x, y) {
      if (!this.ok('boom', 0.05, 1.6)) return;
      const t = this.ctx.currentTime, out = this.out(x, y);
      this.burst(out, t, { freq: 3000, freqEnd: 120, peak: 0.9, attack: 0.005, decay: 1.4 });
      this.tone(out, t, { freq: 95, freqEnd: 28, peak: 0.9, attack: 0.005, decay: 0.8 });
      // débris qui retombent
      for (let i = 0; i < 4; i++) {
        this.burst(out, t + 0.15 + i * 0.09 + Math.random() * 0.05, { type: 'bandpass', freq: 600 + Math.random() * 1600, q: 2, peak: 0.12, decay: 0.05 });
      }
    }

    /* Caisse en bois qui éclate */
    crate(x, y) {
      if (!this.ok('crate', 0.05, 0.3)) return;
      const t = this.ctx.currentTime, out = this.out(x, y);
      [0, 0.035, 0.09].forEach((d, i) => {
        this.burst(out, t + d, { type: 'bandpass', freq: 650 + i * 250 + Math.random() * 200, q: 3, peak: 0.35, decay: 0.06 });
      });
      this.tone(out, t, { wave: 'triangle', freq: 180, freqEnd: 90, peak: 0.15, decay: 0.12 });
    }

    /* Éperonnage : choc métallique */
    ram(intensity, x, y) {
      if (!this.ok('ram', 0.08, 0.5)) return;
      const t = this.ctx.currentTime, out = this.out(x, y);
      const p = HB.clamp(intensity, 0.2, 1);
      this.burst(out, t, { freq: 1100, freqEnd: 150, peak: 0.45 * p + 0.15, decay: 0.15 });
      [173, 279, 418, 611].forEach((f, i) => {
        this.tone(out, t, { wave: i % 2 ? 'triangle' : 'sine', freq: f, freqEnd: f * 0.97, peak: 0.13 * p + 0.04, decay: 0.45 - i * 0.07 });
      });
    }

    /* Kit de réparation ramassé */
    pickup(x, y) {
      if (!this.ok('pickup', 0.1, 0.4)) return;
      const t = this.ctx.currentTime, out = this.out(x, y);
      [660, 880, 1320].forEach((f, i) => this.tone(out, t + i * 0.07, { wave: 'triangle', freq: f, peak: 0.16, decay: 0.14 }));
    }

    /* Sirène quand la zone mortelle se referme */
    alarm() {
      if (!this.ok('alarm', 1, 1.8)) return;
      const t = this.ctx.currentTime, out = this.out(null);
      for (let i = 0; i < 6; i++) {
        this.tone(out, t + i * 0.26, { wave: 'square', freq: i % 2 ? 392 : 523, peak: 0.07, attack: 0.02, decay: 0.22, filter: 1600 });
      }
    }

    /* Fanfare de victoire */
    victory() {
      if (!this.ok('victory', 1, 1.8)) return;
      const t = this.ctx.currentTime, out = this.out(null);
      const notes = [[523, 0, 0.14], [659, 0.15, 0.14], [784, 0.3, 0.14], [1047, 0.45, 0.7], [784, 0.62, 0.12], [1047, 0.75, 0.9]];
      for (const [f, d, len] of notes) {
        this.tone(out, t + d, { wave: 'square', freq: f, peak: 0.07, attack: 0.01, decay: len, filter: 2400 });
        this.tone(out, t + d, { wave: 'triangle', freq: f / 2, peak: 0.1, attack: 0.01, decay: len });
      }
    }

    /* Démarrage des moteurs au lancement de la bataille */
    start() {
      if (!this.ok('start', 0.5, 1.2)) return;
      const t = this.ctx.currentTime, out = this.out(null);
      this.tone(out, t, { wave: 'sawtooth', freq: 42, freqEnd: 110, peak: 0.22, attack: 0.15, decay: 0.8, filter: 380 });
      this.tone(out, t + 0.05, { wave: 'sawtooth', freq: 55, freqEnd: 140, peak: 0.15, attack: 0.15, decay: 0.7, filter: 420 });
      this.burst(out, t, { freq: 500, freqEnd: 200, peak: 0.12, attack: 0.1, decay: 0.8 });
    }

    /* Modules activés */
    ability(id, x, y) {
      if (!this.ok('ab-' + id, 0.15, 0.9)) return;
      const t = this.ctx.currentTime, out = this.out(x, y);
      switch (id) {
        case 'nitro':
          this.burst(out, t, { type: 'bandpass', freq: 400, freqEnd: 2600, q: 1.5, peak: 0.35, attack: 0.05, decay: 0.45 });
          this.tone(out, t, { wave: 'sawtooth', freq: 70, freqEnd: 180, peak: 0.12, attack: 0.03, decay: 0.4, filter: 600 });
          break;
        case 'bouclier':
          [440, 660, 880].forEach((f, i) => this.tone(out, t + i * 0.04, { wave: 'triangle', freq: f, freqEnd: f * 1.5, peak: 0.08, decay: 0.35 }));
          break;
        case 'mines':
          this.tone(out, t, { wave: 'square', freq: 1300, peak: 0.05, decay: 0.04, filter: 3000 });
          this.tone(out, t + 0.09, { wave: 'square', freq: 1300, peak: 0.05, decay: 0.04, filter: 3000 });
          this.burst(out, t, { type: 'bandpass', freq: 900, q: 4, peak: 0.12, decay: 0.05 });
          break;
        case 'fumee':
          this.burst(out, t, { type: 'highpass', freq: 1800, peak: 0.22, attack: 0.04, decay: 0.9 });
          this.burst(out, t, { freq: 500, freqEnd: 200, peak: 0.2, decay: 0.3 });
          break;
        case 'reparation':
          [392, 523, 659, 784].forEach((f, i) => this.tone(out, t + i * 0.06, { wave: 'triangle', freq: f, peak: 0.12, decay: 0.16 }));
          break;
        case 'explosif':
          this.burst(out, t, { type: 'bandpass', freq: 2500, q: 5, peak: 0.15, decay: 0.03 });
          this.tone(out, t + 0.05, { wave: 'square', freq: 220, freqEnd: 330, peak: 0.06, decay: 0.12, filter: 1200 });
          break;
      }
    }

    /* Nouveau module ou défi débloqué */
    unlockJingle() {
      if (!this.ok('unlockJ', 1, 1.2)) return;
      const t = this.ctx.currentTime, out = this.out(null);
      [523, 784, 1047, 1568].forEach((f, i) => this.tone(out, t + i * 0.09, { wave: 'triangle', freq: f, peak: 0.12, decay: 0.3 }));
    }

    /* Petit clic d'interface */
    click() {
      if (!this.ok('click', 0.03, 0.05)) return;
      const t = this.ctx.currentTime;
      this.tone(this.master, t, { wave: 'triangle', freq: 1200, freqEnd: 900, peak: 0.05, decay: 0.03 });
    }
  }

  HB.sfx = new Sfx();
  const unlock = () => HB.sfx.unlock();
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
})();
