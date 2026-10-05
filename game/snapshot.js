// The host's picture of the horde as it goes over the wire (a base64 Int16 array per kind), and the other pages'
// buffer that plays those pictures back smoothly. Pure: no DOM, no SDK (atob/btoa exist in browsers and in Node).
import { MAX_MON, MAX_GEMS, ID_MASK, MON, T_BOSS } from './data.js';
import { Monsters } from './field.js';
import { monsterDamage } from './sim.js';

const FIELDS = 4; // Int16 values per monster or gem: id, x*10, y*10, packed
const scratch = new Uint8Array(Math.max(MAX_MON, MAX_GEMS) * FIELDS * 2 + 64);
const view = new DataView(scratch.buffer);

function toBase64(bytes, len) {
  let s = '';
  for (let i = 0; i < len; i += 0x2000) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(len, i + 0x2000)));
  return btoa(s);
}

function fromBase64(str, out) {
  const bin = atob(str);
  const n = Math.min(bin.length, out.length);
  for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
  return n;
}

const toI16 = (v) => (v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v));

/** Every living monster as base64: id, x*10, y*10, type | elite << 3 | hp (1..255) << 4. */
export function encodeMonsters(m) {
  let n = 0;
  for (let i = 0; i < m.n && n < MAX_MON + 8; i++) {
    if (m.dead[i] === 1) continue;
    const hp8 = Math.max(1, Math.min(255, Math.ceil(m.hpf[i] * 255)));
    const off = n * FIELDS * 2;
    view.setInt16(off, m.id[i] & ID_MASK, true);
    view.setInt16(off + 2, toI16(m.x[i] * 10), true);
    view.setInt16(off + 4, toI16(m.y[i] * 10), true);
    view.setInt16(off + 6, (m.type[i] & 7) | ((m.elite[i] ? 1 : 0) << 3) | (hp8 << 4), true);
    n++;
  }
  return { n, data: toBase64(scratch, n * FIELDS * 2) };
}

/** Gems as base64: id, x*10, y*10, tier. */
export function encodeGems(g) {
  const n = Math.min(g.n, MAX_GEMS + 8);
  for (let i = 0; i < n; i++) {
    const off = i * FIELDS * 2;
    view.setInt16(off, g.id[i] & ID_MASK, true);
    view.setInt16(off + 2, toI16(g.x[i] * 10), true);
    view.setInt16(off + 4, toI16(g.y[i] * 10), true);
    view.setInt16(off + 6, g.tier[i] & 3, true);
  }
  return { n, data: toBase64(scratch, n * FIELDS * 2) };
}

const inbox = new Uint8Array(scratch.length);
const inboxView = new DataView(inbox.buffer);

/** What came over the wire for one snapshot of monsters. */
export class Snap {
  constructor() {
    this.t = 0;
    this.n = 0;
    this.id = new Int16Array(MAX_MON + 8);
    this.x = new Float32Array(MAX_MON + 8);
    this.y = new Float32Array(MAX_MON + 8);
    this.type = new Uint8Array(MAX_MON + 8);
    this.elite = new Uint8Array(MAX_MON + 8);
    this.hpf = new Float32Array(MAX_MON + 8);
    this.idx = new Int16Array(ID_MASK + 1).fill(-1); // id -> index here
  }

  /** Forget every id (before loading something else). */
  empty() {
    for (let i = 0; i < this.n; i++) this.idx[this.id[i] & ID_MASK] = -1;
    this.n = 0;
  }

  /** Reads `data` (base64). Returns false if it isn't a valid snapshot (then this stays empty). */
  load(t, data) {
    this.empty();
    if (typeof data !== 'string' || data.length > 40000 || !(t === t)) return false;
    let bytes;
    try {
      bytes = fromBase64(data, inbox);
    } catch {
      return false;
    }
    const count = Math.min(Math.floor(bytes / (FIELDS * 2)), MAX_MON + 8);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const off = i * FIELDS * 2;
      const id = inboxView.getInt16(off, true) & ID_MASK;
      const x = inboxView.getInt16(off + 2, true) / 10;
      const y = inboxView.getInt16(off + 4, true) / 10;
      const p = inboxView.getInt16(off + 6, true);
      const type = p & 7;
      if (type >= MON.length || this.idx[id] >= 0) continue;
      this.id[n] = id;
      this.x[n] = x;
      this.y[n] = y;
      this.type[n] = type;
      this.elite[n] = (p >> 3) & 1;
      this.hpf[n] = ((p >> 4) & 255) / 255;
      this.idx[id] = n;
      n++;
    }
    this.n = n;
    this.t = t;
    return true;
  }
}

