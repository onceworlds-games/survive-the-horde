// One night on this page, and the camp before it. A Run is whichever part this page plays: the host's page runs the
// world and its own hero; everyone else plays its own hero against a smooth copy of the host's pictures; a page that
// came late only watches. Nothing here touches the DOM: it talks to the room, the effects and the sound it is given.
import {
  STEP, ID_MASK, MAX_HEROES, N_WEAPONS, N_PASSIVES, GEM_XP, HERO_COLORS, HERO_COLORS_DARK, BLADES, W_BLADES, W_BOLT,
  nightLength, modeOf, MAX_WEAPONS, MAX_PASSIVES, T_BOSS, T_DUMMY,
} from './data.js';
import { Monsters, SpatialHash } from './field.js';
import { monsterMaxHp, EV_KILL, EV_CRUMBLE, EV_BOSS } from './sim.js';
import { Game } from './game.js';
import { Fighter, FXK_BOLT, FXK_RING, FXK_LIGHTNING, FXK_RAIN, FXK_NOVA, FXK_WAVE } from './combat.js';
import {
  HeroState, heroStep, heroContact, gemsInReach, addXp, tickOffer, pickOffer, EV_HURT, EV_SHIELD, EV_DIED, EV_LEVEL, EV_REVIVED,
} from './hero.js';
import { encodeMonsters, encodeGems, Snap, GemSnap, Interp } from './snapshot.js';
import {
  MSG_DMG, MSG_GEMS, HitBatch, applyHits, applyGemClaims, packFx, unpackFx, packPresence, readPresence, snapshotMeta, validMeta,
} from './net.js';
import { mulberry32, hashStr } from './rng.js';

const MON_FLASH = 0.1;

/**
 * Turns what happened in a world during the last steps (kills, crumbling, the boss) into effects and sounds, then
 * clears it. `budget.n` caps how many bursts one frame may draw.
 */
export function drainEvents(w, fx, sound, budget) {
  for (let i = 0; i < w.evN; i++) {
    const kind = w.evKind[i];
    if (kind === EV_KILL) {
      if (budget.n > 0) {
        budget.n--;
        fx.death(w.evX[i], w.evY[i], w.evType[i], w.evElite[i] === 1);
      }
      sound?.kill();
    } else if (kind === EV_CRUMBLE) {
      if (budget.n > 0) {
        budget.n--;
        fx.crumble(w.evX[i], w.evY[i], w.evType[i]);
      }
    } else if (kind === EV_BOSS) {
      fx.bossDeath(w.evX[i], w.evY[i]);
      sound?.bigKill();
    }
  }
  w.clearEvents();
}
const SNAP_COOP_EVERY = 1 / 12;
const SNAP_SOLO_EVERY = 1;
const GEM_COOP_EVERY = 0.25;
const GEM_SOLO_EVERY = 2;
const NET_EVERY = 0.1;
const SAVE_EVERY = 6;
const PRESENCE_EVERY = 0.05;
const RESULT_SECS = 9;

/** How another player (or I) look on this screen. */
export class RHero {
  constructor(id, seat, colour = seat) {
    this.id = id;
    this.idx = seat;
    this.name = '';
    this.color = HERO_COLORS[colour % HERO_COLORS.length];
    this.dark = HERO_COLORS_DARK[colour % HERO_COLORS_DARK.length];
    this.x = 0;
    this.y = 0;
    this.dx = 1;
    this.dy = 0;
    this.moving = false;
    this.walk = 0;
    this.hp = 100;
    this.maxHp = 100;
    this.down = false;
    this.rv = 0;
    this.shield = false;
    this.invuln = 0;
    this.level = 1;
    this.wl = new Int8Array(N_WEAPONS);
    this.bladeAng = 0;
    this.side = 1;
    this.isMe = false;
    this.ready = false;
    this.away = false;
    this.avatar = null;
    this.phase = '';
    this.present = false;
    this.art = { color: '', dark: '', dx: 1, dy: 0, walk: 0, side: 1, moving: false, ghost: false, t: 0 };
    this.reviveT = 0;
  }

  /** Copies what this page knows about its own hero. */
  fromState(h, fighter) {
    this.x = h.x;
    this.y = h.y;
    this.dx = h.dx;
    this.dy = h.dy;
    this.moving = h.moving;
    this.walk = h.walk;
    this.hp = h.hp;
    this.maxHp = h.maxHp;
    this.down = h.down;
    this.rv = Math.min(1, h.reviveT / 3);
    this.shield = h.shieldReady;
    this.invuln = h.invuln;
    this.level = h.level;
    for (let i = 0; i < N_WEAPONS; i++) this.wl[i] = h.wl[i];
    if (fighter) this.bladeAng = fighter.bladeAng;
    this.present = true;
    if (Math.abs(h.dx) > 0.3) this.side = h.dx > 0 ? 1 : -1;
  }

  /** Advances the visual-only clocks of someone else's hero. */
  tick(dt) {
    if (this.moving) this.walk += dt * 7.6;
    const lv = this.wl[W_BLADES];
    if (lv > 0) this.bladeAng += BLADES.speed[lv - 1] * dt;
    if (Math.abs(this.dx) > 0.3) this.side = this.dx > 0 ? 1 : -1;
  }
}

