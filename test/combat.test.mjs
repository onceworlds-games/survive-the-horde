import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../game/sim.js';
import { Fighter, A_RING, A_LIGHTNING, A_RAIN, FXK_BOLT, FXK_RING, bladePos } from '../game/combat.js';
import { HeroState, applyUpgrade } from '../game/hero.js';
import { Game } from '../game/game.js';
import { mulberry32 } from '../game/rng.js';
import { STEP, T_SKEL, T_KNIGHT, W_BLADES, W_RING, W_LIGHTNING, W_RAIN, W_NOVA, W_BOLT, BOLT, BLADES, RING, FX_SLOW } from '../game/data.js';

function setup(seed = 1) {
  const w = new World({ seed, camp: true });
  w.setHero(0, 0, 0, true);
  const h = new HeroState('a', 0, mulberry32(seed));
  const f = new Fighter(mulberry32(seed + 1));
  return { w, h, f };
}

/** Steps the fighter against a frozen world for `seconds`, applying hits like the game does. Returns total hits per slot id. */
function fight({ w, h, f }, seconds, onStep) {
  const dealt = new Map();
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    w.hash.rebuild(w.mon);
    f.update(STEP, h, w.mon, w.hash);
    for (let q = 0; q < f.hits.n; q++) {
      const slot = f.hits.slot[q];
      dealt.set(w.mon.id[slot], (dealt.get(w.mon.id[slot]) ?? 0) + f.hits.amt[q]);
      w.hit(slot, f.hits.amt[q], 0, f.hits.fx[q]);
    }
    if (onStep) onStep(i);
    f.fx.n = 0;
    w.clearEvents();
  }
  return dealt;
}

test('Magic Bolt flies at the nearest monster and hurts it', () => {
  const s = setup();
  const near = s.w.spawn(T_SKEL, 4, 0, false);
  const far = s.w.spawn(T_SKEL, 9, 3, false);
  s.w.mon.hp[near] = s.w.mon.maxHp[near] = 1e6; // keep both alive
  s.w.mon.hp[far] = s.w.mon.maxHp[far] = 1e6;
  const nearId = s.w.mon.id[near];
  const farId = s.w.mon.id[far];
  s.w.camp = true;
  s.w.hash.rebuild(s.w.mon);
  s.f.update(STEP, s.h, s.w.mon, s.w.hash);
  assert.equal(s.f.pn, 1, 'one bolt at level 1');
  assert.ok(s.f.pvx[0] > 14 && Math.abs(s.f.pvy[0]) < 0.5, 'aimed at the near one');
  assert.equal(s.f.fx.kind[0], FXK_BOLT, 'and the others are told');
  const dealt = fight(s, 1);
  assert.ok((dealt.get(nearId) ?? 0) >= BOLT.dmg[0], 'the near one was hit');
  assert.ok(!dealt.has(farId) || dealt.get(nearId) >= dealt.get(farId), 'near gets at least as much');
});

test('a bolt does not fire with nothing to shoot, and fires at once when something shows up', () => {
  const s = setup();
  s.f.update(STEP, s.h, s.w.mon, s.w.hash);
  assert.equal(s.f.pn, 0);
  for (let i = 0; i < 120; i++) s.f.update(STEP, s.h, s.w.mon, s.w.hash);
  assert.equal(s.f.pn, 0);
  s.w.spawn(T_SKEL, 3, 0, false);
  s.w.hash.rebuild(s.w.mon);
  s.f.update(STEP, s.h, s.w.mon, s.w.hash);
  assert.equal(s.f.pn, 1);
});

test('more levels, more bolts, and piercing bolts hit several monsters', () => {
  const s = setup();
  for (let i = 0; i < 4; i++) applyUpgrade(s.h, W_BOLT);
  assert.equal(s.h.wl[W_BOLT], 5);
  for (let i = 0; i < 5; i++) {
    const slot = s.w.spawn(T_SKEL, 3 + i * 0.9, 0, false);
    s.w.mon.hp[slot] = s.w.mon.maxHp[slot] = 1e6;
  }
  s.w.hash.rebuild(s.w.mon);
  s.f.update(STEP, s.h, s.w.mon, s.w.hash);
  assert.equal(s.f.pn, BOLT.count[4]);
  const dealt = fight(s, 1);
  assert.ok(dealt.size >= 3, `a level 5 bolt pierces: hit ${dealt.size} monsters`);
});

test('Spinning Blades orbit the hero and cut what they touch, each monster at most every 0.45 s', () => {
  const s = setup();
  applyUpgrade(s.h, W_BLADES);
  const slot = s.w.spawn(T_SKEL, BLADES.radius[0], 0, false);
  s.w.mon.hp[slot] = s.w.mon.maxHp[slot] = 1e6;
  const id = s.w.mon.id[slot];
  s.h.wl[W_BOLT] = 0; // blades only
  const dealt = fight(s, 2);
  const total = dealt.get(id) ?? 0;
  assert.ok(total >= BLADES.dmg[0], 'the blades hit it');
  assert.ok(total <= BLADES.dmg[0] * 2 * (2 / 0.45) + 1, 'but not every tick');
  const pos = [0, 0];
  bladePos(1, 2, 0, 3, 10, 10, pos);
  assert.ok(Math.abs(pos[0] - 7) < 1e-6 && Math.abs(pos[1] - 10) < 1e-6, 'blade 1 of 2 is opposite blade 0');
});