/** The latest gems (no smoothing: they sit still). New ones remember when they showed up (the pop-in). */
export class GemSnap {
  constructor() {
    this.t = 0;
    this.n = 0;
    this.id = new Int32Array(MAX_GEMS + 8);
    this.x = new Float32Array(MAX_GEMS + 8);
    this.y = new Float32Array(MAX_GEMS + 8);
    this.tier = new Uint8Array(MAX_GEMS + 8);
    this.born = new Float32Array(MAX_GEMS + 8);
    this.known = new Uint8Array(ID_MASK + 1); // 1: in the current picture
    this.bornAt = new Float32Array(ID_MASK + 1);
    this.old = new Int32Array(MAX_GEMS + 8);
    this.gone = new Int32Array(MAX_GEMS + 8); // ids that were in the previous picture and aren't in this one
    this.goneN = 0;
    this.loaded = false;
  }

  load(t, data) {
    if (typeof data !== 'string' || data.length > 40000 || !(t === t)) return false;
    let bytes;
    try {
      bytes = fromBase64(data, inbox);
    } catch {
      return false;
    }
    const count = Math.min(Math.floor(bytes / (FIELDS * 2)), MAX_GEMS + 8);
    const oldN = this.n;
    for (let i = 0; i < oldN; i++) {
      this.old[i] = this.id[i] & ID_MASK;
      this.known[this.old[i]] = 2; // until seen again
    }
    let n = 0;
    for (let i = 0; i < count; i++) {
      const off = i * FIELDS * 2;
      const id = inboxView.getInt16(off, true) & ID_MASK;
      if (this.known[id] === 1) continue;
      if (this.known[id] === 0) this.bornAt[id] = this.loaded ? t : t - 10;
      this.known[id] = 1;
      this.id[n] = id;
      this.x[n] = inboxView.getInt16(off + 2, true) / 10;
      this.y[n] = inboxView.getInt16(off + 4, true) / 10;
      this.tier[n] = Math.min(2, Math.max(0, inboxView.getInt16(off + 6, true)));
      this.born[n] = this.bornAt[id];
      n++;
    }
    this.goneN = 0;
    for (let i = 0; i < oldN; i++) {
      if (this.known[this.old[i]] !== 2) continue;
      this.known[this.old[i]] = 0;
      this.gone[this.goneN++] = this.old[i];
    }
    this.n = n;
    this.t = t;
    this.loaded = true;
    return true;
  }
}

/**
 * Plays the host's snapshots back about `delay` seconds late, interpolating between the two around that moment, into a
 * Monsters-shaped `view` the weapons and the renderer read like the host's own world.
 */
export class Interp {
  constructor() {
    this.snaps = [new Snap(), new Snap(), new Snap(), new Snap()];
    this.list = []; // the valid ones, oldest first
    this.offset = null; // (my clock) - (host's night time), kept at its smallest
    this.curA = null;
    this.curB = null;
    // deaths found when the playback window moves on (monsters in the older snapshot missing from the newer)
    this.dn = 0;
    this.dx = new Float32Array(MAX_MON + 8);
    this.dy = new Float32Array(MAX_MON + 8);
    this.dtype = new Uint8Array(MAX_MON + 8);
    this.delite = new Uint8Array(MAX_MON + 8);
    // what this page already did to monsters it hit (by wire id), until the host's pictures catch up
    this.hide = new Uint8Array(ID_MASK + 1);
    this.pred = new Float32Array(ID_MASK + 1);
    this.latest = 0;
  }

  reset() {
    for (const s of this.snaps) s.empty();
    this.list.length = 0;
    this.offset = null;
    this.curA = null;
    this.curB = null;
    this.hide.fill(0);
    this.pred.fill(0);
    this.dn = 0;
    this.latest = 0;
  }

