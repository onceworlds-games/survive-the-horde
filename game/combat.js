// A hero's weapons. They fire on their own at whatever field of monsters they are given (the host's world or an
// interpolated view) and write what they hit into a buffer; the caller applies it. Pure, no allocation in update().
import {
  MAX_MON, ID_MASK, ARENA_R, BOLT, BLADES, RING, LIGHTNING, RAIN, NOVA, SHIELD, MON_R,
  W_BOLT, W_BLADES, W_RING, W_LIGHTNING, W_RAIN, W_NOVA, FX_SLOW, FX_KNOCK,
} from './data.js';
import { gather } from './field.js';

export const A_RING = 1;
export const A_LIGHTNING = 2;
export const A_RAIN = 3;
export const A_NOVA = 4;
export const A_WAVE = 5;

// Kinds of effect events a page tells the others about (so their screens can draw the same things).
export const FXK_BOLT = 0;
export const FXK_RING = 1;
export const FXK_LIGHTNING = 2;
export const FXK_RAIN = 3;
export const FXK_NOVA = 4;
export const FXK_WAVE = 5;

const PROJ_CAP = 160;
const AREA_CAP = 96;
const HIT_CAP = 1536;
const FX_CAP = 96;
const CRIT_CHANCE = 0.1;

export class HitBuf {
  constructor() {
    this.n = 0;
    this.slot = new Int32Array(HIT_CAP);
    this.amt = new Float32Array(HIT_CAP);
    this.fx = new Uint8Array(HIT_CAP);
    this.crit = new Uint8Array(HIT_CAP);
  }
  push(slot, amt, fx, crit) {
    const i = this.n;
    if (i >= HIT_CAP) return;
    this.slot[i] = slot;
    this.amt[i] = amt;
    this.fx[i] = fx;
    this.crit[i] = crit;
    this.n = i + 1;
  }
}

export class FxOut {
  constructor() {
    this.n = 0;
    this.kind = new Uint8Array(FX_CAP);
    this.x = new Float32Array(FX_CAP);
    this.y = new Float32Array(FX_CAP);
    this.a = new Float32Array(FX_CAP);
    this.b = new Float32Array(FX_CAP);
  }
  push(kind, x, y, a, b) {
    const i = this.n;
    if (i >= FX_CAP) return;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.a[i] = a;
    this.b[i] = b;
    this.n = i + 1;
  }
}

/** Where blade j of n is, around (cx, cy), at angle `ang` and distance `radius`. Writes into out[0], out[1]. */
export function bladePos(j, n, ang, radius, cx, cy, out) {
  const a = ang + (j / n) * Math.PI * 2;
  out[0] = cx + Math.cos(a) * radius;
  out[1] = cy + Math.sin(a) * radius;
}

export function easeOut(p) {
  const q = 1 - (p < 0 ? 0 : p > 1 ? 1 : p);
  return 1 - q * q * q;
}

