// What goes over the wire between pages, and how it is checked. Pure: no room, no DOM. Everything that comes from
// another page is untrusted: shapes, ranges and counts are verified before they touch the world.
import { ID_MASK, MAX_HEROES, N_WEAPONS, MAX_LEVEL } from './data.js';

export const MSG_DMG = 'd'; // { t:'d', rid, h:[id, amount, fx, ...], f:[kind, x, y, a, b, ...] }
export const MSG_GEMS = 'g'; // { t:'g', rid, ids:[...] }

export const MAX_HITS_PER_MSG = 160;
export const MAX_FX_PER_MSG = 24;
export const MAX_AMOUNT = 3000;
export const MAX_GEM_CLAIMS = 64;

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------- hits (a page tells the host what it hit)
/** Merges a page's hits by monster id into a flat [id, amount, fx, ...] array (amounts rounded to a tenth). */
export class HitBatch {
  constructor() {
    this.amt = new Float32Array(ID_MASK + 1);
    this.fx = new Uint8Array(ID_MASK + 1);
    this.ids = new Int32Array(MAX_HITS_PER_MSG * 2);
    this.n = 0;
  }
  add(id, amount, fx) {
    id &= ID_MASK;
    if (this.amt[id] === 0) {
      if (this.n >= this.ids.length) return;
      this.ids[this.n++] = id;
    }
    this.amt[id] += amount;
    this.fx[id] |= fx;
  }
  get empty() {
    return this.n === 0;
  }
  /** The flat array to send (at most MAX_HITS_PER_MSG monsters; the rest go in the next message), then forget them. */
  take() {
    const count = Math.min(this.n, MAX_HITS_PER_MSG);
    const out = new Array(count * 3);
    for (let i = 0; i < count; i++) {
      const id = this.ids[i];
      out[i * 3] = id;
      out[i * 3 + 1] = Math.max(0.1, r1(this.amt[id]));
      out[i * 3 + 2] = this.fx[id];
      this.amt[id] = 0;
      this.fx[id] = 0;
    }
    // keep the ones that didn't fit
    let rest = 0;
    for (let i = count; i < this.n; i++) this.ids[rest++] = this.ids[i];
    this.n = rest;
    return out;
  }
  clear() {
    for (let i = 0; i < this.n; i++) {
      this.amt[this.ids[i]] = 0;
      this.fx[this.ids[i]] = 0;
    }
    this.n = 0;
  }
}

/**
 * The host applies another page's hits. `seat` is the sender's seat in the run. Returns how many landed.
 * `onHit(slot, amount)` (optional) is told about each one that did (for flashes).
 */
export function applyHits(world, h, seat, onHit) {
  if (!Array.isArray(h) || h.length > MAX_HITS_PER_MSG * 3 || !Number.isInteger(seat) || seat < 0 || seat >= MAX_HEROES) return 0;
  let n = 0;
  for (let i = 0; i + 2 < h.length; i += 3) {
    const id = h[i];
    const amt = h[i + 1];
    const fx = h[i + 2];
    if (!Number.isInteger(id) || id < 0 || id > ID_MASK) continue;
    if (!finite(amt) || amt <= 0 || amt > MAX_AMOUNT) continue;
    const slot = world.slotOf(id);
    if (slot < 0) continue;
    if (onHit) onHit(slot, amt);
    world.hit(slot, amt, seat, Number.isInteger(fx) && fx >= 0 && fx <= 255 ? fx : 0);
    n++;
  }
  return n;
}

/** The host takes gems another page picked up. Returns how many were still there. */
export function applyGemClaims(world, ids) {
  if (!Array.isArray(ids) || ids.length > MAX_GEM_CLAIMS) return 0;
  let n = 0;
  for (const id of ids) {
    if (!Number.isInteger(id) || id < 0 || id > ID_MASK) continue;
    if (world.claimGem(id) >= 0) n++;
  }
  return n;
}

// ---------------------------------------------------------------- effects (so other screens draw the same weapons)
/** Takes the effects a fighter produced as a flat array [kind, x, y, a, b, ...] and empties it. */
export function packFx(fx) {
  const n = Math.min(fx.n, MAX_FX_PER_MSG);
  const out = new Array(n * 5);
  for (let i = 0; i < n; i++) {
    out[i * 5] = fx.kind[i];
    out[i * 5 + 1] = r1(fx.x[i]);
    out[i * 5 + 2] = r1(fx.y[i]);
    out[i * 5 + 3] = r2(fx.a[i]);
    out[i * 5 + 4] = r2(fx.b[i]);
  }
  fx.n = 0;
  return out;
}

