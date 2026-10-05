// The horde: monsters, XP gems and the director that decides what spawns when. Runs on the host's page only
// (and on the title screen and in tests). Pure: a seeded RNG, no DOM, no SDK, no allocation in the step.
import {
  ARENA_R, SPAWN_R, MAX_MON, MAX_GEMS, ID_MASK, MAX_HEROES, MON, SPAWN_TABLE, WAVE_SECS, RING_EVERY, BOSS_BEFORE_END, PEAK_RATE,
  T_SKEL, T_BAT, T_SLIME, T_GHOUL, T_KNIGHT, T_BOSS, T_DUMMY, MON_R, hpScale, dmgScale, speedScale, modeOf, FX_SLOW, FX_KNOCK,
} from './data.js';
import { Monsters, Gems, SpatialHash } from './field.js';
import { mulberry32 } from './rng.js';

const EV_CAP = 1024;
export const EV_KILL = 0;
export const EV_CRUMBLE = 1;
export const EV_BOSS = 2;

const MAX_R2 = (ARENA_R + SPAWN_R) * (ARENA_R + SPAWN_R);

/** The most HP a monster of this kind can have `t` seconds into the night (the same on every page). */
export function monsterMaxHp(type, elite, t, mode, players) {
  const base = MON[type].hp;
  if (type === T_DUMMY) return base;
  if (type === T_BOSS) return base * Math.sqrt(hpScale(t)) * Math.pow(Math.max(1, players), 0.7) * mode.hp;
  return base * hpScale(t) * mode.hp * (1 + 0.28 * (Math.max(1, players) - 1)) * (elite ? 1.5 : 1);
}

export function monsterDamage(type, elite, t, mode) {
  return MON[type].dmg * dmgScale(t) * mode.dmg * (elite ? 1.15 : 1);
}

export class World {
  /**
   * @param {{ seed?: number, length?: number, hard?: boolean, players?: number, camp?: boolean }} opts
   * `camp`: a quiet clearing for the lobby: no horde, only training dummies.
   */
  constructor(opts = {}) {
    this.rng = mulberry32((opts.seed ?? 1) >>> 0);
    this.length = opts.length === 600 ? 600 : opts.length > 0 ? opts.length : 300;
    this.mode = modeOf(opts.hard ? 'hard' : 'normal');
    this.players = Math.max(1, opts.players | 0 || 1);
    this.camp = opts.camp === true;
    this.T = 0;
    this.tick = 0;
    this.mon = new Monsters();
    this.gem = new Gems();
    this.hash = new SpatialHash();
    this.idSlot = new Int16Array(ID_MASK + 1).fill(-1);
    this.gemSlot = new Int16Array(ID_MASK + 1).fill(-1);
    this.nextId = 0;
    this.nextGem = 0;
    this.acc = 0; // fractional spawns banked
    this.waveIdx = 0;
    this.ringIdx = 0;
    this.bossState = 0; // 0 not yet, 1 walking the arena, 2 dead
    this.dawn = false;
    this.opened = false;
    this.crumbleAcc = 0;
    this.kills = new Int32Array(MAX_HEROES);
    this.totalKills = 0;
    // heroes the monsters chase (set by whoever owns them, every step)
    this.hx = new Float32Array(MAX_HEROES);
    this.hy = new Float32Array(MAX_HEROES);
    this.ha = new Uint8Array(MAX_HEROES);
    // what happened this step (the page drains it after each step)
    this.evN = 0;
    this.evKind = new Uint8Array(EV_CAP);
    this.evX = new Float32Array(EV_CAP);
    this.evY = new Float32Array(EV_CAP);
    this.evType = new Uint8Array(EV_CAP);
    this.evElite = new Uint8Array(EV_CAP);
    this.evBy = new Int8Array(EV_CAP);
    this.bossKilledBy = -1;
    this.spX = 0; // scratch: the last spawn point found
    this.spY = 0;
    this.anX = 0; // scratch: the hero a spawn is placed around
    this.anY = 0;
    this.waveChanged = false; // the horde just grew (the page plays a sting)
    this.ringSpawned = false; // an elite ring just appeared
    this.bossSpawned = false;
  }