test('Fire Ring pulses around the hero when something is near, and hits each monster once per pulse', () => {
  const s = setup();
  s.h.wl[W_BOLT] = 0;
  applyUpgrade(s.h, W_RING);
  const slot = s.w.spawn(T_SKEL, 2, 0, false);
  s.w.mon.hp[slot] = s.w.mon.maxHp[slot] = 1e6;
  const id = s.w.mon.id[slot];
  s.w.hash.rebuild(s.w.mon);
  let rings = 0;
  const dealt = fight(s, 0.9, () => {
    for (let i = 0; i < s.f.an; i++) if (s.f.akind[i] === A_RING && s.f.aage[i] < STEP * 1.5) rings++;
  });
  assert.ok(rings >= 1, 'a pulse');
  const hit = dealt.get(id) ?? 0;
  assert.ok(Math.abs(hit - RING.dmg[0]) < 1e-6, `exactly one hit per pulse, got ${hit}`);
  // empty ring: nothing to hit, no pulse
  const e = setup();
  e.h.wl[W_BOLT] = 0;
  applyUpgrade(e.h, W_RING);
  e.f.update(STEP, e.h, e.w.mon, e.w.hash);
  assert.equal(e.f.an, 0);
});

test('Frost Nova slows what it hits', () => {
  const s = setup();
  s.h.wl[W_BOLT] = 0;
  applyUpgrade(s.h, W_NOVA);
  const slot = s.w.spawn(T_KNIGHT, 2.5, 0, false);
  const id = s.w.mon.id[slot];
  s.w.hash.rebuild(s.w.mon);
  fight(s, 0.8);
  const now = s.w.slotOf(id);
  assert.ok(now >= 0);
  assert.ok(s.w.mon.slow[now] > 1.5, `slowed ${s.w.mon.slow[now]}`);
  assert.equal(FX_SLOW, 1);
});

test('Lightning strikes monsters in range, Arrow Rain drops a zone that ticks', () => {
  const s = setup();
  s.h.wl[W_BOLT] = 0;
  applyUpgrade(s.h, W_LIGHTNING);
  applyUpgrade(s.h, W_RAIN);
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const slot = s.w.spawn(T_SKEL, 3 + i, (i % 2) * 2, false);
    s.w.mon.hp[slot] = s.w.mon.maxHp[slot] = 1e6;
    ids.push(s.w.mon.id[slot]);
  }
  s.w.hash.rebuild(s.w.mon);
  let bolts = 0;
  let zones = 0;
  const dealt = fight(s, 2, () => {
    for (let i = 0; i < s.f.an; i++) {
      if (s.f.akind[i] === A_LIGHTNING && s.f.aage[i] < STEP * 1.5) bolts++;
      if (s.f.akind[i] === A_RAIN && s.f.aage[i] < STEP * 1.5) zones++;
    }
  });
  assert.ok(bolts >= 1, 'a strike');
  assert.ok(zones >= 1, 'a volley');
  assert.ok(dealt.size >= 1);
});

test('a fighter that is down does not fire; remote effects draw but never hurt', () => {
  const s = setup();
  s.w.spawn(T_SKEL, 3, 0, false);
  s.w.hash.rebuild(s.w.mon);
  s.h.down = true;
  s.f.update(STEP, s.h, s.w.mon, s.w.hash);
  assert.equal(s.f.pn, 0);
  s.f.spawnCosmetic(FXK_RING, 3, 0, 3, 0);
  s.f.spawnCosmetic(FXK_BOLT, 0, 0, 0, 0);
  s.f.spawnCosmetic(99, 1, 1, 1, 1); // unknown kind: ignored
  s.f.spawnCosmetic(FXK_BOLT, NaN, 0, 0, 0); // junk: ignored
  assert.equal(s.f.an, 1);
  assert.equal(s.f.pn, 1);
  fight(s, 1);
  assert.equal(s.w.mon.hpf[0], 1, 'the cosmetic ring and bolt did nothing');
});

test('fighters never leave anything pooled beyond their caps', () => {
  const g = new Game({ seed: 11, length: 300, ids: ['a'], ai: true });
  g.world.T = 200;
  g.world.ringIdx = 3;
  g.heroes[0].godmode = true;
  for (let w = 0; w < 5; w++) for (let l = 0; l < 5; l++) g.heroes[0].wl[w] = 5;
  g.heroes[0].nW = 5;
  g.run(30);
  const f = g.fighters[0];
  assert.ok(f.pn <= 160 && f.an <= 96);
  for (let i = 0; i < f.pn; i++) assert.ok(Number.isFinite(f.px[i]) && Number.isFinite(f.py[i]));
});
