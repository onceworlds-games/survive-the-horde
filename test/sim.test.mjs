import test from 'node:test';
import assert from 'node:assert/strict';
import { World, EV_KILL, EV_CRUMBLE, EV_BOSS } from '../game/sim.js';
import { MAX_MON, MAX_GEMS, ARENA_R, SPAWN_R, T_SKEL, T_BAT, T_KNIGHT, T_BOSS, T_GHOUL, T_SLIME, T_DUMMY, xpNeeded, STEP, FX_SLOW, FX_KNOCK } from '../game/data.js';

function world(opts = {}) {
  const w = new World({ seed: 7, length: 300, ...opts });
  w.setHero(0, 0, 0, true);
  return w;
}

function runWorld(w, seconds, hero = [0, 0]) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    w.clearHeroes();
    w.setHero(0, hero[0], hero[1], true);
    w.step(STEP);
    w.clearEvents();
  }
}

function consistent(w) {
  const m = w.mon;
  for (let i = 0; i < m.n; i++) {
    assert.ok(Number.isFinite(m.x[i]) && Number.isFinite(m.y[i]), 'finite position');
    assert.equal(w.idSlot[m.id[i] & 0x7fff], i, 'id table points at the slot');
  }
  for (let i = 0; i < w.gem.n; i++) assert.equal(w.gemSlot[w.gem.id[i] & 0x7fff], i, 'gem table points at the slot');
}

test('XP curve: 5, 10, 15 ... then 8% more per level after 20', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(xpNeeded), [5, 10, 15, 20, 25]);
  assert.equal(xpNeeded(20), 100);
  assert.equal(xpNeeded(21), 108);
  assert.equal(xpNeeded(22), Math.round(108 * 1.08));
  for (let l = 1; l < 120; l++) assert.ok(xpNeeded(l + 1) > xpNeeded(l), 'always growing');
});

test('spawn rate grows from about 1 a second to about 25 a second', () => {
  const rates = [];
  for (const T of [5, 135, 285]) {
    const w = world();
    w.T = T;
    w.waveIdx = Math.floor(T / 30);
    w.ringIdx = Math.floor(T / 60); // as if those rings had already come
    const before = w.nextId;
    // keep the hero far away from monsters so they don't matter: count what the director spawns in 10 seconds
    runWorld(w, 10);
    rates.push((w.nextId - before) / 10);
  }
  assert.ok(rates[0] > 0.6 && rates[0] < 1.6, `early rate ${rates[0]}`);
  assert.ok(rates[1] > rates[0] * 2, `mid rate ${rates[1]}`);
  assert.ok(rates[2] > 18 && rates[2] < 30, `late rate ${rates[2]}`);
});

test('the horde never passes the cap and everything stays inside the dark rim', () => {
  const w = world({ length: 300 });
  w.T = 250;
  runWorld(w, 40);
  assert.ok(w.mon.n <= MAX_MON, `alive ${w.mon.n}`);
  assert.ok(w.mon.n > 300, 'the field fills up when nobody kills anything');
  const lim = ARENA_R + SPAWN_R + 0.01;
  for (let i = 0; i < w.mon.n; i++) assert.ok(Math.hypot(w.mon.x[i], w.mon.y[i]) <= lim, 'inside the rim');
  consistent(w);
});

test('tougher monsters unlock over the night', () => {
  const kinds = (T) => {
    const w = world();
    w.T = T;
    const seen = new Set();
    for (let i = 0; i < 400; i++) seen.add(w.pickType());
    return seen;
  };
  const early = kinds(2);
  assert.ok(early.has(T_SKEL));
  assert.ok(!early.has(T_KNIGHT) && !early.has(T_GHOUL));
  const late = kinds(290);
  for (const t of [T_SKEL, T_BAT, T_SLIME, T_GHOUL, T_KNIGHT]) assert.ok(late.has(t), `type ${t} appears late`);
});

test('an elite ring closes in at each minute mark, the boss walks in for the last minute, dawn crumbles everything', () => {
  const w = world({ length: 300 });
  let rings = 0;
  let bossAt = -1;
  let dawnAt = -1;
  let crumbled = 0;
  for (let i = 0; i < 330 / STEP; i++) {
    w.clearHeroes();
    w.setHero(0, 0, 0, true);
    w.step(STEP);
    if (w.ringSpawned) rings++;
    if (w.bossSpawned && bossAt < 0) bossAt = w.T;
    if (w.dawn && dawnAt < 0) dawnAt = w.T;
    for (let e = 0; e < w.evN; e++) if (w.evKind[e] === EV_CRUMBLE) crumbled++;
    w.clearEvents();
    // keep the hero alive: this test is about the director
    if (w.cleared) break;
  }
  assert.equal(rings, 3, 'rings at 60, 120 and 180 (the boss takes the last minute)');
  assert.ok(bossAt >= 240 && bossAt < 241, `boss at ${bossAt}`);
  assert.ok(dawnAt >= 300 && dawnAt < 301, `dawn at ${dawnAt}`);
  assert.ok(w.cleared, 'every monster crumbled');
  assert.ok(crumbled > 100, `crumble events ${crumbled}`);
  assert.equal(w.bossState, 1);
});

