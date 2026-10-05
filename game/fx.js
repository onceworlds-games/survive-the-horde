// Particles, floating damage numbers and camera shake. Pooled typed arrays: nothing is allocated while the game runs.
import { T_SKEL, T_BAT, T_SLIME, T_GHOUL, T_KNIGHT, T_BOSS, T_DUMMY } from './data.js';

// Colours particles can have (index into PAL).
export const PAL = [
  '#ffffff', // 0 white
  '#e8e4d4', // 1 bone
  '#9fe8ff', // 2 ice
  '#b04ae8', // 3 violet
  '#ff4fd8', // 4 magenta
  '#62d93c', // 5 slime green
  '#c8ff8a', // 6 pale green
  '#8f9c68', // 7 ghoul
  '#ff9a3a', // 8 orange
  '#a9b4c6', // 9 steel
  '#ffd24a', // 10 gold
  '#ff2a3a', // 11 red
  '#3b1d46', // 12 night purple
  '#5dff9a', // 13 gem green
  '#4aa8ff', // 14 gem blue
  '#c06bff', // 15 gem purple
  '#ff6a1a', // 16 fire
  '#fff2a8', // 17 spark yellow
  '#6fd8ff', // 18 frost
  '#ffe9b0', // 19 dawn light
  '#4a3a2a', // 20 dust
  '#2a2f38', // 21 ash
];
export const N_PAL = PAL.length;

export const K_DOT = 0; // a square dot that shrinks
export const K_SPARK = 1; // a streak along its velocity
export const K_RING = 2; // an expanding ring
export const K_PUFF = 3; // a soft round puff that grows and fades
export const K_GLOW = 4; // an additive glow that fades

const DEATH_COLORS = {
  [T_SKEL]: [1, 2],
  [T_BAT]: [3, 4],
  [T_SLIME]: [5, 6],
  [T_GHOUL]: [7, 8],
  [T_KNIGHT]: [9, 10],
  [T_BOSS]: [12, 11],
  [T_DUMMY]: [20, 1],
};

export class Particles {
  constructor(cap = 900) {
    this.cap = cap;
    this.limit = cap; // quality lowers this
    this.n = 0;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.col = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.order = new Int16Array(cap);
    this.counts = new Int16Array(N_PAL + 1);
  }

  spawn(kind, x, y, vx, vy, life, size, col, drag = 3) {
    if (this.n >= this.limit) return;
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.col[i] = col;
    this.kind[i] = kind;
    this.drag[i] = drag;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const l = --this.n;
        if (i !== l) {
          this.x[i] = this.x[l];
          this.y[i] = this.y[l];
          this.vx[i] = this.vx[l];
          this.vy[i] = this.vy[l];
          this.life[i] = this.life[l];
          this.max[i] = this.max[l];
          this.size[i] = this.size[l];
          this.drag[i] = this.drag[l];
          this.col[i] = this.col[l];
          this.kind[i] = this.kind[l];
        }
        continue;
      }
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= k;
      this.vy[i] *= k;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
  }

  clear() {
    this.n = 0;
  }

  /** Fills this.order with the particle indices grouped by colour (a counting sort), so a draw pass changes style rarely. */
  sortByColour() {
    const counts = this.counts;
    counts.fill(0);
    for (let i = 0; i < this.n; i++) counts[this.col[i] + 1]++;
    for (let c = 1; c <= N_PAL; c++) counts[c] += counts[c - 1];
    for (let i = 0; i < this.n; i++) this.order[counts[this.col[i]]++] = i;
  }
}

const NUM_CAP = 72;
const textCache = [];
export function numText(v) {
  const n = Math.round(v);
  if (n >= 0 && n < 2000) return textCache[n] ?? (textCache[n] = String(n));
  return String(n);
}

export const N_HIT = 0;
export const N_CRIT = 1;
export const N_HURT = 2;
export const N_HEAL = 3;