  // ---------------------------------------------------------------- heroes the horde chases
  clearHeroes() {
    this.ha.fill(0);
  }
  setHero(i, x, y, alive) {
    if (i < 0 || i >= MAX_HEROES) return;
    this.hx[i] = x;
    this.hy[i] = y;
    this.ha[i] = alive ? 1 : 0;
  }

  // ---------------------------------------------------------------- events
  pushEvent(kind, x, y, type, elite, by) {
    const i = this.evN;
    if (i >= EV_CAP) return;
    this.evKind[i] = kind;
    this.evX[i] = x;
    this.evY[i] = y;
    this.evType[i] = type;
    this.evElite[i] = elite;
    this.evBy[i] = by;
    this.evN = i + 1;
  }
  clearEvents() {
    this.evN = 0;
    this.waveChanged = false;
    this.ringSpawned = false;
    this.bossSpawned = false;
    this.bossKilledBy = -1;
  }

  // ---------------------------------------------------------------- spawning
  /** Adds a monster; returns its slot, or -1 when full. `speedMul` and `hpMul` tweak this one. */
  spawn(type, x, y, elite = false, speedMul = 1, hpMul = 1) {
    const m = this.mon;
    if (m.n >= m.cap || (type !== T_BOSS && type !== T_DUMMY && m.n >= MAX_MON)) return -1;
    let id;
    let guard = 0;
    do {
      id = this.nextId++ & ID_MASK;
    } while (this.idSlot[id] !== -1 && ++guard < 40000);
    return this.place(id, type, x, y, elite, speedMul, hpMul, 1);
  }

  /** Puts a monster in the next slot under a given wire id (a new one, or one brought back from a snapshot). */
  place(id, type, x, y, elite, speedMul, hpMul, hpFrac) {
    const m = this.mon;
    const i = m.n;
    m.n = i + 1;
    m.id[i] = id;
    this.idSlot[id] = i;
    m.x[i] = x;
    m.y[i] = y;
    m.type[i] = type;
    m.elite[i] = elite ? 1 : 0;
    const maxHp = monsterMaxHp(type, elite, this.T, this.mode, this.players) * hpMul;
    m.maxHp[i] = maxHp;
    m.hp[i] = Math.max(1e-3, maxHp * hpFrac);
    m.hpf[i] = hpFrac;
    m.dead[i] = 0;
    m.vx[i] = 0;
    m.vy[i] = 0;
    m.slow[i] = 0;
    m.aux[i] = type === T_BOSS ? 5 : this.rng() * 6.28;
    m.spd[i] = MON[type].speed * speedScale(this.T) * (elite ? 1.12 : 1) * speedMul * (type === T_BOSS ? 1 : 0.9 + 0.2 * this.rng());
    m.dmg[i] = monsterDamage(type, elite, this.T, this.mode);
    if (type === T_BOSS) m.boss = i;
    return i;
  }

  /**
   * Takes over from the host's last pictures (a new host after a reload or a hand-over): the monsters and gems as they were
   * and the director's counters. `mon` and `gem` are decoded snapshots (see snapshot.js).
   */
  restore(T, mon, gem, meta) {
    this.mon.clear(this.idSlot);
    this.gem.n = 0;
    this.gemSlot.fill(-1);
    this.T = T;
    this.waveIdx = Math.max(0, Math.floor(T / WAVE_SECS));
    this.ringIdx = meta && meta.ring > 0 ? meta.ring | 0 : 0;
    this.bossState = meta && meta.boss > 0 ? meta.boss | 0 : 0;
    this.nextId = meta && meta.nid > 0 ? meta.nid | 0 : 0;
    this.nextGem = meta && meta.ngid > 0 ? meta.ngid | 0 : 0;
    this.dawn = T >= this.length;
    this.opened = true;
    if (mon) {
      for (let i = 0; i < mon.n && this.mon.n < this.mon.cap; i++) {
        this.place(mon.id[i], mon.type[i], mon.x[i], mon.y[i], mon.elite[i] === 1, 1, 1, Math.min(1, Math.max(0.004, mon.hpf[i])));
      }
    }
    if (gem) {
      for (let i = 0; i < gem.n && this.gem.n < MAX_GEMS; i++) {
        const j = this.gem.n++;
        this.gem.id[j] = gem.id[i];
        this.gemSlot[gem.id[i] & ID_MASK] = j;
        this.gem.x[j] = gem.x[i];
        this.gem.y[j] = gem.y[i];
        this.gem.tier[j] = gem.tier[i];
        this.gem.born[j] = T - 5;
      }
    }
    this.hash.rebuild(this.mon);
  }