/** Reads presence for everyone but me into `rh`. Returns true if there was any. */
function readOther(room, rh, dt) {
  const player = room.players.get(rh.id);
  if (!player) {
    rh.present = false;
    return false;
  }
  rh.name = player.name || rh.name || 'Player';
  rh.away = player.connected === false;
  rh.ready = player.ready === true;
  const p = room.presenceAt(rh.id, { angles: ['f'], snap: 12 });
  if (!readPresence(p, rh)) {
    rh.present = false;
    return false;
  }
  rh.present = true;
  rh.tick(dt);
  return true;
}

// =====================================================================================================================
export class Camp {
  /** The clearing before a night: walk around, try your weapon on the dummies, see who is here. */
  constructor(env) {
    this.env = env;
    this.room = env.room;
    this.rng = mulberry32((Math.random() * 2 ** 32) >>> 0);
    this.game = new Game({ seed: (Math.random() * 2 ** 32) >>> 0, camp: true, ids: [env.room.me.id], seats: [0], solo: true });
    const g = this.game;
    g.hero(env.room.me.id).x = 0;
    g.hero(env.room.me.id).y = 3;
    for (const [x, y] of [[-7, -2], [6.5, -3.5], [-5, 5.5], [8, 3.5], [0.5, -7]]) g.world.addDummy(x, y);
    this.me = g.heroes[0];
    this.me.godmode = true;
    this.fighter = g.fighters[0];
    this.cos = new Fighter(this.rng);
    this.cosHero = new HeroState('cos', 0, this.rng);
    this.cosHero.down = true;
    this.rh = new Map();
    this.meR = new RHero(this.room.me.id, 0);
    this.meR.isMe = true;
    this.list = [];
    this.flashUntil = new Float32Array(ID_MASK + 1);
    this.acc = 0;
    this.camX = 0;
    this.camY = 2;
    this.netT = 0;
    this.presT = 0;
    g.hooks.hit = (h, slot, amt, crit) => this.onHit(slot, amt, crit);
    this.anim = 0;
    this.hitBudget = 0;
    this.off = [this.room.on('message', (d) => this.message(d))];
  }

  dispose() {
    for (const off of this.off) off();
    this.off = [];
  }

  onHit(slot, amt, crit) {
    const m = this.game.world.mon;
    const id = m.id[slot] & ID_MASK;
    this.flashUntil[id] = this.anim + MON_FLASH;
    if (this.hitBudget > 0) {
      this.hitBudget--;
      this.env.fx.hit(m.x[slot], m.y[slot], amt, crit, false);
      this.env.sound?.hit(crit);
    }
  }

  seatOf(id) {
    // seats in the camp are by order of arrival; only the colour depends on it
    const ids = [...this.room.players.keys()].sort();
    return Math.max(0, ids.indexOf(id));
  }

  frame(dt, input, anim) {
    this.anim = anim;
    const g = this.game;
    const w = g.world;
    this.hitBudget = 8;
    g.move[0].x = input.x;
    g.move[0].y = input.y;
    this.acc += dt;
    let steps = 0;
    const room = this.room;
    while (this.acc >= STEP && steps < 5) {
      this.acc -= STEP;
      steps++;
      g.step(STEP);
    }
    if (this.acc > STEP * 6) this.acc = 0;
    w.clearEvents();
    // my sounds and the others' view of my weapon
    const f = this.fighter;
    for (let i = 0; i < f.fx.n; i++) if (f.fx.kind[i] === FXK_BOLT) this.env.sound?.shoot();
    this.netT += dt;
    this.presT += dt;
    this.cos.update(dt, this.cosHero, w.mon, w.hash);
    // others
    this.list.length = 0;
    this.meR.fromState(this.me, f);
    this.meR.isMe = true;
    this.meR.name = room.me.name;
    this.meR.color = HERO_COLORS[this.seatOf(room.me.id) % 4];
    this.meR.dark = HERO_COLORS_DARK[this.seatOf(room.me.id) % 4];
    this.meR.ready = room.me.ready === true;
    this.meR.avatar = this.env.avatar(room.me.id);
    this.meR.idx = this.seatOf(room.me.id);
    this.list.push(this.meR);
    for (const id of room.players.keys()) {
      if (id === room.me.id) continue;
      let rh = this.rh.get(id);
      if (!rh) {
        rh = new RHero(id, this.seatOf(id));
        this.rh.set(id, rh);
      }
      rh.idx = this.seatOf(id);
      rh.color = HERO_COLORS[rh.idx % 4];
      rh.dark = HERO_COLORS_DARK[rh.idx % 4];
      rh.avatar = this.env.avatar(id);
      if (readOther(room, rh, dt) && rh.phase !== 'p') {
        // someone in the lobby (or looking at results): they stand in the camp
        this.list.push(rh);
      }
    }
    for (const id of [...this.rh.keys()]) if (!room.players.has(id)) this.rh.delete(id);
    // tell the others about my weapon, and where I am
    if (this.presT >= PRESENCE_EVERY) {
      this.presT = 0;
      room.setPresence(packPresence(this.me, 'l'));
    }
    if (this.netT >= NET_EVERY) {
      this.netT = 0;
      if (f.fx.n > 0 && room.players.size > 1) room.send({ t: MSG_DMG, rid: 'camp', f: packFx(f.fx) });
      else f.fx.n = 0;
    }
    if (f.fx.n > 40) f.fx.n = 0;
    this.camX += (this.me.x * 0.35 - this.camX) * Math.min(1, dt * 4);
    this.camY += (this.me.y * 0.35 + 1 - this.camY) * Math.min(1, dt * 4);
  }

