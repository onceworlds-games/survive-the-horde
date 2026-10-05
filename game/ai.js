// A hero that plays itself: kites the horde, collects gems, picks upgrades. It plays the title screen behind the logo,
// and plays whole nights in the tests. Pure.
import { ARENA_R, N_WEAPONS } from './data.js';
import { pickOffer } from './hero.js';

const DIRS = 16;
const dirX = new Float32Array(DIRS);
const dirY = new Float32Array(DIRS);
for (let i = 0; i < DIRS; i++) {
  dirX[i] = Math.cos((i / DIRS) * Math.PI * 2);
  dirY[i] = Math.sin((i / DIRS) * Math.PI * 2);
}

// What the AI likes to take, best first (upgrade ids: weapons 0..6, passives 10..15, 20 recover).
const LIKE = new Float32Array(32);
[
  [2, 9], // Fire Ring
  [1, 8.5], // Spinning Blades
  [3, 8], // Lightning
  [14, 7.5], // Damage
  [0, 7], // Magic Bolt
  [5, 6.5], // Frost Nova
  [10, 6], // Max HP
  [6, 6], // Holy Shield
  [4, 5.5], // Arrow Rain
  [15, 5], // Regen
  [11, 4.5], // Speed
  [13, 4], // Cooldown
  [12, 3], // Pickup
  [20, 1],
].forEach(([id, v]) => (LIKE[id] = v));

export class Autopilot {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.mx = 0;
    this.my = 0;
    this.timer = 0;
    this.buf = new Int32Array(512);
    this.wander = rng() * Math.PI * 2;
  }

  /** Sets (this.mx, this.my), the wish for the next moments. Call every step; it re-thinks ten times a second. */
  think(dt, h, mon, hash, gems) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;
    if (h.down) {
      this.mx = 0;
      this.my = 0;
      return;
    }
    const cnt = hash.collect(h.x, h.y, 8, this.buf);
    let bestScore = -1e9;
    let best = 0;
    for (let d = 0; d < DIRS; d++) {
      const px = h.x + dirX[d] * 2.4;
      const py = h.y + dirY[d] * 2.4;
      let danger = 0;
      for (let k = 0; k < cnt; k++) {
        const s = this.buf[k];
        if (mon.dead[s] === 1) continue;
        const dx = mon.x[s] - px;
        const dy = mon.y[s] - py;
        const d2 = dx * dx + dy * dy;
        danger += 1 / (0.6 + d2);
      }
      if (mon.boss >= 0) {
        const dx = mon.x[mon.boss] - px;
        const dy = mon.y[mon.boss] - py;
        danger += 14 / (4 + dx * dx + dy * dy);
      }
      let score = -danger * 9;
      // stay off the rim of the arena
      const rr = Math.sqrt(px * px + py * py);
      if (rr > ARENA_R - 8) score -= (rr - (ARENA_R - 8)) * 3;
      // keep going the way we were going
      score += (dirX[d] * this.mx + dirY[d] * this.my) * 0.5;
      // drift toward the nearest gem when it's not dangerous
      let gd = 1e9;
      let gx = 0;
      let gy = 0;
      for (let g = 0; g < gems.n; g++) {
        const dx = gems.x[g] - h.x;
        const dy = gems.y[g] - h.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < gd) {
          gd = d2;
          gx = dx;
          gy = dy;
        }
      }
      if (gd < 14 * 14) {
        const inv = 1 / (Math.sqrt(gd) || 1);
        score += (dirX[d] * gx * inv + dirY[d] * gy * inv) * 1.6;
      }
      if (cnt === 0 && gd >= 14 * 14) {
        // nothing around: walk in a slow circle near the middle
        score += (dirX[d] * Math.cos(this.wander) + dirY[d] * Math.sin(this.wander)) * 0.5 - rr * 0.002;
      }
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    this.wander += 0.2;
    this.mx = dirX[best];
    this.my = dirY[best];
  }

  /** Takes the best card on offer. */
  choose(h) {
    if (h.nOffer === 0) return false;
    let bi = 0;
    let bv = -1;
    for (let i = 0; i < h.nOffer; i++) {
      const id = h.offer[i];
      let v = LIKE[id] + this.rng() * 1.5;
      // a weapon already owned is worth more levelled up
      if (id < N_WEAPONS && h.wl[id] > 0) v += 1.5;
      if (v > bv) {
        bv = v;
        bi = i;
      }
    }
    return pickOffer(h, bi);
  }
}