  addDummy(x, y) {
    return this.spawn(T_DUMMY, x, y, false, 1, 1);
  }

  /** A point `dist` from (ax, ay) that is inside the arena (and its dark rim). Writes into this.sp. */
  findSpawn(ax, ay, dist) {
    const rng = this.rng;
    const lim = ARENA_R + SPAWN_R - 1;
    for (let k = 0; k < 6; k++) {
      const a = rng() * Math.PI * 2;
      const px = ax + Math.cos(a) * dist;
      const py = ay + Math.sin(a) * dist;
      if (px * px + py * py <= lim * lim) {
        this.spX = px;
        this.spY = py;
        return;
      }
    }
    const a = Math.atan2(-ay, -ax) + (rng() - 0.5) * 1.2;
    this.spX = ax + Math.cos(a) * dist;
    this.spY = ay + Math.sin(a) * dist;
  }

  /** The hero a spawn is placed around: a random one that is up and about (or the middle). */
  anchor() {
    let n = 0;
    for (let i = 0; i < MAX_HEROES; i++) if (this.ha[i]) n++;
    if (n === 0) {
      this.anX = 0;
      this.anY = 0;
      return;
    }
    let pick = Math.floor(this.rng() * n);
    for (let i = 0; i < MAX_HEROES; i++) {
      if (!this.ha[i]) continue;
      if (pick-- === 0) {
        this.anX = this.hx[i];
        this.anY = this.hy[i];
        return;
      }
    }
  }

  pickType() {
    const tf = Math.min(1, this.T / this.length);
    let total = 0;
    for (let i = 0; i < SPAWN_TABLE.length; i++) {
      const e = SPAWN_TABLE[i];
      if (tf >= e.from) total += e.w0 + (e.w1 - e.w0) * tf;
    }
    let r = this.rng() * total;
    for (let i = 0; i < SPAWN_TABLE.length; i++) {
      const e = SPAWN_TABLE[i];
      if (tf < e.from) continue;
      r -= e.w0 + (e.w1 - e.w0) * tf;
      if (r <= 0) return e.type;
    }
    return T_SKEL;
  }

  spawnOne() {
    this.anchor();
    // the first seconds: they come from nearer and hurry, so a night never opens with ten quiet seconds
    const early = this.T < 15;
    this.findSpawn(this.anX, this.anY, early ? 14 + this.rng() * 1.5 : 16.5 + this.rng() * 2.5);
    this.spawn(early ? T_SKEL : this.pickType(), this.spX, this.spY, false, early ? 1.7 : 1);
  }

  /** Makes room for `count` more monsters by dropping the ones farthest from every hero. */
  makeRoom(count) {
    const m = this.mon;
    let guard = 0;
    while (m.n + count > MAX_MON && guard++ < MAX_MON) {
      let far = -1;
      let fd = -1;
      for (let i = 0; i < m.n; i++) {
        if (m.dead[i] || m.type[i] === T_BOSS || m.type[i] === T_DUMMY) continue;
        let nd = 1e12;
        for (let h = 0; h < MAX_HEROES; h++) {
          if (!this.ha[h]) continue;
          const dx = m.x[i] - this.hx[h];
          const dy = m.y[i] - this.hy[h];
          const d = dx * dx + dy * dy;
          if (d < nd) nd = d;
        }
        if (nd > fd) {
          fd = nd;
          far = i;
        }
      }
      if (far < 0) break;
      m.removeAt(far, this.idSlot, ID_MASK);
    }
  }

