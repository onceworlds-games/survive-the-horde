import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HeroState, heroStep, heroContact, damageHero, addXp, openOffer, pickOffer, applyUpgrade, tickOffer, gemsInReach,
  EV_SHIELD, EV_DIED, EV_LEVEL, EV_REVIVED, OFFER_SECS,
} from '../game/hero.js';
import { World } from '../game/sim.js';
import { Autopilot } from '../game/ai.js';
import { mulberry32 } from '../game/rng.js';
import {
  ARENA_R, STEP, xpNeeded, W_BOLT, W_SHIELD, P_HP, P_SPEED, P_PICKUP, U_PASSIVE_BASE, U_RECOVER, MAX_WEAPONS, MAX_PASSIVES,
  MAX_LEVEL, N_WEAPONS, N_PASSIVES, T_SKEL, SHIELD,
} from '../game/data.js';

const rng = () => mulberry32(5);

test('a new hero has the numbers from the spec', () => {
  const h = new HeroState('a', 0, rng());
  assert.equal(h.hp, 100);
  assert.equal(h.speed, 4.2);
  assert.equal(h.pickup, 2.2);
  assert.equal(h.regen, 0);
  assert.equal(h.wl[W_BOLT], 1, 'starts with Magic Bolt');
  assert.equal(h.nW, 1);
});

test('walking: speed, normalised diagonals, the rim of the arena', () => {
  const h = new HeroState('a', 0, rng());
  for (let i = 0; i < 60; i++) heroStep(h, STEP, 1, 0, []);
  assert.ok(Math.abs(h.x - 4.2) < 0.05, `walked ${h.x}`);
  const d = new HeroState('b', 1, rng());
  for (let i = 0; i < 60; i++) heroStep(d, STEP, 1, 1, []);
  assert.ok(Math.abs(Math.hypot(d.x, d.y) - 4.2) < 0.05, 'diagonal is not faster');
  const far = new HeroState('c', 2, rng());
  for (let i = 0; i < 60 * 40; i++) heroStep(far, STEP, 1, 0, []);
  assert.ok(Math.hypot(far.x, far.y) <= ARENA_R, 'stays inside the ring of fallen trees');
  const nan = new HeroState('n', 3, rng());
  heroStep(nan, STEP, NaN, Infinity, []);
  assert.ok(Number.isFinite(nan.x) && Number.isFinite(nan.y));
});

test('XP: 5 then 10 then 15; each level is a pending pick', () => {
  const h = new HeroState('a', 0, rng());
  assert.equal(addXp(h, 4), 0);
  assert.equal(addXp(h, 1), 1);
  assert.equal(h.level, 2);
  assert.equal(h.xp, 0);
  assert.equal(h.pending, 1);
  assert.ok(h.ev & EV_LEVEL);
  const gained = addXp(h, xpNeeded(2) + xpNeeded(3) + 2);
  assert.equal(gained, 2);
  assert.equal(h.level, 4);
  assert.equal(h.xp, 2);
  assert.equal(h.pending, 3);
});

test('a card offer: three different upgrades, only ones the hero can still take', () => {
  const h = new HeroState('a', 0, rng());
  for (let trial = 0; trial < 50; trial++) {
    h.nOffer = 0;
    openOffer(h);
    assert.equal(h.nOffer, 3);
    const ids = [...h.offer.slice(0, 3)];
    assert.equal(new Set(ids).size, 3, 'distinct');
    for (const id of ids) assert.ok(id < N_WEAPONS || (id >= U_PASSIVE_BASE && id < U_PASSIVE_BASE + N_PASSIVES));
  }
});

test('five weapons and five passives at most, level 5 at most, and recover when nothing is left', () => {
  const h = new HeroState('a', 0, rng());
  for (let w = 0; w < 5; w++) for (let l = 0; l < 5; l++) applyUpgrade(h, w);
  assert.equal(h.nW, MAX_WEAPONS);
  applyUpgrade(h, 5); // a sixth weapon: refused
  assert.equal(h.wl[5], 0);
  assert.equal(h.nW, 5);
  for (let p = 0; p < 5; p++) for (let l = 0; l < 5; l++) applyUpgrade(h, U_PASSIVE_BASE + p);
  assert.equal(h.nP, MAX_PASSIVES);
  applyUpgrade(h, U_PASSIVE_BASE + 5);
  assert.equal(h.pl[5], 0);
  for (let w = 0; w < 5; w++) assert.equal(h.wl[w], MAX_LEVEL);
  h.nOffer = 0;
  openOffer(h);
  assert.equal(h.nOffer, 1);
  assert.equal(h.offer[0], U_RECOVER, 'only a heal is left to take');
  h.hp = 10;
  h.pending = 1;
  assert.ok(pickOffer(h, 0));
  assert.ok(h.hp > 10);
  assert.equal(h.pending, 0);
});

test('passives change the numbers', () => {
  const h = new HeroState('a', 0, rng());
  applyUpgrade(h, U_PASSIVE_BASE + P_HP);
  assert.equal(h.maxHp, 120);
  assert.equal(h.hp, 120, 'a Max HP pick heals what it adds');
  for (let i = 0; i < 4; i++) applyUpgrade(h, U_PASSIVE_BASE + P_SPEED);
  assert.ok(Math.abs(h.speed - 4.2 * 1.32) < 1e-9);
  for (let i = 0; i < 2; i++) applyUpgrade(h, U_PASSIVE_BASE + P_PICKUP);
  assert.ok(Math.abs(h.pickup - 2.2 * 1.6) < 1e-9);
});