  /** A message from another page while we are in the camp: only effects matter here. */
  message(d) {
    if (!d || d.t !== MSG_DMG || d.rid !== 'camp') return;
    unpackFx(d.f, this.cos);
  }
}

// =====================================================================================================================
/** The title screen's night: an autopilot hero fighting a horde, over and over. */
export class Demo {
  constructor(env) {
    this.env = env;
    this.rh = new RHero('demo', 0);
    this.rh.name = '';
    this.list = [this.rh];
    this.flashUntil = new Float32Array(ID_MASK + 1);
    this.budget = { n: 0 };
    this.acc = 0;
    this.anim = 0;
    this.camX = 0;
    this.camY = 0;
    this.hitBudget = 0;
    this.restartAt = -1;
    this.scene = {
      quality: 'high', camX: 0, camY: 0, anim: 0, t: 0, mon: null, gem: null, hiddenGem: null, heroes: this.list, nHeroes: 1, fighters: [],
      fx: env.fx, flashUntil: this.flashUntil, focusX: 0, darkness: 0.9, dawn: 0, crumble: 0, youArrow: 0, noBars: true, noNames: true,
    };
    this.reset();
  }

  reset() {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const g = new Game({ seed, length: 300, ids: ['demo'], ai: true, solo: true });
    const h = g.heroes[0];
    h.wl[1] = 2;
    h.wl[2] = 2;
    h.nW = 3;
    h.level = 5;
    g.world.T = 55;
    g.world.waveIdx = 1;
    g.run(16); // so the screen is full of monsters from the first frame
    g.hooks.hit = (hero, slot, amt, crit) => {
      const m = g.world.mon;
      this.flashUntil[m.id[slot] & ID_MASK] = this.anim + MON_FLASH;
      if (this.hitBudget > 0) {
        this.hitBudget--;
        this.env.fx.hit(m.x[slot], m.y[slot], amt, crit, false);
      }
    };
    g.hooks.gem = (hero, x, y, tier) => {
      this.env.fx.pickup(x, y, tier);
      this.env.fx.flyGem(x, y, tier, 0);
    };
    this.game = g;
    this.rh.x = h.x;
    this.rh.y = h.y;
    this.camX = h.x;
    this.camY = h.y;
    this.restartAt = -1;
    this.scene.mon = g.world.mon;
    this.scene.gem = g.world.gem;
    this.scene.fighters.length = 0;
    this.scene.fighters.push(g.fighters[0]);
  }

  frame(dt, anim) {
    this.anim = anim;
    const g = this.game;
    const h = g.heroes[0];
    this.hitBudget = 6;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.acc -= STEP;
      steps++;
      g.step(STEP);
    }
    if (this.acc > STEP * 8) this.acc = 0;
    this.budget.n = 6;
    drainEvents(g.world, this.env.fx, null, this.budget);
    h.takeEvents();
    g.fighters[0].fx.n = 0;
    if ((g.over || g.world.T > 290) && this.restartAt < 0) this.restartAt = anim + (g.over === 'defeat' ? 1.2 : 0.4);
    if (this.restartAt >= 0 && anim >= this.restartAt) this.reset();
    this.rh.fromState(h, g.fighters[0]);
    this.rh.isMe = false;
    const sc = this.scene;
    // a slow drift beside the hero keeps the picture alive
    this.camX += (h.x + Math.sin(anim * 0.31) * 2.2 - this.camX) * Math.min(1, dt * 2.2);
    this.camY += (h.y + Math.cos(anim * 0.27) * 1.4 - this.camY) * Math.min(1, dt * 2.2);
    sc.camX = this.camX + this.env.fx.shake.x;
    sc.camY = this.camY + this.env.fx.shake.y;
    sc.anim = anim;
    sc.t = g.world.T;
    sc.focusX = h.x;
    sc.mon = g.world.mon;
    sc.gem = g.world.gem;
  }
}