test('a 10 minute night has eight rings and the boss at minute nine', () => {
  const w = world({ length: 600 });
  let rings = 0;
  let boss = -1;
  for (let i = 0; i < 590 / STEP; i++) {
    w.clearHeroes();
    w.setHero(0, 0, 0, true);
    w.step(STEP);
    if (w.ringSpawned) rings++;
    if (w.bossSpawned) boss = w.T;
    w.clearEvents();
  }
  assert.equal(rings, 8);
  assert.ok(boss >= 540 && boss < 541);
});

test('killing monsters drops gems, counts the kill for the hero that did it, and ids stay unique', () => {
  const w = world();
  const slot = w.spawn(T_SKEL, 3, 0);
  const id = w.mon.id[slot];
  assert.equal(w.hit(slot, 1, 0, 0), false);
  assert.ok(w.mon.hpf[slot] < 1);
  assert.equal(w.hit(slot, 1000, 0, 0), true);
  assert.equal(w.kills[0], 1);
  assert.equal(w.evN, 1);
  assert.equal(w.evKind[0], EV_KILL);
  assert.equal(w.hit(slot, 5, 0, 0), false, 'a dead monster takes no more');
  assert.equal(w.kills[0], 1);
  w.step(STEP);
  assert.equal(w.slotOf(id), -1, 'gone after the step');
  consistent(w);
  const ids = new Set();
  for (let i = 0; i < 300; i++) {
    const s = w.spawn(T_SKEL, i * 0.1, 5);
    if (s < 0) break;
    assert.ok(!ids.has(w.mon.id[s]));
    ids.add(w.mon.id[s]);
  }
});

test('a gem can be taken once; the cap makes the oldest richer instead of growing', () => {
  const w = world();
  w.dropGem(1, 1, 0);
  const id = w.gem.id[0];
  assert.equal(w.claimGem(id), 0);
  assert.equal(w.claimGem(id), -1, 'a second claim finds nothing');
  for (let i = 0; i < MAX_GEMS + 50; i++) w.dropGem(i * 0.1, 0, 0);
  assert.equal(w.gem.n, MAX_GEMS);
  assert.ok(w.gem.tier[0] >= 1, 'the oldest gem got richer');
  consistent(w);
});

test('slow and knockback effects land on the monster', () => {
  const w = world();
  const s = w.spawn(T_GHOUL, 4, 0);
  w.hit(s, 1, 0, FX_SLOW | (16 << 2));
  assert.ok(Math.abs(w.mon.slow[s] - 2) < 1e-6);
  const k = w.spawn(T_SKEL, 4, 0.1);
  w.hit(k, 1, 0, FX_KNOCK);
  assert.ok(w.mon.vx[k] > 0, 'pushed away from the hero');
});

test('the boss: big, tough, and its drops are purple', () => {
  const w = world();
  w.T = 250;
  const s = w.spawnBoss();
  assert.ok(s >= 0);
  assert.equal(w.mon.type[s], T_BOSS);
  assert.ok(w.mon.maxHp[s] > 1000);
  assert.ok(Math.hypot(w.mon.x[s], w.mon.y[s]) < ARENA_R);
  assert.equal(w.hit(s, 1e9, 0, 0), true);
  assert.equal(w.bossState, 2);
  assert.equal(w.bossKilledBy, 0);
  assert.equal(w.evKind[0], EV_BOSS);
  assert.equal(w.gem.n, 7);
  assert.ok([...w.gem.tier.slice(0, 7)].every((t) => t === 2));
});

test('the camp keeps training dummies that cannot be killed', () => {
  const w = new World({ seed: 3, camp: true });
  w.setHero(0, 0, 0, true);
  const s = w.addDummy(5, 0);
  assert.equal(w.mon.type[s], T_DUMMY);
  assert.equal(w.hit(s, 1e9, 0, 0), false);
  runWorld(w, 5);
  assert.equal(w.mon.n, 1, 'no horde in the camp');
  assert.equal(w.mon.x[0], 5, 'a dummy stands still');
});

test('restoring from a picture brings monsters, gems and counters back under the same ids', async () => {
  const { encodeMonsters, encodeGems, Snap, GemSnap } = await import('../game/snapshot.js');
  const a = world({ length: 300 });
  a.T = 100;
  runWorld(a, 20);
  a.T = a.T; // keep
  const em = encodeMonsters(a.mon);
  const eg = encodeGems(a.gem);
  const ms = new Snap();
  assert.ok(ms.load(a.T, em.data));
  const gs = new GemSnap();
  assert.ok(gs.load(a.T, eg.data));
  const b = new World({ seed: 99, length: 300 });
  b.restore(a.T, ms, gs, { ring: a.ringIdx, boss: a.bossState, nid: a.nextId, ngid: a.nextGem });
  assert.equal(b.mon.n, a.mon.n);
  assert.equal(b.T, a.T);
  assert.equal(b.ringIdx, a.ringIdx);
  for (let i = 0; i < a.mon.n; i++) {
    const j = b.slotOf(a.mon.id[i]);
    assert.ok(j >= 0, 'same id exists');
    assert.ok(Math.abs(b.mon.x[j] - a.mon.x[i]) < 0.06);
    assert.equal(b.mon.type[j], a.mon.type[i]);
  }
  consistent(b);
  runWorld(b, 5);
  consistent(b);
});