test('picking a card finishes the level-up and opens the next when more are waiting', () => {
  const h = new HeroState('a', 0, rng());
  h.pending = 2;
  tickOffer(h, STEP, false);
  assert.equal(h.nOffer, 3);
  assert.ok(pickOffer(h, 1));
  assert.equal(h.pending, 1);
  assert.equal(h.nOffer, 3, 'the next card is up at once');
  assert.ok(pickOffer(h, 0));
  assert.equal(h.pending, 0);
  assert.equal(h.nOffer, 0);
  assert.ok(!pickOffer(h, 0));
});

test('co-op: a card nobody picks is picked for them after eight seconds, solo waits', () => {
  const h = new HeroState('a', 0, rng());
  h.pending = 1;
  tickOffer(h, STEP, true);
  assert.equal(h.nOffer, 3);
  for (let i = 0; i < (OFFER_SECS - 1) / STEP; i++) tickOffer(h, STEP, true);
  assert.equal(h.nOffer, 3, 'still waiting');
  for (let i = 0; i < 2 / STEP; i++) tickOffer(h, STEP, true);
  assert.equal(h.nOffer, 0);
  assert.equal(h.pending, 0);
  const s = new HeroState('s', 1, rng());
  s.pending = 1;
  for (let i = 0; i < 20 / STEP; i++) tickOffer(s, STEP, false);
  assert.equal(s.nOffer, 3, 'a solo card waits for ever');
});

test('touching monsters hurt once every half second', () => {
  const w = new World({ seed: 1 });
  w.setHero(0, 0, 0, true);
  const h = new HeroState('a', 0, rng());
  for (let i = 0; i < 3; i++) w.spawn(T_SKEL, 0.1 * i, 0.1);
  w.hash.rebuild(w.mon);
  const hurt = heroContact(h, w.mon, w.hash);
  assert.ok(hurt > 5 && hurt < 12, `hurt ${hurt}`);
  assert.equal(heroContact(h, w.mon, w.hash), 0, 'not again at once');
  for (let i = 0; i < 31; i++) heroStep(h, STEP, 0, 0, []);
  assert.ok(heroContact(h, w.mon, w.hash) > 0, 'again after half a second');
});

test('Holy Shield blocks one hit, then comes back', () => {
  const h = new HeroState('a', 0, rng());
  applyUpgrade(h, W_SHIELD);
  assert.ok(h.shieldReady);
  assert.equal(damageHero(h, 30), 0);
  assert.equal(h.hp, 100);
  assert.ok(h.ev & EV_SHIELD);
  assert.ok(!h.shieldReady);
  assert.equal(damageHero(h, 30), 30);
  for (let i = 0; i < (SHIELD.cd[0] + 0.2) / STEP; i++) heroStep(h, STEP, 0, 0, []);
  assert.ok(h.shieldReady, 'back after its cooldown');
});

test('dying makes a ghost; a teammate standing next to it for three seconds brings the hero back', () => {
  const g = new HeroState('ghost', 0, rng());
  const m = new HeroState('mate', 1, rng());
  m.x = 1;
  damageHero(g, 1000);
  assert.ok(g.down);
  assert.ok(g.ev & EV_DIED);
  assert.equal(damageHero(g, 5), 0, 'ghosts cannot be hurt');
  for (let i = 0; i < 2.5 / STEP; i++) heroStep(g, STEP, 0, 0, [g, m]);
  assert.ok(g.down && g.reviveT > 2);
  for (let i = 0; i < 1 / STEP; i++) heroStep(g, STEP, 0, 0, [g, m]);
  assert.ok(!g.down);
  assert.equal(g.hp, 50);
  assert.ok(g.invuln > 2);
  assert.ok(g.ev & EV_REVIVED);
  // nobody near: no progress
  const lone = new HeroState('lone', 2, rng());
  damageHero(lone, 1000);
  for (let i = 0; i < 10 / STEP; i++) heroStep(lone, STEP, 0, 0, [lone]);
  assert.ok(lone.down);
  const down = new HeroState('d', 3, rng());
  down.x = 1;
  damageHero(down, 1000);
  const g2 = new HeroState('g2', 4, rng());
  damageHero(g2, 1000);
  for (let i = 0; i < 6 / STEP; i++) heroStep(g2, STEP, 0, 0, [g2, down]);
  assert.ok(g2.down, 'a ghost cannot revive a ghost');
});

test('gems inside the pickup radius are in reach; ghosts pick up nothing', () => {
  const w = new World({ seed: 1 });
  w.dropGem(1, 0, 0);
  w.dropGem(5, 0, 0);
  const h = new HeroState('a', 0, rng());
  const out = new Int32Array(8);
  assert.equal(gemsInReach(h, w.gem, out), 1);
  h.down = true;
  assert.equal(gemsInReach(h, w.gem, out), 0);
});

test('the autopilot always picks a legal card', () => {
  const h = new HeroState('a', 0, mulberry32(3));
  const ai = new Autopilot(mulberry32(4));
  for (let i = 0; i < 80; i++) {
    h.pending = 1;
    tickOffer(h, STEP, false);
    assert.ok(h.nOffer >= 1);
    assert.ok(ai.choose(h));
  }
  assert.ok(h.nW <= MAX_WEAPONS && h.nP <= MAX_PASSIVES);
});