// =====================================================================================================================
export class Run {
  /**
   * @param {{ room: any, fx: any, sound: any, avatar: (id: string) => any, callout: (text: string, color?: string, size?: number) => void,
   *           badge: (id: string) => void, save: (key: string, value: any) => void, saved: any, now: () => number }} env
   */
  constructor(env) {
    this.env = env;
    const room = (this.room = env.room);
    const match = room.match;
    this.mid = match.id;
    this.rid = `${match.id}.1`;
    this.roster = (match.participants || []).slice(0, MAX_HEROES);
    this.meId = room.me.id;
    this.seat = this.roster.indexOf(this.meId);
    this.watch = this.seat < 0;
    this.length = nightLength(room.settings.length);
    this.hard = room.settings.hero === 'hard';
    this.mode = modeOf(this.hard ? 'hard' : 'normal');
    this.solo = this.roster.length === 1;
    this.rng = mulberry32((hashStr(String(match.id)) ^ (match.seed | 0)) >>> 0);
    this.me = null;
    this.fighter = null;
    this.game = null;
    if (!this.watch) {
      this.me = new HeroState(this.meId, this.seat, this.rng);
      this.fighter = new Fighter(this.rng);
      this.restoreHero(env.saved);
    }
    this.cos = new Fighter(this.rng);
    this.cosHero = new HeroState('cos', 0, this.rng);
    this.cosHero.down = true;
    this.interp = new Interp();
    this.view = new Monsters();
    this.vhash = new SpatialHash();
    this.gemSnap = new GemSnap();
    this.hiddenGem = new Uint8Array(ID_MASK + 1);
    this.flashUntil = new Float32Array(ID_MASK + 1);
    this.batch = new HitBatch();
    this.claims = [];
    // colours go by sorted ids, the same as in the camp, so a hero keeps its colour from the lobby into the night
    const sorted = [...this.roster].sort();
    this.rh = this.roster.map((id, seat) => new RHero(id, seat, sorted.indexOf(id)));
    for (const r of this.rh) {
      r.isMe = r.id === this.meId;
      r.avatar = env.avatar(r.id);
    }
    this.meR = this.seat >= 0 ? this.rh[this.seat] : null;
    this.list = [];
    this.acc = 0;
    this.anim = 0;
    this.mates = [];
    this.budget = { n: 0 };
    this.meta = null;
    this.T = 0; // night time as this page knows it
    this.kills = new Int32Array(MAX_HEROES);
    this.dir = { ring: 0, boss: 0, wave: 0 };
    this.dirSeen = false;
    this.camX = 0;
    this.camY = 0;
    this.watchSeat = 0;
    this.snapT = 0;
    this.gemT = 0;
    this.netT = 0;
    this.presT = 0;
    this.saveT = 0;
    this.overWritten = false;
    this.overSeenAt = -1;
    this.finished = false;
    this.endCalled = false;
    this.xpFlash = 0;
    this.youArrow = 3.2;
    this.pageT = 0;
    this.hitBudget = 0;
    this.deathBudget = 0;
    this.boss = { on: false, frac: 1 };
    this.callouts = { seenBoss: false };
    this.lastHp = 100;
    this.hostSince = -1;
    this.scene = {
      quality: 'high', camX: 0, camY: 0, anim: 0, t: 0, mon: this.view, gem: this.gemSnap, hiddenGem: this.hiddenGem, heroes: this.list,
      nHeroes: 0, fighters: [], fx: env.fx, flashUntil: this.flashUntil, focusX: 0, darkness: 1, dawn: 0, crumble: 0, youArrow: 0,
    };
    // restore the camera on my hero
    if (this.me) {
      const p = room.me.presence;
      // a reloaded page carries on from where it was in the night (not from the camp's last spot)
      if (p && p.ph === 'p' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        this.me.x = p.x;
        this.me.y = p.y;
      } else {
        const a = this.roster.length > 1 ? (this.seat / this.roster.length) * Math.PI * 2 : 0;
        this.me.x = this.roster.length > 1 ? Math.cos(a) * 1.4 : 0;
        this.me.y = this.roster.length > 1 ? Math.sin(a) * 1.4 : 0;
      }
      this.camX = this.me.x;
      this.camY = this.me.y;
    }
    // pictures the room already holds (a reload), and the ones still to come
    this.takeState('sm', room.state.sm);
    this.takeState('sg', room.state.sg);
    this.off = [
      room.on('state', (key, value) => {
        if (key === 'sm' || key === 'sg') this.takeState(key, value);
      }),
      room.on('message', (d, from) => this.message(d, from)),
    ];
  }

  /** Stops listening (the night is over for this page). */
  dispose() {
    for (const off of this.off) off();
    this.off = [];
  }

  // ---------------------------------------------------------------- hero checkpoint
  restoreHero(saved) {
    const h = this.me;
    if (!saved || saved.mid !== this.mid || !Array.isArray(saved.w) || !Array.isArray(saved.p)) return;
    let nW = 0;
    let nP = 0;
    for (let i = 0; i < N_WEAPONS; i++) {
      h.wl[i] = Math.max(0, Math.min(5, saved.w[i] | 0));
      if (h.wl[i] > 0) nW++;
    }
    for (let i = 0; i < N_PASSIVES; i++) {
      h.pl[i] = Math.max(0, Math.min(5, saved.p[i] | 0));
      if (h.pl[i] > 0) nP++;
    }
    if (nW === 0 || nW > MAX_WEAPONS || nP > MAX_PASSIVES) {
      h.wl.fill(0);
      h.wl[W_BOLT] = 1;
      h.pl.fill(0);
      return;
    }
    h.nW = nW;
    h.nP = nP;
    h.level = Math.max(1, Math.min(300, saved.lv | 0));
    h.xp = Math.max(0, Number(saved.xp) || 0);
    h.recompute();
    h.hp = Math.max(1, Math.min(h.maxHp, Number(saved.hp) || h.maxHp));
    h.kills = Math.max(0, saved.k | 0);
  }

  checkpoint() {
    const h = this.me;
    if (!h || this.finished) return;
    this.env.save('run', { mid: this.mid, lv: h.level, xp: Math.round(h.xp), w: Array.from(h.wl), p: Array.from(h.pl), hp: Math.round(h.hp), k: h.kills, t: Math.round(this.T) });
  }

  // ---------------------------------------------------------------- the record the host keeps
  get g() {
    const g = this.room.state.g;
    return g && typeof g === 'object' && g.mid === this.mid ? g : null;
  }

  writeG(patch) {
    const old = this.g ?? {};
    this.room.setState('g', { ...old, ...patch, mid: this.mid, by: this.meId });
  }

