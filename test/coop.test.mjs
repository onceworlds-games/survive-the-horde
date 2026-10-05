import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub } from './fakeroom.mjs';
import { Run, Camp } from '../game/run.js';
import { Effects } from '../game/fx.js';
import { STEP, MAX_MON } from '../game/data.js';
import { damageHero } from '../game/hero.js';

const DT = STEP;

class Page {
  constructor(hub, id) {
    this.hub = hub;
    this.room = hub.join(id, id.toUpperCase());
    this.fx = new Effects();
    this.fx.setQuality('high', false);
    this.calls = { badges: [], saves: [], callouts: [], finished: null, finishes: 0 };
    this.anim = 0;
    this.run = null;
    this.errors = [];
  }
  dispose() {
    this.run?.dispose();
  }
  env(saved = null) {
    return {
      room: this.room,
      fx: this.fx,
      sound: null,
      avatar: () => null,
      callout: (t) => this.calls.callouts.push(t),
      badge: (id) => this.calls.badges.push(id),
      save: (k, v) => this.calls.saves.push([k, v]),
      saved,
      now: () => this.hub.clock / 1000,
      finish: (res) => {
        this.calls.finished = res;
        this.calls.finishes++;
      },
    };
  }
  begin(saved) {
    this.run?.dispose();
    this.run = new Run(this.env(saved));
    return this.run;
  }
  frame(input) {
    this.anim += DT;
    this.run.frame(DT, input, this.anim, false);
    this.fx.update(DT);
  }
}

/** Runs all pages for `seconds`, each strafing in its own circle; picks cards at once. */
function play(hub, pages, seconds, opts = {}) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    hub.advance(DT * 1000);
    const t = hub.clock / 1000;
    pages.forEach((p, k) => {
      if (!p.run) return;
      const input = opts.input ? opts.input(p, k, t) : { x: Math.cos(t * 0.6 + k * 2), y: Math.sin(t * 0.8 + k) };
      p.frame(input);
      if (p.run.me && p.run.me.nOffer > 0 && opts.pick !== false) p.run.pick(0);
    });
  }
}

function setup(ids, settings) {
  const hub = new Hub(settings);
  const pages = ids.map((id) => new Page(hub, id));
  hub.start(ids);
  pages.forEach((p) => p.begin());
  return { hub, pages };
}

test('co-op: the host runs the horde, a second page sees it, fights it and is counted', () => {
  const { hub, pages } = setup(['a', 'b']);
  const [host, client] = pages;
  play(hub, pages, 70);
  assert.ok(host.run.game, 'the first page is the host');
  assert.equal(client.run.game, null, 'the second plays against pictures');
  assert.ok(client.run.interp.list.length > 0, 'pictures arrived');
  assert.ok(client.run.view.n > 5, `the client sees monsters (${client.run.view.n})`);
  assert.ok(Math.abs(client.run.T - host.run.T) < 1, `clocks agree (${client.run.T} vs ${host.run.T})`);
  // it fights: the host counted its kills
  const kills = host.run.game.world.kills;
  assert.ok(kills[0] > 5, `host kills ${kills[0]}`);
  assert.ok(kills[1] > 3, `the client's hits reached the host: ${kills[1]}`);
  assert.ok(client.run.me.level > 1 || client.run.me.xp > 0, 'the client collects gems');
  assert.ok(host.run.me.level > 1, 'the host levels');
  // presence both ways
  const seenB = host.run.rh[1];
  assert.ok(seenB.present, 'the host sees the client');
  assert.ok(Math.abs(seenB.x - client.run.me.x) < 0.5);
  const seenA = client.run.rh[0];
  assert.ok(seenA.present && Math.abs(seenA.x - host.run.me.x) < 0.5, 'the client sees the host');
  // the pictures stay inside the limits
  assert.ok(host.run.game.world.mon.n <= MAX_MON);
  const bytes = host.room.bytes / 70;
  assert.ok(bytes < 128 * 1024, `the host sends ${Math.round(bytes)} bytes a second (budget 131072)`);
  assert.ok(host.room.sent.messages / 70 < 60, 'messages per second under the budget');
});