export class Fighter {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.time = 0;
    this.bladeAng = 0;
    this.hits = new HitBuf();
    this.fx = new FxOut();
    // projectiles
    this.pn = 0;
    this.px = new Float32Array(PROJ_CAP);
    this.py = new Float32Array(PROJ_CAP);
    this.pvx = new Float32Array(PROJ_CAP);
    this.pvy = new Float32Array(PROJ_CAP);
    this.plife = new Float32Array(PROJ_CAP);
    this.page = new Float32Array(PROJ_CAP);
    this.pdmg = new Float32Array(PROJ_CAP);
    this.ppierce = new Int8Array(PROJ_CAP);
    this.pcos = new Uint8Array(PROJ_CAP);
    this.ph0 = new Int32Array(PROJ_CAP);
    this.ph1 = new Int32Array(PROJ_CAP);
    // areas: ring pulses, lightning strikes, rain zones, novas
    this.an = 0;
    this.akind = new Uint8Array(AREA_CAP);
    this.ax = new Float32Array(AREA_CAP);
    this.ay = new Float32Array(AREA_CAP);
    this.ar = new Float32Array(AREA_CAP);
    this.aprev = new Float32Array(AREA_CAP);
    this.aage = new Float32Array(AREA_CAP);
    this.adur = new Float32Array(AREA_CAP);
    this.admg = new Float32Array(AREA_CAP);
    this.atick = new Float32Array(AREA_CAP);
    this.aseed = new Float32Array(AREA_CAP);
    this.acos = new Uint8Array(AREA_CAP);
    this.afollow = new Uint8Array(AREA_CAP);
    this.afx = new Uint8Array(AREA_CAP);
    this.stamp = new Float32Array(ID_MASK + 1).fill(-10); // blades: when a monster was last cut
    this.buf = new Int32Array(MAX_MON + 16);
    this.near = new Int32Array(MAX_MON + 16);
    this.buf2 = new Int32Array(MAX_MON + 16); // scratch for a gather nested inside a walk over `buf`
    this.bestS = new Int32Array(8);
    this.bestD = new Float32Array(8);
    this.pos = new Float32Array(2);
    this.pick = new Int32Array(8);
  }

  reset() {
    this.pn = 0;
    this.an = 0;
    this.hits.n = 0;
    this.fx.n = 0;
    this.time = 0;
    this.stamp.fill(-10);
  }

  // ---------------------------------------------------------------- spawning visuals and shots
  addProjectile(x, y, vx, vy, life, dmg, pierce, cos) {
    if (this.pn >= PROJ_CAP) return;
    const i = this.pn++;
    this.px[i] = x;
    this.py[i] = y;
    this.pvx[i] = vx;
    this.pvy[i] = vy;
    this.plife[i] = life;
    this.page[i] = 0;
    this.pdmg[i] = dmg;
    this.ppierce[i] = pierce;
    this.pcos[i] = cos ? 1 : 0;
    this.ph0[i] = -1;
    this.ph1[i] = -1;
  }

  addArea(kind, x, y, r, dur, dmg, cos, follow, fx) {
    if (this.an >= AREA_CAP) return -1;
    const i = this.an++;
    this.akind[i] = kind;
    this.ax[i] = x;
    this.ay[i] = y;
    this.ar[i] = r;
    this.aprev[i] = -1;
    this.aage[i] = 0;
    this.adur[i] = dur;
    this.admg[i] = dmg;
    this.atick[i] = 0.05;
    this.aseed[i] = this.rng();
    this.acos[i] = cos ? 1 : 0;
    this.afollow[i] = follow ? 1 : 0;
    this.afx[i] = fx;
    return i;
  }

  /** Draws what another player's page says it did (no damage: their page decides that). */
  spawnCosmetic(kind, x, y, a, b) {
    if (!(x === x && y === y && a === a && b === b)) return;
    const rr = x * x + y * y;
    if (rr > (ARENA_R + 20) * (ARENA_R + 20)) return;
    switch (kind) {
      case FXK_BOLT:
        this.addProjectile(x, y, Math.cos(a) * BOLT.speed, Math.sin(a) * BOLT.speed, 0.55, 0, 0, true);
        break;
      case FXK_RING:
        this.addArea(A_RING, x, y, Math.min(8, Math.max(1, a)), RING.dur, 0, true, false, 0);
        break;
      case FXK_LIGHTNING:
        this.addArea(A_LIGHTNING, x, y, 1, LIGHTNING.dur, 0, true, false, 0);
        break;
      case FXK_RAIN:
        this.addArea(A_RAIN, x, y, Math.min(5, Math.max(1, a)), RAIN.dur, 0, true, false, 0);
        break;
      case FXK_NOVA:
        this.addArea(A_NOVA, x, y, Math.min(9, Math.max(1, a)), NOVA.dur, 0, true, false, 0);
        break;
      case FXK_WAVE:
        this.addArea(A_WAVE, x, y, Math.min(8, Math.max(1, a)), 0.5, 0, true, false, 0);
        break;
      default:
        break;
    }
  }

  hit(h, slot, base, fx, canCrit) {
    let amt = base * h.dmgMul;
    let crit = 0;
    if (canCrit && this.rng() < CRIT_CHANCE) {
      amt *= 2;
      crit = 1;
    }
    this.hits.push(slot, amt, fx, crit);
  }

  // ---------------------------------------------------------------- the step
  /** Fires and flies one step. Everything hit goes into this.hits (slots into `mon`); effects for the others into this.fx. */
  update(dt, h, mon, hash) {
    this.time += dt;
    this.hits.n = 0;
    if (!h.down) this.fire(dt, h, mon, hash);
    this.flyProjectiles(dt, h, mon, hash);
    this.updateAreas(dt, h, mon, hash);
  }

  fire(dt, h, mon, hash) {
    const cd = h.cd;
    // Magic Bolt
    let lv = h.wl[W_BOLT];
    if (lv > 0) {
      cd[W_BOLT] -= dt;
      if (cd[W_BOLT] <= 0) {
        if (this.fireBolts(h, mon, hash, lv)) cd[W_BOLT] = BOLT.cd[lv - 1] * h.cdMul;
        else cd[W_BOLT] = 0;
      }
    }
    lv = h.wl[W_BLADES];
    if (lv > 0) this.spinBlades(dt, h, mon, hash, lv);
    lv = h.wl[W_RING];
    if (lv > 0) {
      cd[W_RING] -= dt;
      if (cd[W_RING] <= 0) {
        const r = RING.radius[lv - 1];
        if (gather(mon, hash, h.x, h.y, r, this.near, this.buf) > 0) {
          this.addArea(A_RING, h.x, h.y, r, RING.dur, RING.dmg[lv - 1], false, true, FX_KNOCK);
          this.fx.push(FXK_RING, h.x, h.y, r, 0);
          cd[W_RING] = RING.cd[lv - 1] * h.cdMul;
        } else cd[W_RING] = 0;
      }
    }
    lv = h.wl[W_LIGHTNING];
    if (lv > 0) {
      cd[W_LIGHTNING] -= dt;
      if (cd[W_LIGHTNING] <= 0) {
        if (this.strikeLightning(h, mon, hash, lv)) cd[W_LIGHTNING] = LIGHTNING.cd[lv - 1] * h.cdMul;
        else cd[W_LIGHTNING] = 0;
      }
    }
    lv = h.wl[W_RAIN];
    if (lv > 0) {
      cd[W_RAIN] -= dt;
      if (cd[W_RAIN] <= 0) {
        if (this.rainArrows(h, mon, hash, lv)) cd[W_RAIN] = RAIN.cd[lv - 1] * h.cdMul;
        else cd[W_RAIN] = 0;
      }
    }
    lv = h.wl[W_NOVA];
    if (lv > 0) {
      cd[W_NOVA] -= dt;
      if (cd[W_NOVA] <= 0) {
        const r = NOVA.radius[lv - 1];
        if (gather(mon, hash, h.x, h.y, r * 0.8, this.near, this.buf) > 0) {
          const fx = FX_SLOW | (Math.round(NOVA.slow[lv - 1] * 8) << 2);
          this.addArea(A_NOVA, h.x, h.y, r, NOVA.dur, NOVA.dmg[lv - 1], false, true, fx);
          this.fx.push(FXK_NOVA, h.x, h.y, r, 0);
          cd[W_NOVA] = NOVA.cd[lv - 1] * h.cdMul;
        } else cd[W_NOVA] = 0;
      }
    }
    if (h.waveReq) {
      h.waveReq = false;
      this.addArea(A_WAVE, h.x, h.y, SHIELD.waveR, 0.5, SHIELD.waveDmg, false, true, FX_KNOCK);
      this.fx.push(FXK_WAVE, h.x, h.y, SHIELD.waveR, 0);
    }
  }

  /** The k monsters nearest (x, y) within range, into bestS (slots). Returns how many were found (at most k). */
  nearest(mon, hash, x, y, range, k) {
    const bs = this.bestS;
    const bd = this.bestD;
    let found = 0;
    const cnt = hash.collect(x, y, range, this.buf);
    const r2 = range * range;
    for (let j = 0; j <= cnt; j++) {
      // the extra pass handles the boss (it isn't in the hash)
      const s = j < cnt ? this.buf[j] : mon.boss;
      if (s < 0 || mon.dead[s] === 1) continue;
      const dx = mon.x[s] - x;
      const dy = mon.y[s] - y;
      const d = dx * dx + dy * dy;
      if (d > r2) continue;
      // insert into the sorted short list
      let p = found < k ? found : k;
      if (found === k && d >= bd[k - 1]) continue;
      if (found < k) found++;
      while (p > 0 && bd[p - 1] > d) {
        if (p < k) {
          bs[p] = bs[p - 1];
          bd[p] = bd[p - 1];
        }
        p--;
      }
      if (p < k) {
        bs[p] = s;
        bd[p] = d;
      }
    }
    return found;
  }

  fireBolts(h, mon, hash, lv) {
    const count = BOLT.count[lv - 1];
    const k = this.nearest(mon, hash, h.x, h.y, BOLT.range, Math.min(count, 4));
    if (k === 0) return false;
    const dmg = BOLT.dmg[lv - 1];
    const pierce = BOLT.pierce[lv - 1];
    for (let j = 0; j < count; j++) {
      const s = this.bestS[j % k];
      const dx = mon.x[s] - h.x;
      const dy = mon.y[s] - h.y;
      let a = Math.atan2(dy, dx);
      if (count > k) a += (j - (count - 1) / 2) * 0.15;
      const vx = Math.cos(a) * BOLT.speed;
      const vy = Math.sin(a) * BOLT.speed;
      this.addProjectile(h.x + Math.cos(a) * 0.5, h.y + Math.sin(a) * 0.5, vx, vy, BOLT.life, dmg, pierce, false);
      this.fx.push(FXK_BOLT, h.x, h.y, a, 0);
    }
    return true;
  }

  spinBlades(dt, h, mon, hash, lv) {
    const n = BLADES.count[lv - 1];
    const radius = BLADES.radius[lv - 1];
    this.bladeAng += BLADES.speed[lv - 1] * dt;
    const dmg = BLADES.dmg[lv - 1];
    const pos = this.pos;
    for (let j = 0; j < n; j++) {
      bladePos(j, n, this.bladeAng, radius, h.x, h.y, pos);
      const k = gather(mon, hash, pos[0], pos[1], BLADES.hitR, this.near, this.buf);
      for (let q = 0; q < k; q++) {
        const s = this.near[q];
        const id = mon.id[s] & ID_MASK;
        if (this.time - this.stamp[id] < BLADES.every) continue;
        this.stamp[id] = this.time;
        this.hit(h, s, dmg, 0, false);
      }
    }
  }

  strikeLightning(h, mon, hash, lv) {
    const count = LIGHTNING.count[lv - 1];
    const cnt = hash.collect(h.x, h.y, LIGHTNING.range, this.buf);
    if (cnt === 0 && mon.boss < 0) return false;
    const r2 = LIGHTNING.range * LIGHTNING.range;
    let struck = 0;
    for (let c = 0; c < count; c++) {
      let target = -1;
      for (let tries = 0; tries < 10 && target < 0; tries++) {
        const s = cnt > 0 && (tries < 8 || mon.boss < 0) ? this.buf[Math.floor(this.rng() * cnt)] : mon.boss;
        if (s < 0 || mon.dead[s] === 1) continue;
        const dx = mon.x[s] - h.x;
        const dy = mon.y[s] - h.y;
        if (dx * dx + dy * dy > r2) continue;
        let dup = false;
        for (let q = 0; q < struck; q++) if (this.pick[q] === s) dup = true;
        if (!dup) target = s;
      }
      if (target < 0) continue;
      this.pick[struck++] = target;
      const tx = mon.x[target];
      const ty = mon.y[target];
      const dmg = LIGHTNING.dmg[lv - 1];
      this.hit(h, target, dmg, 0, true);
      const k = gather(mon, hash, tx, ty, LIGHTNING.splash, this.near, this.buf2);
      for (let q = 0; q < k; q++) {
        const s = this.near[q];
        if (s !== target) this.hit(h, s, dmg * 0.55, 0, false);
      }
      this.addArea(A_LIGHTNING, tx, ty, LIGHTNING.splash, LIGHTNING.dur, 0, false, false, 0);
      this.fx.push(FXK_LIGHTNING, tx, ty, 0, 0);
    }
    return struck > 0;
  }

  rainArrows(h, mon, hash, lv) {
    const zones = RAIN.zones[lv - 1];
    const cnt = hash.collect(h.x, h.y, RAIN.range, this.buf);
    if (cnt === 0) return false;
    const r2 = RAIN.range * RAIN.range;
    const radius = RAIN.radius[lv - 1];
    let made = 0;
    for (let z = 0; z < zones; z++) {
      for (let tries = 0; tries < 8; tries++) {
        const s = this.buf[Math.floor(this.rng() * cnt)];
        if (mon.dead[s] === 1) continue;
        const dx = mon.x[s] - h.x;
        const dy = mon.y[s] - h.y;
        if (dx * dx + dy * dy > r2) continue;
        this.addArea(A_RAIN, mon.x[s], mon.y[s], radius, RAIN.dur, RAIN.dmg[lv - 1], false, false, 0);
        this.fx.push(FXK_RAIN, mon.x[s], mon.y[s], radius, 0);
        made++;
        break;
      }
    }
    return made > 0;
  }

  flyProjectiles(dt, h, mon, hash) {
    let i = 0;
    while (i < this.pn) {
      this.page[i] += dt;
      this.plife[i] -= dt;
      this.px[i] += this.pvx[i] * dt;
      this.py[i] += this.pvy[i] * dt;
      let remove = this.plife[i] <= 0;
      if (!remove && this.pcos[i] === 0) {
        const k = gather(mon, hash, this.px[i], this.py[i], 0.28, this.near, this.buf);
        for (let q = 0; q < k && !remove; q++) {
          const s = this.near[q];
          const id = mon.id[s];
          if (id === this.ph0[i] || id === this.ph1[i]) continue;
          this.hit(h, s, this.pdmg[i], 0, true);
          this.ph1[i] = this.ph0[i];
          this.ph0[i] = id;
          if (--this.ppierce[i] < 0) remove = true;
        }
      }
      if (!remove) {
        const r2 = this.px[i] * this.px[i] + this.py[i] * this.py[i];
        if (!(r2 < (ARENA_R + 14) * (ARENA_R + 14))) remove = true;
      }
      if (remove) this.removeProjectile(i);
      else i++;
    }
  }

  removeProjectile(i) {
    const last = --this.pn;
    if (i === last) return;
    this.px[i] = this.px[last];
    this.py[i] = this.py[last];
    this.pvx[i] = this.pvx[last];
    this.pvy[i] = this.pvy[last];
    this.plife[i] = this.plife[last];
    this.page[i] = this.page[last];
    this.pdmg[i] = this.pdmg[last];
    this.ppierce[i] = this.ppierce[last];
    this.pcos[i] = this.pcos[last];
    this.ph0[i] = this.ph0[last];
    this.ph1[i] = this.ph1[last];
  }

  updateAreas(dt, h, mon, hash) {
    let i = 0;
    while (i < this.an) {
      this.aage[i] += dt;
      if (this.afollow[i] === 1 && this.acos[i] === 0) {
        this.ax[i] = h.x;
        this.ay[i] = h.y;
      }
      const dur = this.adur[i];
      const p = dur > 0 ? Math.min(1, this.aage[i] / dur) : 1;
      if (this.acos[i] === 0) {
        const kind = this.akind[i];
        if (kind === A_RING || kind === A_NOVA || kind === A_WAVE) {
          const rNow = this.ar[i] * easeOut(p);
          const prev = this.aprev[i];
          const k = gather(mon, hash, this.ax[i], this.ay[i], rNow, this.near, this.buf);
          for (let q = 0; q < k; q++) {
            const s = this.near[q];
            const dx = mon.x[s] - this.ax[i];
            const dy = mon.y[s] - this.ay[i];
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < prev + MON_R[mon.type[s]]) continue; // the wave passed this one already
            this.hit(h, s, this.admg[i], this.afx[i], kind !== A_WAVE);
          }
          this.aprev[i] = rNow;
        } else if (kind === A_RAIN) {
          this.atick[i] -= dt;
          while (this.atick[i] <= 0) {
            this.atick[i] += RAIN.tick;
            const k = gather(mon, hash, this.ax[i], this.ay[i], this.ar[i], this.near, this.buf);
            for (let q = 0; q < k; q++) this.hit(h, this.near[q], this.admg[i], 0, false);
          }
        }
      }
      if (this.aage[i] >= dur) this.removeArea(i);
      else i++;
    }
  }

  removeArea(i) {
    const last = --this.an;
    if (i === last) return;
    this.akind[i] = this.akind[last];
    this.ax[i] = this.ax[last];
    this.ay[i] = this.ay[last];
    this.ar[i] = this.ar[last];
    this.aprev[i] = this.aprev[last];
    this.aage[i] = this.aage[last];
    this.adur[i] = this.adur[last];
    this.admg[i] = this.admg[last];
    this.atick[i] = this.atick[last];
    this.aseed[i] = this.aseed[last];
    this.acos[i] = this.acos[last];
    this.afollow[i] = this.afollow[last];
    this.afx[i] = this.afx[last];
  }
}