  // ---------------------------------------------------------------- roles
  /** Takes the world over: from the room's last pictures if there are any (a new host, a reload), else a fresh night. */
  becomeHost() {
    const room = this.room;
    const g = new Game({
      seed: (this.rng() * 2 ** 32) >>> 0, length: this.length, hard: this.hard, players: this.roster.length, ids: [this.meId], seats: [this.seat], solo: this.solo,
    });
    g.heroes[0] = this.me;
    g.fighters[0] = this.fighter;
    g.hooks.hit = (h, slot, amt, crit) => this.onLocalHit(g.world.mon, slot, amt, crit, true, 0);
    g.hooks.gem = (h, x, y, tier) => this.onGem(x, y, tier);
    const meta = room.state.sm;
    if (meta && meta.mid === this.mid && validMeta(meta) && typeof meta.m === 'string') {
      const ms = new Snap();
      const gs = new GemSnap();
      ms.load(meta.t, meta.m);
      const gm = room.state.sg;
      if (gm && gm.mid === this.mid) gs.load(gm.t, gm.g);
      g.world.restore(meta.t, ms, gs, { ring: meta.d[0], boss: meta.d[1], nid: meta.d[2], ngid: meta.d[3] });
      g.world.waveIdx = meta.d[4] | 0;
      for (let i = 0; i < MAX_HEROES; i++) {
        g.world.kills[i] = Math.max(0, meta.k[i] | 0);
        g.world.totalKills += g.world.kills[i];
      }
      this.me.kills = g.world.kills[this.seat];
    }
    this.game = g;
    this.T = g.world.T;
    this.interp.reset();
    const old = this.g;
    if (!old) this.writeG({ rid: this.rid, ph: 'run', roster: this.roster, len: this.length, hard: this.hard ? 1 : 0, res: null });
    else {
      this.writeG({});
      if (old.ph === 'over') this.overWritten = true;
    }
    this.hostSince = this.env.now();
    this.snapT = 1;
    this.gemT = 1;
  }

  dropHost() {
    this.game = null;
    this.interp.reset();
    this.hostSince = -1;
  }

  // ---------------------------------------------------------------- incoming
  takeState(key, v) {
    if (!v || typeof v !== 'object' || v.mid !== this.mid) return;
    if (this.game) return; // the host makes the pictures
    const now = this.env.now();
    if (key === 'sm') {
      if (!validMeta(v) || typeof v.m !== 'string') return;
      this.interp.push(v.t, v.m, now);
      this.meta = v;
      this.directorSeen(v.d[0], v.d[1], v.d[4]);
      for (let i = 0; i < MAX_HEROES; i++) this.kills[i] = Math.max(0, v.k[i] | 0);
    } else if (key === 'sg') {
      if (typeof v.g !== 'string' || !Number.isFinite(v.t)) return;
      this.gemSnap.load(v.t, v.g);
      for (let i = 0; i < this.gemSnap.goneN; i++) this.hiddenGem[this.gemSnap.gone[i] & ID_MASK] = 0;
    }
  }

  /** A message from another page. */
  message(d, from) {
    if (!d || typeof d !== 'object' || !from || from.id === this.meId) return;
    if (d.t === MSG_DMG) {
      if (d.rid !== this.rid) return;
      const seat = this.roster.indexOf(from.id);
      if (seat < 0) return;
      unpackFx(d.f, this.cos);
      if (this.game && d.h) {
        const w = this.game.world;
        applyHits(w, d.h, seat, (slot) => {
          this.flashUntil[w.mon.id[slot] & ID_MASK] = this.anim + MON_FLASH;
        });
      }
    } else if (d.t === MSG_GEMS) {
      if (d.rid !== this.rid || !this.game) return;
      if (this.roster.indexOf(from.id) < 0) return;
      applyGemClaims(this.game.world, d.ids);
    }
  }

  directorSeen(ring, boss, wave) {
    if (!this.dirSeen) {
      this.dirSeen = true;
      this.dir.ring = ring;
      this.dir.boss = boss;
      this.dir.wave = wave;
      return;
    }
    if (ring > this.dir.ring) {
      this.env.callout('SURROUNDED', '#ff6a5a', 56);
      this.env.sound?.warn();
      this.env.fx.shake.add(0.2);
    }
    if (wave > this.dir.wave) {
      this.env.sound?.wave();
      this.env.fx.redPulse = Math.max(this.env.fx.redPulse, 0.35);
    }
    if (boss !== this.dir.boss) {
      if (boss === 1) {
        this.env.callout('NIGHT WARDEN', '#ff4a3a', 64);
        this.env.sound?.boss();
        this.env.fx.shake.add(0.6);
      } else if (boss === 2) {
        this.env.callout('WARDEN SLAIN', '#ffd24a', 56);
        if (!this.watch) this.env.badge('boss-slayer');
      }
    }
    this.dir.ring = ring;
    this.dir.boss = boss;
    this.dir.wave = wave;
  }

  // ---------------------------------------------------------------- feedback shared by host and client hits
  onLocalHit(mon, slot, amt, crit, isHost, fxbits) {
    const id = mon.id[slot] & ID_MASK;
    this.flashUntil[id] = this.anim + MON_FLASH;
    const fx = this.env.fx;
    if (this.hitBudget > 0) {
      this.hitBudget--;
      fx.hit(mon.x[slot], mon.y[slot], amt, crit, amt >= 20 || crit);
    }
    this.env.sound?.hit(crit || amt >= 20);
    if (!isHost) {
      // tell the host (merged by monster), and don't wait for its picture to show the kill
      this.batch.add(id, amt, fxbits);
      this.interp.pred[id] += amt;
      const type = mon.type[slot];
      const est = mon.hpf[slot] * monsterMaxHp(type, mon.elite[slot] === 1, this.T, this.mode, this.roster.length);
      if (type !== T_BOSS && type !== T_DUMMY && this.interp.pred[id] >= est && !this.interp.hide[id]) {
        this.interp.hide[id] = 1;
        mon.dead[slot] = 1;
        if (this.deathBudget > 0) {
          this.deathBudget--;
          fx.death(mon.x[slot], mon.y[slot], type, mon.elite[slot] === 1);
        }
        this.env.sound?.kill();
      }
    }
  }