test('co-op: the kills the client sees as gone are gone on the host, and gems are not taken twice', () => {
  const { hub, pages } = setup(['a', 'b']);
  const [host, client] = pages;
  play(hub, pages, 40);
  const w = host.run.game.world;
  const hostGems = new Set();
  for (let i = 0; i < w.gem.n; i++) hostGems.add(w.gem.id[i]);
  for (const id of client.run.claims) assert.ok(Number.isInteger(id));
  // everything the client has hidden locally is either gone on the host or about to be
  let stale = 0;
  for (let i = 0; i < client.run.gemSnap.n; i++) {
    const id = client.run.gemSnap.id[i];
    if (client.run.hiddenGem[id] && hostGems.has(id)) stale++;
  }
  assert.ok(stale < 40, `claims reach the host quickly (${stale} waiting)`);
});

test('a new host takes over from the room\'s last pictures without a reset', () => {
  const { hub, pages } = setup(['a', 'b']);
  const [host, client] = pages;
  play(hub, pages, 50);
  const before = host.run.game.world;
  const nBefore = before.mon.n;
  const tBefore = before.T;
  const kills = [...before.kills];
  // the host's page goes away
  hub.leave('a');
  host.run = null;
  play(hub, [client], 0.5);
  assert.ok(client.run.game, 'the client became the host');
  const w = client.run.game.world;
  assert.ok(Math.abs(w.T - tBefore) < 1.5, `night time carried on (${w.T} after ${tBefore})`);
  assert.ok(w.mon.n > nBefore * 0.6, `the horde carried on (${w.mon.n} vs ${nBefore})`);
  assert.deepEqual([...w.kills.slice(0, 2)].map((v, i) => v >= kills[i]), [true, true], 'kills were kept');
  assert.equal(client.room.state.g.by, 'b', 'the record names the new host');
  play(hub, [client], 20);
  assert.ok(client.run.game.world.T > tBefore + 15, 'and it goes on');
});

test('a reloaded page (a new Run on the same room) comes back with its checkpoint and sees the night', () => {
  const { hub, pages } = setup(['a', 'b']);
  const [host, client] = pages;
  play(hub, pages, 45);
  const lv = client.run.me.level;
  const saved = client.calls.saves.filter(([k]) => k === 'run').pop();
  assert.ok(saved, 'checkpoints were written');
  assert.equal(saved[1].mid, hub.match.id);
  client.run = null;
  const again = client.begin(saved[1]);
  assert.ok(again.me.level >= 1 && again.me.level <= lv + 1);
  assert.ok(again.me.level >= saved[1].lv, 'level restored');
  assert.ok(again.interp.list.length > 0, 'it took the pictures the room already had');
  play(hub, pages, 3);
  assert.ok(client.run.view.n > 0);
});

test('a lone host that reloads continues the same night from its own pictures', () => {
  const { hub, pages } = setup(['solo']);
  const p = pages[0];
  play(hub, pages, 40);
  const w = p.run.game.world;
  const T = w.T;
  const n = w.mon.n;
  const saved = p.calls.saves.filter(([k]) => k === 'run').pop();
  p.run = null;
  const again = p.begin(saved ? saved[1] : null);
  play(hub, pages, 1);
  assert.ok(again.game, 'host again');
  assert.ok(Math.abs(again.game.world.T - T) < 2.5, `T ${again.game.world.T} vs ${T}`);
  assert.ok(again.game.world.mon.n > n * 0.5 || n < 8);
});

test('a page that came late only watches: it sees the horde and the heroes, and has no hero of its own', () => {
  const hub = new Hub();
  const a = new Page(hub, 'a');
  const b = new Page(hub, 'b');
  const w = new Page(hub, 'w');
  hub.start(['a', 'b']);
  a.begin();
  b.begin();
  w.begin();
  assert.equal(w.run.watch, true);
  assert.equal(w.run.me, null);
  play(hub, [a, b, w], 40);
  assert.ok(w.run.view.n > 0, 'the watcher sees monsters');
  assert.ok(w.run.list.length === 2, 'and both heroes');
  const S = { mates: [] };
  w.run.hudFor(S);
  assert.ok(Number.isFinite(S.hp));
  assert.ok(w.run.followed());
  w.run.switchWatch();
  assert.ok(w.run.followed());
});