  /** A ring of elite monsters closing in on (cx, cy). */
  spawnRing(cx, cy, count, radius) {
    this.makeRoom(count);
    const rng = this.rng;
    const off = rng() * Math.PI * 2;
    for (let k = 0; k < count; k++) {
      const a = off + (k / count) * Math.PI * 2;
      let px = cx + Math.cos(a) * radius;
      let py = cy + Math.sin(a) * radius;
      const r2 = px * px + py * py;
      const lim = ARENA_R + SPAWN_R - 1;
      if (r2 > lim * lim) {
        const s = lim / Math.sqrt(r2);
        px *= s;
        py *= s;
      }
      this.spawn(this.pickType(), px, py, true, 0.95);
    }
  }

  spawnBoss() {
    this.anchor();
    let bx = 0;
    let by = 0;
    let ok = false;
    for (let k = 0; k < 12 && !ok; k++) {
      const a = this.rng() * Math.PI * 2;
      bx = this.anX + Math.cos(a) * 15;
      by = this.anY + Math.sin(a) * 15;
      ok = bx * bx + by * by < (ARENA_R - 6) * (ARENA_R - 6);
    }
    if (!ok) {
      bx = this.anX * 0.2;
      by = this.anY * 0.2;
    }
    this.makeRoom(1);
    const slot = this.spawn(T_BOSS, bx, by, false);
    if (slot >= 0) {
      this.bossState = 1;
      this.bossSpawned = true;
    }
    return slot;
  }

  // ---------------------------------------------------------------- gems
  dropGem(x, y, tier) {
    const g = this.gem;
    if (g.n >= MAX_GEMS) {
      // too many on the floor: the oldest one gets richer instead
      if (g.tier[0] < 2) g.tier[0]++;
      return;
    }
    const i = g.n++;
    let id;
    let guard = 0;
    do {
      id = this.nextGem++ & ID_MASK;
    } while (this.gemSlot[id] !== -1 && ++guard < 40000);
    g.id[i] = id;
    this.gemSlot[id] = i;
    g.x[i] = x;
    g.y[i] = y;
    g.tier[i] = tier;
    g.born[i] = this.T;
  }

  /** Takes a gem off the floor. Returns its tier, or -1 if it's gone (someone else took it first). */
  claimGem(id) {
    const slot = this.gemSlot[id & ID_MASK];
    if (slot < 0 || slot >= this.gem.n || this.gem.id[slot] !== id) return -1;
    const tier = this.gem.tier[slot];
    this.gem.removeAt(slot, this.gemSlot, ID_MASK);
    return tier;
  }

  // ---------------------------------------------------------------- damage
  /** Finds a monster by its wire id; -1 if it's gone. */
  slotOf(id) {
    const s = this.idSlot[id & ID_MASK];
    return s >= 0 && s < this.mon.n && this.mon.id[s] === id && !this.mon.dead[s] ? s : -1;
  }

  /** `by` is the hero slot that dealt it (-1: nobody). `fx` carries slow/knockback. Returns true if it died. */
  hit(slot, amount, by, fx) {
    const m = this.mon;
    if (slot < 0 || slot >= m.n || m.dead[slot] === 1) return false;
    const type = m.type[slot];
    if (type === T_DUMMY) return false;
    if (!(amount > 0)) return false;
    m.hp[slot] -= amount;
    m.hpf[slot] = Math.max(0, m.hp[slot] / m.maxHp[slot]);
    const kind = fx & 3;
    if (kind === FX_SLOW) {
      const secs = (fx >> 2) / 8;
      if (secs > m.slow[slot]) m.slow[slot] = secs;
    } else if (kind === FX_KNOCK && type !== T_BOSS && by >= 0 && by < MAX_HEROES) {
      const dx = m.x[slot] - this.hx[by];
      const dy = m.y[slot] - this.hy[by];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = type === T_KNIGHT ? 3 : 6;
      m.vx[slot] += (dx / d) * force;
      m.vy[slot] += (dy / d) * force;
    }
    if (m.hp[slot] <= 0) {
      this.kill(slot, by);
      return true;
    }
    return false;
  }