  onGem(x, y, tier) {
    const fx = this.env.fx;
    fx.pickup(x, y, tier);
    fx.flyGem(x, y, tier, Math.max(0, this.list.indexOf(this.meR)));
    this.env.sound?.gem(tier);
    this.xpFlash = 1;
  }

  /** Hero events (hurt, shield, level, ...) turned into effects and sounds. */
  heroEvents(hpBefore) {
    const h = this.me;
    const ev = h.takeEvents();
    if (ev === 0) return;
    const fx = this.env.fx;
    const snd = this.env.sound;
    if (ev & EV_HURT) {
      fx.hurt(h.x, h.y, Math.max(1, Math.round(hpBefore - h.hp)));
      snd?.hurt();
    }
    if (ev & EV_SHIELD) {
      fx.ringBurst(h.x, h.y, 2, 10);
      snd?.shield();
    }
    if (ev & EV_DIED) {
      fx.ringBurst(h.x, h.y, 3, 18);
      fx.flashAt(0.35, 11);
      fx.shake.add(0.6);
      snd?.down();
      if (this.solo) fx.hitStop = 0.1;
    }
    if (ev & EV_LEVEL) {
      fx.levelUp(h.x, h.y);
      snd?.levelUp();
      if (h.level >= 30) this.env.badge('level-30');
    }
    if (ev & EV_REVIVED) {
      fx.ringBurst(h.x, h.y, 3, 13);
      snd?.revive();
    }
  }

  /** Sounds for what my weapons just did, and what the others should be shown. */
  weaponCues() {
    const f = this.fighter;
    const snd = this.env.sound;
    for (let i = 0; i < f.fx.n; i++) {
      switch (f.fx.kind[i]) {
        case FXK_BOLT:
          snd?.shoot();
          break;
        case FXK_RING:
        case FXK_WAVE:
          snd?.ring();
          this.env.fx.shake.add(0.04);
          break;
        case FXK_LIGHTNING:
          snd?.zap();
          this.env.fx.shake.add(0.05);
          break;
        case FXK_RAIN:
          snd?.rain();
          break;
        case FXK_NOVA:
          snd?.nova();
          break;
        default:
          break;
      }
    }
  }

  // ---------------------------------------------------------------- the frame
  /** Advances this page by `dt` seconds of real time. `input` is { x, y } (the wish to move). */
  frame(dt, input, anim, paused) {
    const room = this.room;
    const fx = this.env.fx;
    this.anim = anim;
    this.pageT += dt;
    this.hitBudget = 10;
    this.deathBudget = 12;
    const playing = room.match.phase === 'playing' && room.match.id === this.mid;

    // which part am I playing?
    if (!this.watch) {
      const amHost = room.isHost && room.running;
      if (amHost && !this.game) this.becomeHost();
      else if (!room.isHost && this.game) this.dropHost();
    } else if (room.isHost) this.hostWatchDuty();

    const g = this.g;
    const over = g && g.ph === 'over';
    if (over && this.overSeenAt < 0) this.overSeenAt = this.pageT;

    const live = playing && room.running && !paused && !(this.solo && fx.hitStop > 0);
    if (!this.game) this.fillView();
    if (live && this.me) this.stepMine(dt, input);
    this.afterStep(dt);

    // checkpoints and the pictures
    this.saveT += dt;
    if (this.me && this.saveT >= SAVE_EVERY) {
      this.saveT = 0;
      this.checkpoint();
    }
    if (this.game) this.hostDuties(dt, live);
    else this.cos.update(dt, this.cosHero, this.view, this.vhash);
    this.netDuties(dt);
    this.finishDuties(over);
    this.buildScene(dt);
  }

  /** Steps my hero (and the world, if I'm the host) in fixed 60 Hz steps. */
  stepMine(dt, input) {
    const me = this.me;
    const hpBefore = me.hp;
    this.acc += dt;
    let steps = 0;
    const game = this.game;
    if (game) {
      // the others' positions come from their presence
      game.remote.length = 0;
      for (const r of this.rh) {
        if (r === this.meR) continue;
        if (r.present && !r.away) game.remote.push(r);
      }
      game.move[0].x = input.x;
      game.move[0].y = input.y;
      game.solo = this.solo;
    }
    while (this.acc >= STEP && steps < 5) {
      this.acc -= STEP;
      steps++;
      if (game) game.step(STEP);
      else this.stepClient(STEP, input);
    }
    if (this.acc > STEP * 8) this.acc = 0;
    this.heroEvents(hpBefore);
    this.weaponCues();
  }