/** Draws what a flat effect array says, through `fighter.spawnCosmetic`. Junk is skipped. */
export function unpackFx(f, fighter) {
  if (!Array.isArray(f) || f.length > MAX_FX_PER_MSG * 5) return 0;
  let n = 0;
  for (let i = 0; i + 4 < f.length; i += 5) {
    const kind = f[i];
    if (!Number.isInteger(kind) || kind < 0 || kind > 9) continue;
    if (!finite(f[i + 1]) || !finite(f[i + 2]) || !finite(f[i + 3]) || !finite(f[i + 4])) continue;
    fighter.spawnCosmetic(kind, f[i + 1], f[i + 2], f[i + 3], f[i + 4]);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- presence
export function packWeapons(wl) {
  let s = '';
  for (let i = 0; i < N_WEAPONS; i++) s += String(Math.max(0, Math.min(MAX_LEVEL, wl[i] | 0)));
  return s;
}

export function unpackWeapons(str, out) {
  for (let i = 0; i < N_WEAPONS; i++) {
    const c = typeof str === 'string' ? str.charCodeAt(i) - 48 : 0;
    out[i] = c >= 0 && c <= MAX_LEVEL ? c : 0;
  }
}

/** My hero as the others see it. `phase`: 'l' lobby, 'p' playing, 'r' results, 'w' watching. Kept small. */
export function packPresence(h, phase) {
  return {
    x: r2(h.x),
    y: r2(h.y),
    f: r2(Math.atan2(h.dy, h.dx)),
    mv: h.moving ? 1 : 0,
    hp: Math.round(h.hp),
    m: Math.round(h.maxHp),
    lv: h.level,
    d: h.down ? 1 : 0,
    rv: Math.round(Math.min(1, h.reviveT / 3) * 100),
    w: packWeapons(h.wl),
    s: h.shieldReady ? 1 : 0,
    iv: h.invuln > 0 ? 1 : 0,
    ph: phase,
  };
}

/** Reads a presence object into a remote hero record (anything with the fields below). Returns false if it is junk. */
export function readPresence(p, r) {
  if (!p || typeof p !== 'object') return false;
  if (!finite(p.x) || !finite(p.y) || Math.abs(p.x) > 400 || Math.abs(p.y) > 400) return false;
  r.x = p.x;
  r.y = p.y;
  if (finite(p.f)) {
    r.dx = Math.cos(p.f);
    r.dy = Math.sin(p.f);
  }
  // the room slides numbers between two updates, so flags are read as "more than half"
  r.moving = p.mv > 0.5;
  r.hp = finite(p.hp) ? Math.max(0, Math.min(5000, p.hp)) : 100;
  r.maxHp = finite(p.m) ? Math.max(1, Math.min(5000, p.m)) : 100;
  r.level = finite(p.lv) ? Math.max(1, Math.min(300, Math.round(p.lv))) : 1;
  r.down = p.d > 0.5;
  r.rv = finite(p.rv) ? Math.max(0, Math.min(1, p.rv / 100)) : 0;
  unpackWeapons(p.w, r.wl);
  r.shield = p.s > 0.5;
  r.invuln = p.iv > 0.5 ? 1 : 0;
  r.phase = typeof p.ph === 'string' ? p.ph.slice(0, 1) : '';
  return true;
}

// ---------------------------------------------------------------- the host's pictures
/** The small header that rides with a snapshot of monsters: kills per seat and the director's counters. */
export function snapshotMeta(world, tNight) {
  return {
    t: Math.round(tNight * 1000) / 1000,
    k: Array.from(world.kills.subarray(0, MAX_HEROES)),
    d: [world.ringIdx, world.bossState, world.nextId & 0x3fffffff, world.nextGem & 0x3fffffff, world.waveIdx],
  };
}

export function validMeta(m) {
  return !!m && typeof m === 'object' && finite(m.t) && m.t >= 0 && m.t < 100000 && Array.isArray(m.d) && m.d.length >= 5 && m.d.every(finite) && Array.isArray(m.k) && m.k.length <= MAX_HEROES;
}

export function readSeat(roster, id) {
  return Array.isArray(roster) ? roster.indexOf(id) : -1;
}
