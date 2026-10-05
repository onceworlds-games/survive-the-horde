// A hero: movement, health, XP, upgrades. Pure; the page that owns the hero steps it, whatever the host is doing.
import {
  HERO, ARENA_R, N_WEAPONS, N_PASSIVES, MAX_LEVEL, MAX_WEAPONS, MAX_PASSIVES, W_BOLT, W_SHIELD, SHIELD,
  P_HP, P_SPEED, P_PICKUP, P_COOLDOWN, P_DAMAGE, P_REGEN, U_PASSIVE_BASE, U_RECOVER, xpNeeded, MAX_MON,
} from './data.js';
import { gather } from './field.js';

export const EV_HURT = 1;
export const EV_SHIELD = 2;
export const EV_DIED = 4;
export const EV_LEVEL = 8;
export const EV_REVIVED = 16;

export const OFFER_SECS = 8; // co-op: the first card is taken for you after this long

export class HeroState {
  constructor(id, idx, rng = Math.random) {
    this.id = id;
    this.idx = idx; // seat in the run (colour, kill count)
    this.rng = rng;
    this.x = 0;
    this.y = 0;
    this.dx = 1; // facing (unit vector)
    this.dy = 0;
    this.moving = false;
    this.walk = 0; // walk-cycle phase
    this.vx = 0; // velocity last step (for trails and the camera)
    this.vy = 0;
    this.hp = HERO.hp;
    this.maxHp = HERO.hp;
    this.down = false;
    this.invuln = 0;
    this.hitCd = 0;
    this.reviveT = 0; // seconds of revive progress while down
    this.level = 1;
    this.xp = 0;
    this.pending = 0; // level-ups waiting for a pick
    this.offer = new Int8Array(3);
    this.nOffer = 0;
    this.offerT = 0;
    this.wl = new Int8Array(N_WEAPONS);
    this.pl = new Int8Array(N_PASSIVES);
    this.cd = new Float32Array(N_WEAPONS);
    this.wl[W_BOLT] = 1;
    this.nW = 1;
    this.nP = 0;
    this.shieldT = 0; // seconds until the Holy Shield is back
    this.kills = 0;
    this.ev = 0; // bit flags the page reads and clears: hurt, shield, died, level, revived
    this.godmode = false;
    this.waveReq = false; // the Holy Shield at level 5 sends out a shockwave when it blocks
    this.speed = HERO.speed;
    this.pickup = HERO.pickup;
    this.cdMul = 1;
    this.dmgMul = 1;
    this.regen = 0;
    this.recompute();
  }

  recompute() {
    this.maxHp = HERO.hp + 20 * this.pl[P_HP];
    this.speed = HERO.speed * (1 + 0.08 * this.pl[P_SPEED]);
    this.pickup = HERO.pickup * (1 + 0.3 * this.pl[P_PICKUP]);
    this.cdMul = Math.max(0.4, 1 - 0.08 * this.pl[P_COOLDOWN]);
    this.dmgMul = 1 + 0.12 * this.pl[P_DAMAGE];
    this.regen = 0.5 * this.pl[P_REGEN];
    if (this.hp > this.maxHp) this.hp = this.maxHp;
  }

  get hasShield() {
    return this.wl[W_SHIELD] > 0;
  }
  get shieldReady() {
    return this.wl[W_SHIELD] > 0 && this.shieldT <= 0;
  }
  /** Takes and clears the event flags. */
  takeEvents() {
    const e = this.ev;
    this.ev = 0;
    return e;
  }
}

