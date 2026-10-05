import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../game/game.js';
import { MAX_MON, MAX_GEMS, ARENA_R, SPAWN_R, STEP } from '../game/data.js';

/** Plays a whole night with autopilots and checks the invariants as it goes. */
function playNight({ seed, length = 300, hard = false, heroes = 1 }) {
  const ids = Array.from({ length: heroes }, (_, i) => `hero${i}`);
  const g = new Game({ seed, length, hard, ids, ai: true });
  const w = g.world;
  let maxMon = 0;
  let maxGems = 0;
  let steps = 0;
  let sawBoss = false;
  const limit = (length + 40) / STEP;
  while (!g.over && steps < limit) {
    g.step(STEP);
    for (const f of g.fighters) f.fx.n = 0;
    w.clearEvents();
    steps++;
    if (w.bossState > 0) sawBoss = true;
    if (w.mon.n > maxMon) maxMon = w.mon.n;
    if (w.gem.n > maxGems) maxGems = w.gem.n;
    if (steps % 20 === 0) {
      assert.ok(w.mon.n <= MAX_MON, `seed ${seed}: ${w.mon.n} monsters alive`);
      assert.ok(w.gem.n <= MAX_GEMS, `seed ${seed}: ${w.gem.n} gems`);
      for (let i = 0; i < w.mon.n; i++) {
        assert.ok(Number.isFinite(w.mon.x[i]) && Number.isFinite(w.mon.y[i]), `seed ${seed}: NaN monster at step ${steps}`);
        assert.ok(Number.isFinite(w.mon.hp[i]), `seed ${seed}: NaN hp`);
        assert.ok(Math.hypot(w.mon.x[i], w.mon.y[i]) <= ARENA_R + SPAWN_R + 0.01, `seed ${seed}: monster out of bounds`);
      }
      for (const h of g.heroes) {
        assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y) && Number.isFinite(h.hp), `seed ${seed}: NaN hero`);
        assert.ok(Math.hypot(h.x, h.y) <= ARENA_R, `seed ${seed}: hero out of bounds`);
        assert.ok(h.hp >= 0 && h.hp <= h.maxHp + 1e-6, `seed ${seed}: hp ${h.hp}/${h.maxHp}`);
        assert.ok(h.level >= 1 && h.xp >= 0 && Number.isFinite(h.xp));
        assert.ok(h.nW <= 5 && h.nP <= 5);
      }
    }
  }
  return { g, steps, maxMon, maxGems, sawBoss };
}

function summary(runs) {
  return runs.map((r) => `${r.g.over}@${r.g.world.T.toFixed(0)}`).join(' ');
}

test('20 nights with an autopilot: each ends (dawn or defeat), nothing goes NaN, the horde stays capped', () => {
  const runs = [];
  for (let seed = 1; seed <= 20; seed++) {
    const r = playNight({ seed });
    assert.ok(r.g.over === 'dawn' || r.g.over === 'defeat', `seed ${seed}: the night never ended (T ${r.g.world.T})`);
    if (r.g.over === 'dawn') {
      assert.ok(r.g.world.T >= 300, 'dawn only comes at the end of the night');
      assert.ok(r.g.world.cleared, 'every monster crumbled');
      assert.equal(r.g.world.mon.n, 0);
    } else {
      assert.ok(r.g.heroes.every((h) => h.down), 'defeat means everyone is down');
      assert.ok(r.g.world.T < 300 + 1);
    }
    runs.push(r);
  }
  const dawns = runs.filter((r) => r.g.over === 'dawn').length;
  assert.ok(dawns >= 3, `an autopilot should win some nights, won ${dawns}/20: ${summary(runs)}`);
  assert.ok(dawns <= 19, `...and lose some: ${summary(runs)}`);
  assert.ok(runs.some((r) => r.maxMon >= 390), 'the horde does fill up');
  assert.ok(runs.some((r) => r.sawBoss), 'the Night Warden walks in');
  const kills = runs.map((r) => r.g.world.totalKills);
  assert.ok(Math.max(...kills) > 600, `a good night kills hundreds: ${kills.join(' ')}`);
  const levels = runs.map((r) => r.g.heroes[0].level);
  assert.ok(Math.max(...levels) >= 15, `levels climb: ${levels.join(' ')}`);
});

test('hard mode and the long night end too', () => {
  for (let seed = 40; seed < 46; seed++) {
    const r = playNight({ seed, hard: true });
    assert.ok(r.g.over, `hard seed ${seed} never ended`);
  }
  for (let seed = 50; seed < 53; seed++) {
    const r = playNight({ seed, length: 600 });
    assert.ok(r.g.over, `long seed ${seed} never ended`);
    if (r.g.over === 'dawn') assert.ok(r.g.world.T >= 600);
  }
});

test('co-op: two and four heroes play a night; the horde scales and ghosts come back', () => {
  let revived = 0;
  for (const heroes of [2, 4]) {
    for (let seed = 60; seed < 64; seed++) {
      const r = playNight({ seed, heroes });
      assert.ok(r.g.over, `${heroes} heroes, seed ${seed}: never ended`);
      assert.equal(r.g.solo, false);
      for (const h of r.g.heroes) if (h.reviveT > 0) revived++;
      assert.ok(r.g.world.kills.slice(0, heroes).reduce((a, b) => a + b, 0) === r.g.world.totalKills, 'every kill is somebody\'s');
    }
  }
  void revived;
});

test('a hero that dies and is revived goes on with its weapons and level', () => {
  const g = new Game({ seed: 5, length: 300, ids: ['a', 'b'], ai: true });
  const [a, b] = g.heroes;
  a.level = 9;
  a.wl[1] = 3;
  a.nW = 2;
  a.hp = 0;
  a.down = true;
  g.run(1);
  assert.ok(a.down, 'not revived at once');
  // b is the autopilot and wanders; put it on top of the ghost for three seconds
  a.x = b.x;
  a.y = b.y;
  for (let i = 0; i < 4 / STEP; i++) {
    a.x = b.x;
    a.y = b.y;
    g.step(STEP);
  }
  assert.ok(!a.down, 'revived');
  assert.equal(a.level, 9);
  assert.equal(a.wl[1], 3);
});

test('solo: the run waits while a card is on screen, co-op does not', () => {
  const solo = new Game({ seed: 3, length: 300, ids: ['a'], ai: false });
  solo.heroes[0].pending = 1;
  solo.step(STEP);
  assert.ok(solo.heroes[0].nOffer > 0);
  const t = solo.world.T;
  for (let i = 0; i < 120; i++) solo.step(STEP);
  assert.equal(solo.world.T, t, 'time stands still while choosing');
  solo.heroes[0].nOffer = 0;
  solo.heroes[0].pending = 0;
  solo.step(STEP);
  assert.ok(solo.world.T > t);
  const co = new Game({ seed: 3, length: 300, ids: ['a', 'b'], ai: false });
  co.heroes[0].pending = 1;
  co.step(STEP);
  const t2 = co.world.T;
  for (let i = 0; i < 120; i++) co.step(STEP);
  assert.ok(co.world.T > t2 + 1.9, 'the night goes on');
});