  kill(slot, by) {
    const m = this.mon;
    if (m.dead[slot] === 1) return;
    m.dead[slot] = 1;
    m.hpf[slot] = 0;
    const type = m.type[slot];
    const elite = m.elite[slot];
    const x = m.x[slot];
    const y = m.y[slot];
    if (by >= 0 && by < MAX_HEROES) this.kills[by]++;
    this.totalKills++;
    if (type === T_BOSS) {
      this.bossState = 2;
      this.bossKilledBy = by;
      this.pushEvent(EV_BOSS, x, y, type, 0, by);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        this.dropGem(x + Math.cos(a) * 1.8, y + Math.sin(a) * 1.8, 2);
      }
      return;
    }
    this.pushEvent(EV_KILL, x, y, type, elite, by);
    const r = this.rng();
    let tier = -1;
    switch (type) {
      case T_SKEL:
        if (r < 0.9) tier = 0;
        break;
      case T_BAT:
        if (r < 0.8) tier = 0;
        break;
      case T_SLIME:
        tier = r < 0.25 ? 1 : 0;
        break;
      case T_GHOUL:
        tier = r < 0.55 ? 1 : 0;
        break;
      case T_KNIGHT:
        tier = r < 0.35 ? 2 : 1;
        break;
      default:
        break;
    }
    if (elite) tier = Math.min(2, Math.max(tier, 0) + 1);
    if (tier >= 0) this.dropGem(x + (this.rng() - 0.5) * 0.5, y + (this.rng() - 0.5) * 0.5, tier);
  }

  // ---------------------------------------------------------------- the step
  /** Removes the monsters that died since the last step. Slots change here and only here. */
  compact() {
    const m = this.mon;
    for (let i = m.n - 1; i >= 0; i--) if (m.dead[i] === 1) m.removeAt(i, this.idSlot, ID_MASK);
  }

  step(dt) {
    this.T += dt;
    this.tick++;
    this.compact();
    if (!this.camp) this.direct(dt);
    // One rebuild a step, before the move: the crowd test and this step's weapons use it (a monster that crossed a
    // cell edge within one step is off by a few centimetres, which nobody sees).
    this.hash.rebuild(this.mon);
    this.move(dt);
  }

  direct(dt) {
    const T = this.T;
    const len = this.length;
    if (this.dawn) {
      this.crumble(dt);
      return;
    }
    if (!this.opened) {
      this.opened = true;
      for (let k = 0; k < 4; k++) this.spawnOne();
    }
    const waves = Math.max(2, Math.round(len / WAVE_SECS));
    const wave = Math.min(waves - 1, Math.floor(T / WAVE_SECS));
    if (wave !== this.waveIdx) {
      this.waveIdx = wave;
      this.waveChanged = true;
    }
    const f = wave / (waves - 1);
    const rate = (1 + (PEAK_RATE - 1) * Math.pow(f, 2)) * this.mode.rate * (1 + 0.55 * (this.players - 1));
    this.acc = Math.min(this.acc + rate * dt, 10);
    while (this.acc >= 1) {
      if (this.mon.n >= MAX_MON) {
        this.acc = Math.min(this.acc, 1);
        break;
      }
      this.acc -= 1;
      this.spawnOne();
    }
    const nextRing = (this.ringIdx + 1) * RING_EVERY;
    if (T >= nextRing && nextRing < len - BOSS_BEFORE_END) {
      this.ringIdx++;
      this.ringSpawned = true;
      const per = Math.max(1, this.countActive());
      const count = Math.round((12 + 3 * this.ringIdx) * (per > 1 ? 0.8 : 1));
      for (let h = 0; h < MAX_HEROES; h++) if (this.ha[h]) this.spawnRing(this.hx[h], this.hy[h], count, 17);
      if (this.countActive() === 0) this.spawnRing(0, 0, count, 17);
    }
    if (this.bossState === 0 && T >= len - BOSS_BEFORE_END) this.spawnBoss();
    if (T >= len) {
      this.dawn = true;
      this.crumbleAcc = 0;
    }
  }

  countActive() {
    let n = 0;
    for (let i = 0; i < MAX_HEROES; i++) if (this.ha[i]) n++;
    return n;
  }

  /** Dawn: the horde falls apart, a few a step, none of them dropping anything. */
  crumble(dt) {
    const m = this.mon;
    this.crumbleAcc += dt * 160;
    while (this.crumbleAcc >= 1 && m.n > 0) {
      this.crumbleAcc -= 1;
      // find a live one starting from a random slot
      let s = Math.floor(this.rng() * m.n);
      let tries = 0;
      while (m.dead[s] === 1 && tries++ < m.n) s = (s + 1) % m.n;
      if (m.dead[s] === 1) break;
      m.dead[s] = 1;
      this.pushEvent(EV_CRUMBLE, m.x[s], m.y[s], m.type[s], m.elite[s], -1);
    }
  }

  /** True once dawn has come and every monster has crumbled. */
  get cleared() {
    return this.dawn && this.mon.n === 0;
  }

  move(dt) {
    const m = this.mon;
    const n = m.n;
    const T = this.T;
    const x = m.x;
    const y = m.y;
    const decay = Math.exp(-8 * dt);
    const stag = this.tick & 1;
    const boss = m.boss;
    const bx = boss >= 0 ? x[boss] : 0;
    const by = boss >= 0 ? y[boss] : 0;
    const bossR = MON_R[T_BOSS];
    for (let i = 0; i < n; i++) {
      if (m.dead[i] === 1) continue;
      const type = m.type[i];
      if (type === T_DUMMY) continue;
      // chase the nearest hero that is up
      let best = -1;
      let bd = 1e12;
      for (let h = 0; h < MAX_HEROES; h++) {
        if (!this.ha[h]) continue;
        const dx = this.hx[h] - x[i];
        const dy = this.hy[h] - y[i];
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = h;
        }
      }
      let vx = 0;
      let vy = 0;
      if (best >= 0) {
        const dist = Math.sqrt(bd);
        if (dist > 0.01) {
          const ux = (this.hx[best] - x[i]) / dist;
          const uy = (this.hy[best] - y[i]) / dist;
          let speed = m.spd[i];
          if (m.slow[i] > 0) {
            speed *= 0.5;
            m.slow[i] -= dt;
          }
          if (type === T_BAT) {
            const w = Math.sin(T * 5 + m.aux[i]) * 0.7;
            vx = (ux - uy * w) * speed;
            vy = (uy + ux * w) * speed;
          } else if (type === T_BOSS) {
            m.aux[i] -= dt;
            if (m.aux[i] <= -0.7) m.aux[i] = 5 + this.rng() * 2;
            const dash = m.aux[i] <= 0 ? 3.2 : 1;
            vx = ux * speed * dash;
            vy = uy * speed * dash;
          } else {
            vx = ux * speed;
            vy = uy * speed;
          }
        }
      }
      x[i] += (vx + m.vx[i]) * dt;
      y[i] += (vy + m.vy[i]) * dt;
      m.vx[i] *= decay;
      m.vy[i] *= decay;
      // crowd: push apart from neighbours (half of them each step) and out of the boss
      if (((i + stag) & 1) === 0 && type !== T_BOSS) {
        const k = this.hash.collect(x[i], y[i], 0.9, this.nb);
        const ri = MON_R[type];
        for (let j = 0; j < k; j++) {
          const s = this.nb[j];
          if (s === i || m.dead[s] === 1) continue;
          const dx = x[i] - x[s];
          const dy = y[i] - y[s];
          const min = ri + MON_R[m.type[s]];
          const d2 = dx * dx + dy * dy;
          if (d2 < min * min && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const push = ((min - d) / d) * 0.32;
            x[i] += dx * push;
            y[i] += dy * push;
          }
        }
        if (boss >= 0) {
          const dx = x[i] - bx;
          const dy = y[i] - by;
          const min = bossR + ri;
          const d2 = dx * dx + dy * dy;
          if (d2 < min * min && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const push = ((min - d) / d) * 0.5;
            x[i] += dx * push;
            y[i] += dy * push;
          }
        }
      }
      const r2 = x[i] * x[i] + y[i] * y[i];
      if (r2 > MAX_R2) {
        const s = Math.sqrt(MAX_R2 / r2);
        x[i] *= s;
        y[i] *= s;
      }
    }
  }
}
World.prototype.nb = new Int32Array(MAX_MON + 16);