/** Moves a hero one step. (mx, my) is the wish, length at most 1. `mates`: the other heroes (anything with x, y, down). */
export function heroStep(h, dt, mx, my, mates) {
  let len = Math.sqrt(mx * mx + my * my);
  if (!(len === len)) {
    mx = 0;
    my = 0;
    len = 0;
  }
  if (len > 1) {
    mx /= len;
    my /= len;
    len = 1;
  }
  const speed = h.down ? HERO.ghostSpeed : h.speed;
  const ox = h.x;
  const oy = h.y;
  h.x += mx * speed * dt;
  h.y += my * speed * dt;
  const lim = ARENA_R - 0.6;
  const r2 = h.x * h.x + h.y * h.y;
  if (r2 > lim * lim) {
    const s = lim / Math.sqrt(r2);
    h.x *= s;
    h.y *= s;
  }
  h.vx = dt > 0 ? (h.x - ox) / dt : 0;
  h.vy = dt > 0 ? (h.y - oy) / dt : 0;
  h.moving = len > 0.12;
  if (h.moving) {
    const k = Math.min(1, dt * 16);
    h.dx += (mx / len - h.dx) * k;
    h.dy += (my / len - h.dy) * k;
    const fl = Math.sqrt(h.dx * h.dx + h.dy * h.dy) || 1;
    h.dx /= fl;
    h.dy /= fl;
    h.walk += dt * speed * len * 1.9;
  }
  if (h.invuln > 0) h.invuln -= dt;
  if (h.hitCd > 0) h.hitCd -= dt;
  if (h.shieldT > 0) h.shieldT -= dt;
  if (h.down) {
    // a teammate standing next to a ghost brings them back
    let near = false;
    if (mates) {
      const R = HERO.reviveRange;
      for (let i = 0; i < mates.length; i++) {
        const o = mates[i];
        if (o === h || !o || o.down) continue;
        const dx = o.x - h.x;
        const dy = o.y - h.y;
        if (dx * dx + dy * dy < R * R) {
          near = true;
          break;
        }
      }
    }
    h.reviveT = near ? h.reviveT + dt : Math.max(0, h.reviveT - dt * 0.6);
    if (h.reviveT >= HERO.reviveSecs) revive(h);
    return;
  }
  if (h.regen > 0 && h.hp < h.maxHp) h.hp = Math.min(h.maxHp, h.hp + h.regen * dt);
}

export function revive(h) {
  h.down = false;
  h.hp = Math.max(1, Math.round(h.maxHp * 0.5));
  h.invuln = HERO.reviveInvuln;
  h.reviveT = 0;
  h.hitCd = 0;
  h.ev |= EV_REVIVED;
}

/** Hurts a hero (the shield may absorb it). Returns the damage taken. */
export function damageHero(h, dmg) {
  if (h.down || h.godmode || h.invuln > 0 || !(dmg > 0)) return 0;
  if (h.shieldReady) {
    h.shieldT = SHIELD.cd[h.wl[W_SHIELD] - 1] * h.cdMul;
    h.hitCd = Math.max(h.hitCd, 0.4);
    h.ev |= EV_SHIELD;
    if (h.wl[W_SHIELD] >= 5) h.waveReq = true;
    return 0;
  }
  h.hp -= dmg;
  h.ev |= EV_HURT;
  if (h.hp <= 0) {
    h.hp = 0;
    h.down = true;
    h.reviveT = 0;
    h.ev |= EV_DIED;
  }
  return dmg;
}

const touchOut = new Int32Array(MAX_MON + 16);
const touchBuf = new Int32Array(MAX_MON + 16);

/** Monsters touching the hero hurt it (the worst one, plus a little per extra), at most once per half second. */
export function heroContact(h, mon, hash) {
  if (h.down || h.invuln > 0 || h.hitCd > 0) return 0;
  const k = gather(mon, hash, h.x, h.y, HERO.r * 0.85, touchOut, touchBuf);
  if (k === 0) return 0;
  let worst = 0;
  for (let i = 0; i < k; i++) {
    const d = mon.dmg[touchOut[i]];
    if (d > worst) worst = d;
  }
  h.hitCd = HERO.hitCd;
  return damageHero(h, worst * (1 + 0.08 * Math.min(8, k - 1)));
}

/** Gems inside the pickup radius: writes their slots into `out`, returns the count. (A gem within reach is taken.) */
export function gemsInReach(h, gems, out) {
  if (h.down) return 0;
  const R = h.pickup;
  const R2 = R * R;
  let c = 0;
  for (let i = 0; i < gems.n && c < out.length; i++) {
    const dx = gems.x[i] - h.x;
    const dy = gems.y[i] - h.y;
    if (dx * dx + dy * dy < R2) out[c++] = i;
  }
  return c;
}

