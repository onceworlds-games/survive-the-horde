import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../game/sim.js';
import { Monsters } from '../game/field.js';
import { encodeMonsters, encodeGems, Snap, GemSnap, Interp } from '../game/snapshot.js';
import { MAX_MON, MAX_GEMS, T_SKEL, T_KNIGHT, T_BOSS, T_BAT, STEP } from '../game/data.js';

function crowd(n = MAX_MON) {
  const w = new World({ seed: 21, length: 300 });
  w.T = 250;
  w.ringIdx = 3;
  w.setHero(0, 0, 0, true);
  for (let i = 0; i < n; i++) {
    const a = i * 2.399;
    const r = 3 + (i % 40);
    w.spawn(i % 5, Math.cos(a) * r, Math.sin(a) * r, i % 7 === 0);
  }
  for (let i = 0; i < MAX_GEMS; i++) w.dropGem(Math.cos(i) * 20, Math.sin(i) * 20, i % 3);
  return w;
}

test('a full snapshot is small enough: 400 monsters and 320 gems well under the 16 KB value limit', () => {
  const w = crowd();
  w.spawnBoss();
  const m = encodeMonsters(w.mon);
  const g = encodeGems(w.gem);
  assert.ok(m.data.length < 6000, `monsters ${m.data.length}`);
  assert.ok(g.data.length < 4500, `gems ${g.data.length}`);
  assert.ok(m.data.length + g.data.length < 12000, 'under the 12 KB target together');
});

test('monsters survive the trip: ids, positions to a tenth, type, elite, health', () => {
  const w = crowd(120);
  w.hit(5, 3, 0, 0);
  const m = encodeMonsters(w.mon);
  const s = new Snap();
  assert.ok(s.load(12.5, m.data));
  assert.equal(s.n, w.mon.n);
  assert.equal(s.t, 12.5);
  for (let i = 0; i < w.mon.n; i++) {
    assert.equal(s.id[i], w.mon.id[i]);
    assert.ok(Math.abs(s.x[i] - w.mon.x[i]) <= 0.051);
    assert.ok(Math.abs(s.y[i] - w.mon.y[i]) <= 0.051);
    assert.equal(s.type[i], w.mon.type[i]);
    assert.equal(s.elite[i], w.mon.elite[i]);
    assert.ok(Math.abs(s.hpf[i] - w.mon.hpf[i]) <= 1 / 255 + 1e-6);
    assert.equal(s.idx[s.id[i]], i);
  }
  s.empty();
  assert.equal(s.n, 0);
  assert.equal(s.idx[w.mon.id[0]], -1);
});

test('dead monsters are not sent', () => {
  const w = crowd(10);
  w.hit(2, 1e9, 0, 0);
  const m = encodeMonsters(w.mon);
  assert.equal(m.n, 9);
});

test('gems survive the trip', () => {
  const w = crowd(0);
  const e = encodeGems(w.gem);
  const g = new GemSnap();
  assert.ok(g.load(3, e.data));
  assert.equal(g.n, w.gem.n);
  for (let i = 0; i < g.n; i++) {
    assert.equal(g.id[i], w.gem.id[i]);
    assert.equal(g.tier[i], w.gem.tier[i]);
    assert.ok(Math.abs(g.x[i] - w.gem.x[i]) <= 0.051);
  }
});

test('junk from the network is refused, not trusted', () => {
  const s = new Snap();
  assert.equal(s.load(1, 12345), false);
  assert.equal(s.load(NaN, 'AAAA'), false);
  assert.equal(s.load(1, '!!!not base64!!!'), false);
  assert.equal(s.n, 0);
  // a monster with an impossible type is skipped
  const bin = new Uint8Array(8);
  new DataView(bin.buffer).setInt16(6, 7, true); // type 7
  assert.ok(s.load(1, btoa(String.fromCharCode(...bin))));
  assert.equal(s.n, 0);
  const g = new GemSnap();
  assert.equal(g.load(1, null), false);
  assert.equal(g.load(1, 'x'.repeat(50000)), false);
});