  /** The non-host's step: my hero against the host's pictures. */
  stepClient(dt, input) {
    const me = this.me;
    const view = this.view;
    this.mates.length = 0;
    this.mates.push(me);
    for (const r of this.rh) if (r !== this.meR && r.present && !r.away) this.mates.push(r);
    tickOffer(me, dt, !this.solo);
    if (this.solo && me.nOffer > 0) return;
    heroStep(me, dt, input.x, input.y, this.mates);
    heroContact(me, view, this.vhash);
    // gems within reach: take them (the host removes them when it hears)
    const gs = this.gemSnap;
    if (!me.down) {
      const R2 = me.pickup * me.pickup;
      for (let i = 0; i < gs.n; i++) {
        const id = gs.id[i] & ID_MASK;
        if (this.hiddenGem[id]) continue;
        const dx = gs.x[i] - me.x;
        const dy = gs.y[i] - me.y;
        if (dx * dx + dy * dy >= R2) continue;
        this.hiddenGem[id] = 1;
        if (this.claims.length < 60) this.claims.push(id);
        addXp(me, GEM_XP[gs.tier[i]]);
        this.onGem(gs.x[i], gs.y[i], gs.tier[i]);
      }
    }
    const f = this.fighter;
    f.update(dt, me, view, this.vhash);
    const hits = f.hits;
    for (let q = 0; q < hits.n; q++) {
      const slot = hits.slot[q];
      if (view.dead[slot] === 1) continue;
      this.onLocalHit(view, slot, hits.amt[q], hits.crit[q] === 1, false, hits.fx[q]);
    }
  }

  /** My view of the horde (not the host): interpolated pictures, a grid over them. */
  fillView() {
    const view = this.view;
    const now = this.env.now();
    const tNight = this.interp.hostTime(now);
    this.T = Math.max(0, tNight);
    this.interp.fill(view, now, 0.11, this.T, this.mode);
    this.vhash.rebuild(view);
    for (let i = 0; i < this.interp.dn; i++) {
      if (this.deathBudget > 0) {
        this.deathBudget--;
        this.env.fx.death(this.interp.dx[i], this.interp.dy[i], this.interp.dtype[i], this.interp.delite[i] === 1);
        this.env.sound?.kill();
      } else break;
    }
  }

  afterStep(dt) {
    const fx = this.env.fx;
    if (this.game) {
      const w = this.game.world;
      this.T = w.T;
      // what happened in the world this frame
      this.budget.n = this.deathBudget;
      drainEvents(w, fx, this.env.sound, this.budget);
      this.deathBudget = this.budget.n;
      this.directorSeen(w.ringIdx, w.bossState, w.waveIdx);
      for (let i = 0; i < MAX_HEROES; i++) this.kills[i] = w.kills[i];
    }
    // badges that depend on the count
    if (this.me && this.kills[this.seat] >= 1000) this.env.badge('thousand');
    if (this.me && this.me.level >= 30) this.env.badge('level-30');
    this.xpFlash = Math.max(0, this.xpFlash - dt * 4);
    if (this.youArrow > 0) this.youArrow -= dt;
  }

  // ---------------------------------------------------------------- the host's duties
  hostDuties(dt, live) {
    const room = this.room;
    const game = this.game;
    const w = game.world;
    // end of the night
    if (game.over && !this.overWritten) {
      this.overWritten = true;
      const stats = this.roster.map((id, seat) => {
        const r = this.rh[seat];
        const lv = seat === this.seat ? this.me.level : r.present ? r.level : 1;
        return [w.kills[seat] | 0, lv];
      });
      this.writeG({
        ph: 'over', res: game.over, T: Math.round(w.T), stats, until: room.matchNow() + (game.over === 'dawn' ? 3500 : 1800) + RESULT_SECS * 1000,
      });
    }
    const g = this.g;
    if (g && g.ph === 'over' && !this.endCalled && room.matchNow() >= g.until) {
      this.endCalled = true;
      room.endMatch();
    }
    // pictures for the others (and for a reload)
    const others = room.online.length > 1;
    this.snapT += dt;
    this.gemT += dt;
    if (live || game.over) {
      if (this.snapT >= (others ? SNAP_COOP_EVERY : SNAP_SOLO_EVERY)) {
        this.snapT = 0;
        const meta = snapshotMeta(w, w.T);
        const m = encodeMonsters(w.mon);
        room.setState('sm', { mid: this.mid, ...meta, m: m.data, n: m.n });
      }
      if (this.gemT >= (others ? GEM_COOP_EVERY : GEM_SOLO_EVERY)) {
        this.gemT = 0;
        room.setState('sg', { mid: this.mid, t: Math.round(w.T * 1000) / 1000, g: encodeGems(w.gem).data });
      }
    }
    this.cos.update(dt, this.cosHero, w.mon, w.hash);
  }

  /** A host that is only watching hands the role to someone still playing (or ends a night nobody is in). */
  hostWatchDuty() {
    const room = this.room;
    if (this.pageT - (this.lastHandTry || -10) < 2) return;
    this.lastHandTry = this.pageT;
    const player = this.roster.map((id) => room.players.get(id)).find((p) => p && p.connected !== false);
    if (player) room.transferHost(player.id);
    else room.endMatch();
  }

  // ---------------------------------------------------------------- talking to the others
  netDuties(dt) {
    const room = this.room;
    this.netT += dt;
    this.presT += dt;
    if (this.me && this.presT >= PRESENCE_EVERY) {
      this.presT = 0;
      room.setPresence(packPresence(this.me, 'p'));
    }
    if (this.netT >= NET_EVERY) {
      this.netT = 0;
      if (!this.me) return;
      const f = this.fighter;
      const hasHits = !this.game && !this.batch.empty;
      const hasFx = f.fx.n > 0 && room.online.length > 1;
      if (!hasFx) f.fx.n = 0;
      if (hasHits || hasFx) {
        const msg = { t: MSG_DMG, rid: this.rid };
        if (hasHits) msg.h = this.batch.take();
        if (hasFx) msg.f = packFx(f.fx);
        room.send(msg);
      }
      if (this.claims.length > 0 && !this.game) {
        room.send({ t: MSG_GEMS, rid: this.rid, ids: this.claims.splice(0, 60) });
      }
    }
    if (this.fighter && this.fighter.fx.n > 60) this.fighter.fx.n = 0;
  }