  get newest() {
    return this.list.length ? this.list[this.list.length - 1] : null;
  }

  /** A picture arrived from the host: `t` is its night time, `nowSec` this page's clock. */
  push(t, data, nowSec) {
    const est = nowSec - t;
    const last = this.newest;
    if (last && t < last.t - 1.5) this.reset(); // the host changed or restarted: its clock is somewhere else now
    else if (last && t <= last.t) return false; // out of order or a repeat
    if (this.offset === null || Math.abs(est - this.offset) > 2.5) this.offset = est;
    else if (est < this.offset) this.offset = est;
    else this.offset += (est - this.offset) * 0.03;
    let snap;
    if (this.list.length >= this.snaps.length) snap = this.list.shift();
    else snap = this.snaps.find((s) => !this.list.includes(s));
    if (snap === this.curA || snap === this.curB) {
      this.curA = null;
      this.curB = null;
    }
    const ok = snap.load(t, data);
    if (!ok) return false;
    this.list.push(snap);
    this.latest = t;
    return true;
  }

  /** The host's night time as of now, for the HUD (smoothed). */
  hostTime(nowSec) {
    return this.offset === null ? 0 : nowSec - this.offset;
  }

  /**
   * Fills `out` (a Monsters) with the monsters as of `nowSec - delay`. `scale` is { dmg } for the touch damage.
   * Returns out.n.
   */
  fill(out, nowSec, delay, tNight, mode) {
    out.n = 0;
    out.boss = -1;
    this.dn = 0;
    const list = this.list;
    if (list.length === 0 || this.offset === null) return 0;
    const rt = nowSec - this.offset - delay;
    let A;
    let B;
    const last = list[list.length - 1];
    if (rt >= last.t) {
      A = B = last;
    } else if (rt <= list[0].t) {
      A = B = list[0];
    } else {
      A = list[0];
      B = list[1];
      for (let i = 0; i < list.length - 1; i++) {
        if (list[i].t <= rt && rt < list[i + 1].t) {
          A = list[i];
          B = list[i + 1];
          break;
        }
      }
    }
    const span = B.t - A.t;
    const alpha = span > 1e-6 ? Math.min(1, Math.max(0, (rt - A.t) / span)) : 1;
    if (A !== B && (A !== this.curA || B !== this.curB)) {
      // the window moved on: whoever was in A and isn't in B died (or left) just now
      for (let i = 0; i < A.n; i++) {
        const id = A.id[i] & ID_MASK;
        if (B.idx[id] >= 0) continue;
        if (this.hide[id] === 1) {
          // this page already showed that death when its own hit landed
          this.hide[id] = 0;
          this.pred[id] = 0;
          continue;
        }
        this.pred[id] = 0;
        if (this.dn < this.dx.length) {
          this.dx[this.dn] = A.x[i];
          this.dy[this.dn] = A.y[i];
          this.dtype[this.dn] = A.type[i];
          this.delite[this.dn] = A.elite[i];
          this.dn++;
        }
      }
    }
    this.curA = A;
    this.curB = B;
    const dm = mode ?? { dmg: 1, hp: 1, rate: 1 };
    let n = 0;
    for (let k = 0; k < B.n && n < out.cap; k++) {
      const id = B.id[k] & ID_MASK;
      const j = A === B ? -1 : A.idx[id];
      let x = B.x[k];
      let y = B.y[k];
      let hp = B.hpf[k];
      if (j >= 0) {
        x = A.x[j] + (x - A.x[j]) * alpha;
        y = A.y[j] + (y - A.y[j]) * alpha;
        hp = A.hpf[j] + (hp - A.hpf[j]) * alpha;
      }
      const type = B.type[k];
      out.x[n] = x;
      out.y[n] = y;
      out.type[n] = type;
      out.elite[n] = B.elite[k];
      out.hpf[n] = hp;
      out.id[n] = id;
      out.dead[n] = this.hide[id];
      out.dmg[n] = monsterDamage(type, B.elite[k] === 1, tNight, dm);
      if (type === T_BOSS) out.boss = n;
      n++;
    }
    out.n = n;
    return n;
  }
}