export class Numbers {
  constructor() {
    this.n = 0;
    this.x = new Float32Array(NUM_CAP);
    this.y = new Float32Array(NUM_CAP);
    this.vy = new Float32Array(NUM_CAP);
    this.life = new Float32Array(NUM_CAP);
    this.max = new Float32Array(NUM_CAP);
    this.val = new Float32Array(NUM_CAP);
    this.kind = new Uint8Array(NUM_CAP);
    this.limit = NUM_CAP;
  }
  add(x, y, val, kind) {
    if (this.n >= this.limit) {
      // too many on screen: the oldest one makes way
      this.remove(0);
    }
    const i = this.n++;
    this.x[i] = x + (Math.random() - 0.5) * 0.5;
    this.y[i] = y - 0.5;
    this.vy[i] = kind === N_CRIT ? -3.2 : -2.4;
    this.life[i] = kind === N_CRIT ? 0.8 : kind === N_HURT ? 0.9 : 0.55;
    this.max[i] = this.life[i];
    this.val[i] = val;
    this.kind[i] = kind;
  }
  remove(i) {
    const l = --this.n;
    if (i === l) return;
    this.x[i] = this.x[l];
    this.y[i] = this.y[l];
    this.vy[i] = this.vy[l];
    this.life[i] = this.life[l];
    this.max[i] = this.max[l];
    this.val[i] = this.val[l];
    this.kind[i] = this.kind[l];
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.remove(i);
        continue;
      }
      this.vy[i] *= Math.exp(-4 * dt);
      this.y[i] += this.vy[i] * dt;
      i++;
    }
  }
  clear() {
    this.n = 0;
  }
}

/** Camera shake from a decaying trauma value: shake = trauma squared, smooth sine offsets. */
export class Shake {
  constructor() {
    this.trauma = 0;
    this.t = 0;
    this.x = 0;
    this.y = 0;
    this.reduced = false;
  }
  add(v) {
    if (this.reduced) return;
    this.trauma = Math.min(1, this.trauma + v);
  }
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const s = this.reduced ? 0 : this.trauma * this.trauma;
    this.x = s * 0.55 * (Math.sin(this.t * 41.3) + 0.6 * Math.sin(this.t * 23.7 + 1.9));
    this.y = s * 0.55 * (Math.sin(this.t * 37.9 + 0.7) + 0.6 * Math.sin(this.t * 19.1 + 4.2));
  }
}

/** The effects the game asks for by name; each scales with the graphics quality. */
export class Effects {
  constructor() {
    this.particles = new Particles(900);
    this.numbers = new Numbers();
    this.shake = new Shake();
    this.q = 1; // 0.35 low, 0.7 medium, 1 high
    this.reduced = false;
    this.flash = 0; // a white screen flash (0..1)
    this.flashCol = 0;
    this.hitStop = 0; // seconds the sim waits (solo only)
    this.redPulse = 0; // the screen edge when hurt
    // gems flying to the hero that took them (visual only)
    this.fn = 0;
    this.fx0 = new Float32Array(48);
    this.fy0 = new Float32Array(48);
    this.ft = new Uint8Array(48);
    this.fh = new Uint8Array(48);
    this.fage = new Float32Array(48);
  }

  flyGem(x, y, tier, hero) {
    if (this.fn >= 48) return;
    const i = this.fn++;
    this.fx0[i] = x;
    this.fy0[i] = y;
    this.ft[i] = tier;
    this.fh[i] = hero;
    this.fage[i] = 0;
  }

  setQuality(quality, reduced) {
    this.reduced = reduced;
    this.shake.reduced = reduced;
    this.q = quality === 'low' ? 0.35 : quality === 'medium' ? 0.7 : 1;
    this.particles.limit = Math.max(120, Math.floor(this.particles.cap * this.q));
    this.numbers.limit = quality === 'low' ? 28 : quality === 'medium' ? 48 : NUM_CAP;
  }

  update(dt) {
    this.particles.update(dt);
    this.numbers.update(dt);
    this.shake.update(dt);
    let f = 0;
    while (f < this.fn) {
      this.fage[f] += dt;
      if (this.fage[f] >= 0.22) {
        const l = --this.fn;
        if (f !== l) {
          this.fx0[f] = this.fx0[l];
          this.fy0[f] = this.fy0[l];
          this.ft[f] = this.ft[l];
          this.fh[f] = this.fh[l];
          this.fage[f] = this.fage[l];
        }
      } else f++;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5);
    if (this.redPulse > 0) this.redPulse = Math.max(0, this.redPulse - dt * 1.8);
    if (this.hitStop > 0) this.hitStop = Math.max(0, this.hitStop - dt);
  }

  clear() {
    this.particles.clear();
    this.numbers.clear();
    this.fn = 0;
    this.flash = 0;
    this.redPulse = 0;
  }

  count(base) {
    return Math.max(1, Math.round(base * this.q * (this.reduced ? 0.5 : 1)));
  }