test('the night ends: dawn for everyone, the host ends the match when the results have been shown', () => {
  const { hub, pages } = setup(['a', 'b']);
  const [host, client] = pages;
  play(hub, pages, 5);
  host.run.game.world.T = 292;
  host.run.game.world.ringIdx = 4;
  host.run.game.world.bossState = 2;
  host.run.me.godmode = true;
  client.run.me.godmode = true;
  play(hub, pages, 14);
  const g = host.room.state.g;
  assert.equal(g.ph, 'over');
  assert.equal(g.res, 'dawn');
  assert.ok(Array.isArray(g.stats) && g.stats.length === 2);
  assert.ok(host.calls.finished && client.calls.finished, 'both pages got the result');
  assert.equal(host.calls.finished.result, 'dawn');
  assert.equal(client.calls.finished.rows.length, 2);
  assert.equal(host.calls.finishes, 1, 'once');
  assert.equal(hub.match.phase, 'playing', 'results are on screen, the match is not over yet');
  play(hub, pages, 14);
  assert.equal(hub.match.phase, 'lobby', 'the host ended the match');
});

test('everyone down is defeat, and a lone hero going down ends the night', () => {
  const { hub, pages } = setup(['a']);
  const p = pages[0];
  play(hub, pages, 3);
  damageHero(p.run.me, 10000);
  play(hub, pages, 3);
  assert.equal(p.room.state.g.ph, 'over');
  assert.equal(p.room.state.g.res, 'defeat');
  assert.equal(p.calls.finished.result, 'defeat');
  const co = setup(['a', 'b']);
  play(co.hub, co.pages, 3);
  damageHero(co.pages[1].run.me, 10000);
  play(co.hub, co.pages, 3);
  assert.notEqual(co.pages[0].room.state.g.ph, 'over', 'one down is not the end');
  assert.ok(co.pages[0].run.rh[1].down, 'the host sees the ghost');
  damageHero(co.pages[0].run.me, 10000);
  play(co.hub, co.pages, 3);
  assert.equal(co.pages[0].room.state.g.res, 'defeat');
});

test('junk messages and states from another page change nothing and throw nothing', () => {
  const { hub, pages } = setup(['a', 'b']);
  const [host, client] = pages;
  play(hub, pages, 5);
  const w = host.run.game.world;
  const n = w.mon.n;
  const fromB = client.room.players.get('b');
  for (const junk of [null, 5, 'x', [], { t: 'd' }, { t: 'd', rid: 'nope', h: [1, 5, 0] }, { t: 'd', rid: host.run.rid, h: 'no', f: 7 }, { t: 'd', rid: host.run.rid, h: [1.5, 'x', 0, -1, 5, 0, 99999, 1e9, 0, 3, NaN, 0], f: [0, NaN, 1, 1, 1, 99, 1, 1, 1, 1] }, { t: 'g', rid: host.run.rid, ids: 'zzz' }, { t: 'g', rid: host.run.rid, ids: [1.2, -1, 1e9, null] }]) {
    host.run.message(junk, fromB);
  }
  host.run.message({ t: 'd', rid: host.run.rid, h: [0, 5, 0] }, { id: 'stranger' });
  assert.ok(w.mon.n <= n + 4);
  client.run.takeState('sm', { mid: client.run.mid, t: 1e9, d: [], k: [], m: 5 });
  client.run.takeState('sm', null);
  client.run.takeState('sg', { mid: 'other', t: 1, g: 'AAAA' });
  play(hub, pages, 2);
});

test('the camp: walk, weapons on dummies, others shown, effects shared', () => {
  const hub = new Hub();
  const a = new Page(hub, 'a');
  const b = new Page(hub, 'b');
  const campA = new Camp({ room: a.room, fx: a.fx, sound: null, avatar: () => null });
  const campB = new Camp({ room: b.room, fx: b.fx, sound: null, avatar: () => null });
  let anim = 0;
  for (let i = 0; i < 60 * 8; i++) {
    anim += DT;
    hub.advance(DT * 1000);
    campA.frame(DT, { x: 0.3, y: 0 }, anim);
    campB.frame(DT, { x: -0.3, y: 0.2 }, anim);
  }
  assert.ok(campA.me.x > 3 && campB.me.x < -3, 'both walked');
  assert.equal(campA.list.length, 2, 'each sees the other');
  assert.ok(campB.list[1].present);
  assert.ok(campA.cos.pn + campA.cos.an >= 0);
  assert.equal(campA.game.world.mon.n, 5, 'five dummies, nothing else');
});
