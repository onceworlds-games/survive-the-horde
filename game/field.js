// Monsters and gems as flat typed arrays (no objects per monster), and the spatial hash over them.
// The world (host) and the interpolated view (everyone else) both use these, so weapons, the hero and
// the renderer don't care which one they read.
import { ARENA_R, SPAWN_R, MAX_MON, MAX_GEMS, MON_R, SMALL_R, T_BOSS } from './data.js';

export class Monsters {
  constructor(cap = MAX_MON + 8) {
    this.cap = cap;
    this.n = 0;
    this.boss = -1; // slot of the Night Warden, or -1
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.type = new Uint8Array(cap);
    this.elite = new Uint8Array(cap);
    this.hpf = new Float32Array(cap); // 0..1
    this.id = new Int32Array(cap);
    this.dead = new Uint8Array(cap);
    // the host's own bookkeeping
    this.hp = new Float32Array(cap);
    this.maxHp = new Float32Array(cap);
    this.vx = new Float32Array(cap); // knockback velocity
    this.vy = new Float32Array(cap);
    this.slow = new Float32Array(cap); // seconds of slowness left
    this.aux = new Float32Array(cap); // bats: wing phase, the boss: its dash timer
    this.spd = new Float32Array(cap); // this monster's speed
    this.dmg = new Float32Array(cap); // this monster's touch damage
  }

  /** Swap-remove slot i (keeps the arrays dense). `idSlot` (optional) is the id -> slot table to keep right. */
  removeAt(i, idSlot, mask) {
    const last = this.n - 1;
    if (i < 0 || i > last) return;
    if (idSlot) idSlot[this.id[i] & mask] = -1;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.type[i] = this.type[last];
      this.elite[i] = this.elite[last];
      this.hpf[i] = this.hpf[last];
      this.id[i] = this.id[last];
      this.dead[i] = this.dead[last];
      this.hp[i] = this.hp[last];
      this.maxHp[i] = this.maxHp[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.slow[i] = this.slow[last];
      this.aux[i] = this.aux[last];
      this.spd[i] = this.spd[last];
      this.dmg[i] = this.dmg[last];
      if (idSlot) idSlot[this.id[i] & mask] = i;
    }
    if (this.boss === i) this.boss = -1;
    else if (this.boss === last) this.boss = i;
    this.dead[last] = 0;
    this.n = last;
  }

  clear(idSlot) {
    if (idSlot) for (let i = 0; i < this.n; i++) idSlot[this.id[i] & 0x7fff] = -1;
    this.n = 0;
    this.boss = -1;
  }
}

export class Gems {
  constructor(cap = MAX_GEMS + 8) {
    this.cap = cap;
    this.n = 0;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.tier = new Uint8Array(cap);
    this.id = new Int32Array(cap);
    this.born = new Float32Array(cap); // night time it appeared (the pop-in)
  }

  removeAt(i, idSlot, mask) {
    const last = this.n - 1;
    if (i < 0 || i > last) return;
    if (idSlot) idSlot[this.id[i] & mask] = -1;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.tier[i] = this.tier[last];
      this.id[i] = this.id[last];
      this.born[i] = this.born[last];
      if (idSlot) idSlot[this.id[i] & mask] = i;
    }
    this.n = last;
  }
}

/** A uniform grid over the arena. Holds every monster except the boss (which is far wider than the rest: test it by hand). */
export class SpatialHash {
  constructor(extent = ARENA_R + SPAWN_R + 8, cell = 2.5) {
    this.cell = cell;
    this.inv = 1 / cell;
    this.off = extent;
    this.w = Math.ceil((2 * extent) / cell) + 1;
    this.start = new Int32Array(this.w * this.w + 1);
    this.items = new Int32Array(MAX_MON + 16);
    this.cellOf = new Int32Array(MAX_MON + 16);
  }

  /** Rebuild from a Monsters-like field (n, x, y, type, dead). Slots are valid until the field is compacted. */
  rebuild(m) {
    const { w, inv, off, start, items, cellOf } = this;
    const cells = w * w;
    start.fill(0);
    const n = Math.min(m.n, items.length);
    const mx = m.x;
    const my = m.y;
    const mt = m.type;
    const dead = m.dead;
    for (let i = 0; i < n; i++) {
      if (dead[i] === 1 || mt[i] === T_BOSS) {
        cellOf[i] = -1;
        continue;
      }
      let cx = ((mx[i] + off) * inv) | 0;
      let cy = ((my[i] + off) * inv) | 0;
      if (cx < 0) cx = 0;
      else if (cx >= w) cx = w - 1;
      if (cy < 0) cy = 0;
      else if (cy >= w) cy = w - 1;
      const c = cy * w + cx;
      cellOf[i] = c;
      start[c]++;
    }
    let run = 0;
    for (let c = 0; c < cells; c++) {
      run += start[c];
      start[c] = run;
    }
    start[cells] = run;
    for (let i = n - 1; i >= 0; i--) {
      const c = cellOf[i];
      if (c < 0) continue;
      items[--start[c]] = i;
    }
  }

  /** Writes the slots of every monster in the cells near (x, y) within r (a superset: test distances yourself). Returns the count. */
  collect(x, y, r, out) {
    const { w, inv, off, start, items } = this;
    let x0 = ((x - r + off) * inv) | 0;
    let x1 = ((x + r + off) * inv) | 0;
    let y0 = ((y - r + off) * inv) | 0;
    let y1 = ((y + r + off) * inv) | 0;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= w) x1 = w - 1;
    if (y1 >= w) y1 = w - 1;
    let n = 0;
    const cap = out.length;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * w;
      // cells of one row are contiguous in `start`, so a row is one run of items
      const a = start[row + x0];
      const b = start[row + x1 + 1];
      for (let k = a; k < b && n < cap; k++) out[n++] = items[k];
    }
    return n;
  }
}

/**
 * Monsters whose circle overlaps the circle (x, y, rad), the boss included, skipping the dead.
 * `buf` and `out` are reusable Int32Arrays at least MAX_MON + 16 long. Returns the count in `out`.
 */
export function gather(m, hash, x, y, rad, out, buf) {
  const k = hash.collect(x, y, rad + SMALL_R, buf);
  const mx = m.x;
  const my = m.y;
  const mt = m.type;
  const dead = m.dead;
  let c = 0;
  for (let j = 0; j < k; j++) {
    const s = buf[j];
    if (dead[s] === 1) continue;
    const dx = mx[s] - x;
    const dy = my[s] - y;
    const rr = rad + MON_R[mt[s]];
    if (dx * dx + dy * dy < rr * rr) out[c++] = s;
  }
  const b = m.boss;
  if (b >= 0 && dead[b] !== 1) {
    const dx = mx[b] - x;
    const dy = my[b] - y;
    const rr = rad + MON_R[mt[b]];
    if (dx * dx + dy * dy < rr * rr) out[c++] = b;
  }
  return c;
}
