import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub } from './fakeroom.mjs';
import { Run } from '../game/run.js';
import { Effects } from '../game/fx.js';
import { mulberry32 } from '../game/rng.js';
import { MAX_MON, MAX_GEMS, STEP } from '../game/data.js';
import { damageHero } from '../game/hero.js';

/** Three pages, a night, and a lot of things going wrong: reloads, hosts leaving, junk, damage. Nothing may throw or go NaN. */
function scenario(seed) {
  const rng = mulberry32(seed);
  const hub = new Hub({ length: rng() < 0.5 ? 300 : 600, hero: rng() < 0.5 ? 'normal' : 'hard' });
  const ids = ['a', 'b', 'c'].slice(0, 1 + Math.floor(rng() * 3));
  const pages = new Map();
  const mk = (id) => {
    const room = hub.rooms.get(id) ?? hub.join(id, id.toUpperCase());
    const fx = new Effects();
    fx.setQuality('high', false);
    const page = { id, room, fx, run: null, anim: 0, saved: null, finished: 0, badges: [] };
    page.env = () => ({
      room, fx, sound: null, avatar: () => null, callout() {}, badge: (b) => page.badges.push(b),
      save: (k, v) => { if (k === 'run') page.saved = v; }, saved: page.saved, now: () => hub.clock / 1000, finish: () => { page.finished++; },
    });
    return page;
  };
  for (const id of ids) pages.set(id, mk(id));
  hub.start(ids, seed);
  for (const p of pages.values()) p.run = new Run(p.env());
  const god = rng() < 0.7; // most nights run long: heroes that cannot die
  const arm = (p) => {
    if (god && p.run.me) p.run.me.godmode = true;
  };
  for (const p of pages.values()) arm(p);
  const log = [];
  const total = 150 + Math.floor(rng() * 150);
  for (let t = 0; t < total; t++) {
    // something goes wrong about once every 6 seconds
    if (rng() < 0.17) {
      const live = [...pages.values()].filter((p) => p.run);
      const p = live[Math.floor(rng() * live.length)];
      if (p) {
        const what = Math.floor(rng() * 6);
        log.push(`${t}s ${p.id} ${['reload', 'leave', 'junk', 'damage', 'late', 'kill'][what]}`);
        if (what === 0) {
          p.run.dispose();
          p.run = new Run(p.env());
          arm(p);
        } else if (what === 1 && pages.size > 1) {
          p.run.dispose();
          pages.delete(p.id);
          hub.leave(p.id);
        } else if (what === 2) {
          const junk = [null, 7, 'x', { t: 'd', rid: p.run.rid, h: [1, 'x', 3, 1e9, 1, 0], f: [9, 9, 9] }, { t: 'g', rid: p.run.rid, ids: [1, 2, 3.5, -4] }, { t: 'd', rid: p.run.rid, h: new Array(500).fill(1) }];
          for (const other of pages.values()) if (other.run && other !== p) for (const j of junk) other.run.message(j, { id: p.id });
          p.run.takeState('sm', { mid: p.run.mid, t: 5, d: [0, 0, 0, 0, 0], k: [], m: 'AAAA' });
          p.run.takeState('sg', { mid: p.run.mid, t: 5, g: '$$$' });
        } else if (what === 3 && p.run.me) damageHero(p.run.me, 60);
        else if (what === 4 && p.run.me) p.run.me.pending += 3;
        else if (what === 5 && p.run.me) damageHero(p.run.me, 10000);
      }
    }
    if (pages.size === 0) break;
    for (let f = 0; f < 60; f++) {
      hub.advance(1000 / 60);
      const time = hub.clock / 1000;
      for (const p of pages.values()) {
        if (!p.run) continue;
        p.anim += STEP;
        p.run.frame(STEP, { x: Math.cos(time * (0.5 + p.id.charCodeAt(0) * 0.01)), y: Math.sin(time * 0.9) }, p.anim, false);
        p.fx.update(STEP);
        if (p.run.me && p.run.me.nOffer > 0 && f % 20 === 0) p.run.pick(Math.floor(rng() * p.run.me.nOffer));
      }
    }
    if (hub.match.phase === 'lobby') break; // the night ended
    // invariants
    for (const p of pages.values()) {
      const r = p.run;
      if (!r) continue;
      assert.ok(r.view.n <= MAX_MON + 8, `${seed}: view ${r.view.n}`);
      assert.ok(Number.isFinite(r.camX) && Number.isFinite(r.camY), `${seed}: camera NaN (${log.join(', ')})`);
      if (r.game) {
        const w = r.game.world;
        assert.ok(w.mon.n <= MAX_MON + 8 && w.gem.n <= MAX_GEMS, `${seed}: world over cap`);
        for (let i = 0; i < w.mon.n; i += 7) assert.ok(Number.isFinite(w.mon.x[i]) && Number.isFinite(w.mon.y[i]), `${seed}: NaN monster`);
      }
      if (r.me) assert.ok(Number.isFinite(r.me.x) && Number.isFinite(r.me.hp) && Number.isFinite(r.me.xp), `${seed}: NaN hero (${log.join(', ')})`);
    }
    // exactly one page hosts, or none while the host changes
    const hosts = [...pages.values()].filter((p) => p.run && p.run.game && p.room.isHost);
    assert.ok(hosts.length <= 1, `${seed}: ${hosts.length} hosts at ${t}s (${log.join(', ')})`);
  }
  return { hub, pages, log, ranFor: hub.clock / 1000 };
}

for (let seed = 1; seed <= 14; seed++) {
  test(`fuzz ${seed}: reloads, leavers, junk and damage in a night of up to three players`, () => {
    const { pages, hub, ranFor, log } = scenario(seed * 7919);
    if (process.env.FUZZ_VERBOSE) console.log(seed, 'ran', Math.round(ranFor), 's', hub.match.phase, [...pages.keys()].join(''), log.join(', '));
    // everyone who is still here ends up in the same night
    const mids = new Set([...pages.values()].filter((p) => p.run).map((p) => p.run.mid));
    assert.ok(mids.size <= 1);
    void hub;
  });
}