// ---------------------------------------------------------------- XP and upgrades
/** Adds XP; returns the levels gained. Each gained level is a pending pick. */
export function addXp(h, amount) {
  if (!(amount > 0) || h.down) return 0;
  h.xp += amount;
  let gained = 0;
  while (h.xp >= xpNeeded(h.level) && h.level < 300) {
    h.xp -= xpNeeded(h.level);
    h.level++;
    h.pending++;
    gained++;
  }
  if (gained) h.ev |= EV_LEVEL;
  return gained;
}

const poolIds = new Int16Array(32);
const poolW = new Float32Array(32);

/** Fills h.offer with up to three different upgrades the hero can still take (or a heal if there are none). */
export function openOffer(h) {
  let n = 0;
  for (let w = 0; w < N_WEAPONS; w++) {
    const lv = h.wl[w];
    if (lv > 0 && lv < MAX_LEVEL) {
      poolIds[n] = w;
      poolW[n++] = 1.7;
    } else if (lv === 0 && h.nW < MAX_WEAPONS) {
      poolIds[n] = w;
      poolW[n++] = 1;
    }
  }
  for (let p = 0; p < N_PASSIVES; p++) {
    const lv = h.pl[p];
    if (lv > 0 && lv < MAX_LEVEL) {
      poolIds[n] = U_PASSIVE_BASE + p;
      poolW[n++] = 1.2;
    } else if (lv === 0 && h.nP < MAX_PASSIVES) {
      poolIds[n] = U_PASSIVE_BASE + p;
      poolW[n++] = 0.8;
    }
  }
  let k = 0;
  while (k < 3 && n > 0) {
    let total = 0;
    for (let i = 0; i < n; i++) total += poolW[i];
    let r = h.rng() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= poolW[i];
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    h.offer[k++] = poolIds[pick];
    poolIds[pick] = poolIds[n - 1];
    poolW[pick] = poolW[n - 1];
    n--;
  }
  if (k === 0) h.offer[k++] = U_RECOVER;
  h.nOffer = k;
  h.offerT = OFFER_SECS;
}

/** The level of upgrade `id` this hero has now (0 = new). */
export function upgradeLevel(h, id) {
  if (id === U_RECOVER) return 0;
  return id >= U_PASSIVE_BASE ? h.pl[id - U_PASSIVE_BASE] : h.wl[id];
}

/** Takes the card at index `i` of the current offer. Returns true if it did something. */
export function pickOffer(h, i) {
  if (h.nOffer === 0 || i < 0 || i >= h.nOffer) return false;
  applyUpgrade(h, h.offer[i]);
  h.nOffer = 0;
  h.offerT = 0;
  if (h.pending > 0) h.pending--;
  if (h.pending > 0) openOffer(h);
  return true;
}

export function applyUpgrade(h, id) {
  if (id === U_RECOVER) {
    h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.4);
    return;
  }
  if (id >= U_PASSIVE_BASE) {
    const p = id - U_PASSIVE_BASE;
    if (p < 0 || p >= N_PASSIVES || h.pl[p] >= MAX_LEVEL) return;
    if (h.pl[p] === 0) {
      if (h.nP >= MAX_PASSIVES) return;
      h.nP++;
    }
    h.pl[p]++;
    h.recompute();
    if (p === P_HP) h.hp = Math.min(h.maxHp, h.hp + 20);
    return;
  }
  if (id < 0 || id >= N_WEAPONS || h.wl[id] >= MAX_LEVEL) return;
  if (h.wl[id] === 0) {
    if (h.nW >= MAX_WEAPONS) return;
    h.nW++;
    h.cd[id] = 0.3;
  }
  h.wl[id]++;
  if (id === W_SHIELD && h.wl[id] === 1) h.shieldT = 0;
}

/** Co-op: a pick nobody made in time is the first card. Call every step while a card is up. */
export function tickOffer(h, dt, autoPick) {
  if (h.nOffer === 0) {
    if (h.pending > 0 && !h.down) openOffer(h);
    return;
  }
  if (!autoPick) return;
  h.offerT -= dt;
  if (h.offerT <= 0) pickOffer(h, 0);
}