test('playback interpolates between pictures about a tenth of a second late', () => {
  const w = new World({ seed: 1, length: 300 });
  w.setHero(0, 50, 50, true);
  const s = w.spawn(T_SKEL, 0, 0);
  const interp = new Interp();
  const view = new Monsters();
  const id = w.mon.id[s];
  // pictures every 1/12 s while the monster walks 1 unit per second to the right
  for (let k = 0; k < 6; k++) {
    w.mon.x[s] = k / 12;
    interp.push(k / 12, encodeMonsters(w.mon).data, 100 + k / 12);
  }
  // my clock 100.3: playback at 100.3 - offset(100) - 0.1 = 0.2 -> x = 0.2
  const n = interp.fill(view, 100.3, 0.1, 0.3, null);
  assert.equal(n, 1);
  assert.equal(view.id[0], id);
  assert.ok(Math.abs(view.x[0] - 0.2) < 0.06, `x ${view.x[0]}`);
  // later than the newest picture: it stands at the newest, it doesn't run off
  interp.fill(view, 105, 0.1, 5, null);
  assert.ok(Math.abs(view.x[0] - 5 / 12) < 0.06);
});

test('a monster missing from the next picture is a death at its last place, reported once', () => {
  const w = new World({ seed: 1, length: 300 });
  w.setHero(0, 50, 50, true);
  const a = w.spawn(T_SKEL, 3, 4);
  w.spawn(T_BAT, 8, 8);
  const interp = new Interp();
  const view = new Monsters();
  interp.push(0, encodeMonsters(w.mon).data, 10);
  w.hit(a, 1e9, 0, 0);
  interp.push(0.1, encodeMonsters(w.mon).data, 10.1);
  interp.fill(view, 10.12, 0.1, 0, null); // playback 0.02: window (0, 0.1)
  assert.equal(interp.dn, 1);
  assert.ok(Math.abs(interp.dx[0] - 3) < 0.06 && Math.abs(interp.dy[0] - 4) < 0.06);
  assert.equal(view.n, 1, 'only the survivor is drawn');
  interp.fill(view, 10.13, 0.1, 0, null);
  assert.equal(interp.dn, 0, 'the same window does not report it again');
});

test('hits this page already made hide a monster before the host confirms, and show no second death', () => {
  const w = new World({ seed: 1, length: 300 });
  w.setHero(0, 50, 50, true);
  const a = w.spawn(T_KNIGHT, 3, 4);
  w.spawn(T_SKEL, 9, 9);
  const id = w.mon.id[a];
  const interp = new Interp();
  const view = new Monsters();
  interp.push(0, encodeMonsters(w.mon).data, 10);
  interp.push(0.1, encodeMonsters(w.mon).data, 10.1);
  interp.hide[id] = 1;
  interp.fill(view, 10.12, 0.1, 0, null);
  const shown = [...view.dead.slice(0, view.n)];
  assert.ok(shown.includes(1), 'the predicted kill is flagged dead in the view');
  w.hit(a, 1e9, 0, 0);
  w.step(STEP);
  interp.push(0.2, encodeMonsters(w.mon).data, 10.2);
  interp.fill(view, 10.25, 0.1, 0, null); // playback 0.15: window (0.1, 0.2) where the monster is gone
  assert.equal(interp.dn, 0, 'no second burst for a death that was already shown');
  assert.equal(interp.hide[id], 0, 'the mark is gone once the picture caught up');
});

test('a host whose clock restarts (a new host) resets the playback instead of freezing it', () => {
  const w = new World({ seed: 1, length: 300 });
  w.setHero(0, 50, 50, true);
  w.spawn(T_SKEL, 1, 1);
  const interp = new Interp();
  for (let k = 0; k < 4; k++) interp.push(100 + k / 12, encodeMonsters(w.mon).data, 500 + k / 12);
  assert.ok(interp.push(20, encodeMonsters(w.mon).data, 501));
  assert.equal(interp.list.length, 1);
  assert.ok(!interp.push(20, encodeMonsters(w.mon).data, 501.01), 'a repeat is ignored');
});

test('the boss is found in the view', () => {
  const w = new World({ seed: 1, length: 300 });
  w.T = 250;
  w.setHero(0, 0, 0, true);
  w.spawnBoss();
  w.spawn(T_SKEL, 3, 3);
  const interp = new Interp();
  const view = new Monsters();
  interp.push(250, encodeMonsters(w.mon).data, 10);
  interp.fill(view, 10.5, 0.1, 250, null);
  assert.equal(view.n, 2);
  assert.ok(view.boss >= 0 && view.type[view.boss] === T_BOSS);
  assert.ok(view.dmg[view.boss] > 20);
  void STEP;
});