  // ---------------------------------------------------------------- the end of the night, for me
  finishDuties(over) {
    if (!over || this.finished) return;
    const g = this.g;
    if (!g) return;
    this.finished = true;
    this.env.finish(this.resultFor(g), this);
  }

  resultFor(g) {
    const room = this.room;
    const rows = this.roster.map((id, seat) => {
      const st = Array.isArray(g.stats) && Array.isArray(g.stats[seat]) ? g.stats[seat] : [0, 1];
      const rh = this.rh[seat];
      return {
        id,
        name: room.players.get(id)?.name || rh.name || 'Player',
        color: rh.color,
        avatar: rh.avatar,
        kills: Math.max(0, st[0] | 0),
        level: Math.max(1, st[1] | 0),
      };
    });
    const mine = this.seat >= 0 ? rows[this.seat] : rows[0];
    return {
      result: g.res === 'dawn' ? 'dawn' : 'defeat',
      time: Number.isFinite(g.T) ? g.T : this.T,
      kills: mine ? mine.kills : 0,
      level: mine ? mine.level : 1,
      rows,
      watch: this.watch,
    };
  }

  /** My card pick (1-3, or a tap). */
  pick(i) {
    const me = this.me;
    if (!me || me.nOffer === 0) return false;
    if (!pickOffer(me, i)) return false;
    this.env.sound?.select();
    this.checkpoint();
    return true;
  }

  // ---------------------------------------------------------------- the scene the renderer draws
  followed() {
    if (this.me) return this.meR;
    // watching: someone who is up and about
    const n = this.rh.length;
    for (let k = 0; k < n; k++) {
      const r = this.rh[(this.watchSeat + k) % n];
      if (r && r.present && !r.down) {
        this.watchSeat = (this.watchSeat + k) % n;
        return r;
      }
    }
    for (let k = 0; k < n; k++) {
      const r = this.rh[(this.watchSeat + k) % n];
      if (r && r.present) return r;
    }
    return null;
  }

  switchWatch() {
    this.watchSeat = (this.watchSeat + 1) % Math.max(1, this.rh.length);
  }

  buildScene(dt) {
    const room = this.room;
    const fx = this.env.fx;
    const sc = this.scene;
    // everyone's look
    this.list.length = 0;
    for (const r of this.rh) {
      const player = room.players.get(r.id);
      if (player) r.name = player.name || r.name;
      r.avatar = r.avatar || this.env.avatar(r.id);
      if (r === this.meR) {
        r.fromState(this.me, this.fighter);
        r.away = false;
        r.ready = false;
        this.list.push(r);
        continue;
      }
      if (readOther(room, r, dt)) this.list.push(r);
      r.ready = false;
    }
    sc.nHeroes = this.list.length;
    const f = this.followed();
    if (f) {
      const lead = f.moving ? 0.25 : 0;
      this.camX += (f.x + f.dx * lead * 1.5 - this.camX) * Math.min(1, dt * 7);
      this.camY += (f.y + f.dy * lead * 1.5 - this.camY) * Math.min(1, dt * 7);
    }
    sc.camX = this.camX + fx.shake.x;
    sc.camY = this.camY + fx.shake.y;
    sc.anim = this.anim;
    sc.t = this.T;
    sc.focusX = f ? f.x : this.camX;
    if (this.game) {
      sc.mon = this.game.world.mon;
      sc.gem = this.game.world.gem;
    } else {
      sc.mon = this.view;
      sc.gem = this.gemSnap;
    }
    sc.fighters.length = 0;
    if (this.fighter) sc.fighters.push(this.fighter);
    sc.fighters.push(this.cos);
    sc.youArrow = this.youArrow > 0 && !this.watch ? this.youArrow : 0;
    // the night grows light as dawn comes
    const T = this.T;
    const len = this.length;
    const pre = Math.max(0, Math.min(1, (T - (len - 20)) / 20));
    const dawn = Math.max(0, Math.min(1, (T - len) / 3));
    sc.darkness = 1 - 0.3 * pre - 0.7 * dawn;
    sc.dawn = dawn;
    // the Night Warden's health
    const m = sc.mon;
    const bossUp = m.boss >= 0 && m.dead[m.boss] !== 1;
    this.boss.on = bossUp;
    this.boss.frac = bossUp ? m.hpf[m.boss] : 1;
  }

  /** The numbers the HUD shows (about the hero this screen follows). */
  hudFor(S) {
    const f = this.followed();
    const me = this.me;
    S.t = this.T;
    S.length = this.length;
    S.boss = this.boss;
    if (me) {
      S.level = me.level;
      S.hp = me.hp;
      S.maxHp = me.maxHp;
      S.kills = this.kills[this.seat] | 0;
      S.down = me.down;
    } else if (f) {
      S.level = f.level;
      S.hp = f.hp;
      S.maxHp = f.maxHp;
      S.kills = this.kills[f.idx] | 0;
      S.down = false;
    }
    S.mates.length = 0;
    for (const r of this.rh) {
      if (r === this.meR || !r.present) continue;
      S.mates.push({ name: r.name, color: r.color, hp: r.hp / Math.max(1, r.maxHp), down: r.down, rv: r.rv });
    }
    return S;
  }
}

