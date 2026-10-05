// A run on one page: the world (monsters, gems, director) plus the heroes this page plays. The host's page runs one for
// the real game (its own hero; the others come in as `remote` positions), the title screen runs one with an autopilot,
// the lobby runs one as a camp with training dummies, and the tests run whole nights with several autopilots.
import { GEM_XP, STEP } from './data.js';
import { World } from './sim.js';
import { Fighter } from './combat.js';
import { HeroState, heroStep, heroContact, gemsInReach, addXp, tickOffer } from './hero.js';
import { Autopilot } from './ai.js';
import { mulberry32 } from './rng.js';

const reach = new Int32Array(96);
const reachIds = new Int32Array(96);

export class Game {
  /**
   * @param {{ seed?: number, length?: number, hard?: boolean, players?: number, camp?: boolean,
   *           ids?: string[], seats?: number[], ai?: boolean, solo?: boolean }} opts
   * `ids`: the heroes this page plays (one for a real run). `seats`: their seat numbers in the run (default 0, 1, ...).
   * `ai`: autopilots play them. `solo`: the run pauses while a card is picked (a run of one).
   */
  constructor(opts = {}) {
    const seed = (opts.seed ?? 1) >>> 0;
    this.world = new World({ seed, length: opts.length, hard: opts.hard, players: opts.players ?? (opts.ids ? opts.ids.length : 1), camp: opts.camp });
    this.rng = mulberry32(seed ^ 0x9e3779b9);
    this.solo = opts.solo ?? (opts.ids ? opts.ids.length === 1 : true);
    this.ai = opts.ai === true;
    const ids = opts.ids ?? ['hero0'];
    this.heroes = ids.map((id, i) => new HeroState(id, opts.seats ? opts.seats[i] : i, this.rng));
    this.fighters = this.heroes.map(() => new Fighter(this.rng));
    this.pilots = this.heroes.map(() => new Autopilot(this.rng));
    /** Heroes other pages play: anything with idx, x, y, down (the host updates these from presence). */
    this.remote = [];
    /** Wish of the human-played heroes: set `move[i]` = [mx, my] before each step. */
    this.move = this.heroes.map(() => ({ x: 0, y: 0 }));
    this.mates = [];
    this.over = null; // 'dawn' | 'defeat' once the run has ended
    this.overAt = 0;
    this.hooks = { hit: null, gem: null, level: null };
    this.acc = 0;
    this.t = 0;
  }

  get time() {
    return this.world.T;
  }

  /** The run waits while a solo hero is choosing a card. */
  get paused() {
    if (!this.solo) return false;
    for (let i = 0; i < this.heroes.length; i++) if (this.heroes[i].nOffer > 0) return true;
    return false;
  }

  hero(id) {
    for (let i = 0; i < this.heroes.length; i++) if (this.heroes[i].id === id) return this.heroes[i];
    return null;
  }

  /** How many heroes (here and elsewhere) are still on their feet. */
  alive() {
    let n = 0;
    for (const h of this.heroes) if (!h.down) n++;
    for (const r of this.remote) if (r && !r.down) n++;
    return n;
  }

  /** One fixed step. */
  step(dt = STEP) {
    const w = this.world;
    const heroes = this.heroes;
    for (let i = 0; i < heroes.length; i++) {
      const h = heroes[i];
      if (this.ai) this.pilots[i].choose(h);
      tickOffer(h, dt, !this.solo);
    }
    if (this.paused) return;

    // who is who
    this.mates.length = 0;
    for (const h of heroes) this.mates.push(h);
    for (const r of this.remote) if (r) this.mates.push(r);

    // move the heroes
    for (let i = 0; i < heroes.length; i++) {
      const h = heroes[i];
      let mx = 0;
      let my = 0;
      if (this.ai) {
        const p = this.pilots[i];
        p.think(dt, h, w.mon, w.hash, w.gem);
        mx = p.mx;
        my = p.my;
      } else {
        mx = this.move[i].x;
        my = this.move[i].y;
      }
      heroStep(h, dt, mx, my, this.mates);
    }

    // the world sees them
    w.clearHeroes();
    for (const h of heroes) w.setHero(h.idx, h.x, h.y, !h.down);
    for (const r of this.remote) if (r) w.setHero(r.idx, r.x, r.y, !r.down);
    w.step(dt);

    for (let i = 0; i < heroes.length; i++) {
      const h = heroes[i];
      const f = this.fighters[i];
      // touching monsters
      heroContact(h, w.mon, w.hash);
      // gems within reach
      const k = gemsInReach(h, w.gem, reach);
      for (let q = 0; q < k; q++) reachIds[q] = w.gem.id[reach[q]];
      for (let q = 0; q < k; q++) {
        const slot = w.gemSlot[reachIds[q] & 0x7fff];
        const gx = slot >= 0 ? w.gem.x[slot] : 0;
        const gy = slot >= 0 ? w.gem.y[slot] : 0;
        const tier = w.claimGem(reachIds[q]);
        if (tier < 0) continue;
        addXp(h, GEM_XP[tier]);
        if (this.hooks.gem) this.hooks.gem(h, gx, gy, tier);
      }
      // weapons
      f.update(dt, h, w.mon, w.hash);
      const hits = f.hits;
      for (let q = 0; q < hits.n; q++) {
        const slot = hits.slot[q];
        const fx = hits.fx[q];
        const amt = hits.amt[q];
        const wasDead = w.mon.dead[slot] === 1;
        if (this.hooks.hit) this.hooks.hit(h, slot, amt, hits.crit[q] === 1);
        if (!wasDead) w.hit(slot, amt, h.idx, fx);
      }
      h.kills = w.kills[h.idx];
    }

    this.t += dt;
    if (!this.over) {
      if (w.cleared) {
        this.over = 'dawn';
        this.overAt = w.T;
      } else if (!w.camp && this.alive() === 0) {
        this.over = 'defeat';
        this.overAt = w.T;
      }
    }
  }

  /** Runs `seconds` of steps (tests, posters, the title). */
  run(seconds) {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      this.step(STEP);
      this.world.clearEvents();
      for (const f of this.fighters) f.fx.n = 0;
    }
  }
}