  /** A monster dies: a burst in its colours and a puff. */
  death(x, y, type, elite) {
    const P = this.particles;
    const cols = DEATH_COLORS[type] ?? DEATH_COLORS[T_SKEL];
    const big = type === T_BOSS ? 6 : type === T_KNIGHT ? 1.6 : 1;
    const n = this.count(type === T_BOSS ? 90 : type === T_KNIGHT ? 14 : 9);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      const s = (1.2 + Math.random() * 3.2) * (big > 2 ? 2.2 : 1);
      P.spawn(K_DOT, x, y, Math.cos(a) * s, Math.sin(a) * s - 0.6, 0.35 + Math.random() * 0.35, (0.1 + Math.random() * 0.12) * big, cols[i & 1], 3.2);
    }
    P.spawn(K_PUFF, x, y, 0, -0.3, 0.45, 0.5 * big, cols[0], 4);
    if (elite) P.spawn(K_RING, x, y, 0, 0, 0.4, 1.4, 10, 0);
  }

  /** Dawn: a monster crumbles to ash and light. */
  crumble(x, y, type) {
    const P = this.particles;
    const n = this.count(5);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      P.spawn(K_DOT, x, y, Math.cos(a) * 0.7, Math.sin(a) * 0.7 - 1.3, 0.8 + Math.random() * 0.6, 0.09 + Math.random() * 0.1, i % 3 === 0 ? 19 : 21, 1.6);
    }
    P.spawn(K_PUFF, x, y, 0, -0.5, 0.7, type === T_BOSS ? 2.5 : 0.6, 21, 2);
  }

  /** A weapon hit lands: a spark and a number. */
  hit(x, y, amt, crit, big) {
    const P = this.particles;
    const n = this.count(crit ? 5 : 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      const s = 2 + Math.random() * 3;
      P.spawn(K_SPARK, x, y - 0.3, Math.cos(a) * s, Math.sin(a) * s, 0.16 + Math.random() * 0.1, 0.12, crit ? 10 : 17, 5);
    }
    if (big) this.shake.add(crit ? 0.05 : 0.025);
    this.numbers.add(x, y, amt, crit ? N_CRIT : N_HIT);
  }

  hurt(x, y, amt) {
    const P = this.particles;
    const n = this.count(12);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      P.spawn(K_DOT, x, y - 0.4, Math.cos(a) * 3, Math.sin(a) * 3 - 1, 0.4, 0.14, 11, 3);
    }
    this.numbers.add(x, y - 0.4, amt, N_HURT);
    this.shake.add(0.38);
    if (!this.reduced) this.redPulse = 1;
  }

  pickup(x, y, tier) {
    const P = this.particles;
    const c = 13 + tier;
    P.spawn(K_RING, x, y, 0, 0, 0.25, 0.5 + tier * 0.15, c, 0);
    if (this.q > 0.5) P.spawn(K_GLOW, x, y, 0, 0, 0.2, 0.5, c, 0);
  }

  levelUp(x, y) {
    const P = this.particles;
    P.spawn(K_RING, x, y, 0, 0, 0.7, 3.2, 17, 0);
    P.spawn(K_RING, x, y, 0, 0, 0.5, 2.0, 0, 0);
    const n = this.count(26);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283;
      P.spawn(K_SPARK, x, y, Math.cos(a) * 6, Math.sin(a) * 6, 0.45, 0.16, i & 1 ? 17 : 10, 3.5);
    }
    this.flashAt(0.12, 17);
    this.shake.add(0.15);
  }

  /** The Night Warden falls. */
  bossDeath(x, y) {
    this.death(x, y, T_BOSS, false);
    const P = this.particles;
    P.spawn(K_RING, x, y, 0, 0, 1.0, 9, 11, 0);
    P.spawn(K_RING, x, y, 0, 0, 0.7, 5, 17, 0);
    const n = this.count(60);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      const s = 4 + Math.random() * 8;
      P.spawn(K_SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, 0.7, 0.2, i % 3 === 0 ? 11 : 17, 2.5);
    }
    this.shake.add(0.9);
    this.flashAt(0.55, 0);
    this.hitStop = 0.12;
  }

  flashAt(v, col) {
    if (this.reduced) return;
    this.flash = Math.max(this.flash, v);
    this.flashCol = col;
  }

  /** A spark trail for a bolt. */
  trail(x, y) {
    if (this.q < 0.5) return;
    this.particles.spawn(K_GLOW, x, y, 0, 0, 0.18, 0.3, 17, 0);
  }

  dust(x, y) {
    if (this.q < 0.5) return;
    this.particles.spawn(K_PUFF, x, y + 0.3, (Math.random() - 0.5) * 0.4, -0.2, 0.35, 0.22, 20, 3);
  }

  ringBurst(x, y, r, col) {
    this.particles.spawn(K_RING, x, y, 0, 0, 0.4, r, col, 0);
    const n = this.count(14);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      this.particles.spawn(K_DOT, x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, Math.cos(a) * 2, Math.sin(a) * 2 - 0.5, 0.45, 0.12, col, 3);
    }
  }
}
