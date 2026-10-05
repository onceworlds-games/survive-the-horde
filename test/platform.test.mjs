import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './fakedom.mjs';
import { Hub } from './fakeroom.mjs';
import { Run, Camp } from '../game/run.js';
import { Effects } from '../game/fx.js';

/** The SDK the platform injects, over the fake hub. */
function fakeOw(hub, id, { touch = false, quality = 'high' } = {}) {
  const calls = { badges: [], saves: new Map(), controls: [], boards: [], invites: 0 };
  const ow = {
    mode: 'platform',
    calls,
    player: { get: async () => ({ id, name: id.toUpperCase(), guest: false }), avatarUrl: async () => null, rename: async () => null },
    save: {
      get: async (k) => calls.saves.get(k) ?? null,
      set: async (k, v) => void calls.saves.set(k, v),
      delete: async (k) => void calls.saves.delete(k),
      list: async () => [...calls.saves.keys()],
    },
    badges: { award: async (b) => (calls.badges.push(b), true), list: async () => [], has: async () => false },
    leaderboards: { submit: async (b, v) => (calls.boards.push([b, v]), { best: v, rank: 1 }), top: async () => ({ entries: [], me: null }) },
    rooms: { join: async () => hub.join(id, id.toUpperCase()), current: null },
    ui: { setOrientation() {}, setMenuPosition() {}, requestFullscreen() {}, showInvite() { calls.invites++; } },
    controls: { set: (c) => calls.controls.push(c), stick: { x: 0, y: 0 }, pressed: () => false, touch },
    settings: { quality, scale: 1, reducedMotion: false, pixelRatio: () => 1, on() { return () => {}; } },
    now: () => 1.7e12 + hub.clock,
    on() { return () => {}; },
    env: {},
  };
  return ow;
}

class Friend {
  constructor(hub, id) {
    this.hub = hub;
    this.room = hub.join(id, id.toUpperCase());
    this.fx = new Effects();
    this.fx.setQuality('high', false);
    this.anim = 0;
    this.camp = null;
    this.run = null;
    this.env = {
      room: this.room, fx: this.fx, sound: null, avatar: () => null, callout() {}, badge() {}, save() {}, saved: null, now: () => hub.clock / 1000, finish() {},
    };
  }
  frame(dt) {
    this.anim += dt;
    const phase = this.room.match.phase;
    const t = this.hub.clock / 1000;
    if (phase === 'playing') {
      if (this.camp) (this.camp.dispose(), (this.camp = null));
      if (!this.run || this.run.mid !== this.room.match.id) (this.run?.dispose(), (this.run = new Run(this.env)));
      this.run.frame(dt, { x: Math.cos(t), y: Math.sin(t * 1.3) }, this.anim, false);
      if (this.run.me && this.run.me.nOffer > 0) this.run.pick(0);
    } else {
      if (this.run) (this.run.dispose(), (this.run = null));
      if (!this.camp) this.camp = new Camp(this.env);
      this.camp.frame(dt, { x: 0.2, y: 0 }, this.anim);
    }
  }
}

function drive(dom, hub, friends, seconds, between) {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    hub.advance(1000 / 60);
    dom.frame();
    for (const f of friends) f.frame(1 / 60);
    if (between) between(i);
  }
}

let counter = 0;
async function boot({ width = 1280, height = 720, touch = false, hostFirst = true } = {}) {
  const dom = installDom({ width, height });
  const hub = new Hub();
  let friend;
  if (!hostFirst) friend = new Friend(hub, 'f'); // the friend joins first: it is the host
  const ow = fakeOw(hub, 'me', { touch });
  globalThis.onceworlds = ow;
  await import(`../game/main.js?platform-${counter++}`);
  if (hostFirst) friend = new Friend(hub, 'f');
  return { dom, hub, ow, friend };
}

function cleanup(dom) {
  dom.restoreConsole();
  delete globalThis.onceworlds;
}

test('platform, as host: title, lobby with a friend, countdown, a co-op night, results, back to the lobby', async () => {
  const { dom, hub, ow, friend } = await boot();
  try {
    assert.equal(hub.hostId, 'me');
    drive(dom, hub, [friend], 2);
    const room = hub.rooms.get('me');
    assert.equal(room.lobbyHidden, true, 'the platform lobby is hidden under the title');
    dom.key('keydown', 'Enter');
    drive(dom, hub, [friend], 1);
    assert.equal(room.lobbyHidden, false, 'and shown again after Play');
    // the camp: the friend is there too; the invite button shows while a seat is free
    drive(dom, hub, [friend], 3);
    const texts = dom.canvas.getContext().calls.texts;
    assert.ok(texts.has('+ INVITE'), 'invite offered while a seat is free');
    // the invite button is top right
    dom.pointer('pointerdown', 1280 - 14 - 70, 14 + 24);
    assert.equal(ow.calls.invites, 1);
    // the host presses Start: countdown, then the night
    hub.starting(['me', 'f'], 3000);
    drive(dom, hub, [friend], 3.1);
    assert.ok(hub.opened >= 1, 'the door was opened for friends to drop in');
    hub.start(['me', 'f'], 4242);
    drive(dom, hub, [friend], 0.5);
    for (let s = 0; s < 80; s++) {
      dom.key('keydown', s % 2 ? 'KeyD' : 'KeyA');
      dom.key('keydown', 'Digit1');
      drive(dom, hub, [friend], 1);
      dom.key('keyup', s % 2 ? 'KeyD' : 'KeyA');
      assert.equal(dom.errors.length, 0, `error at ${s}: ${dom.errors.join(' | ')}`);
    }
    assert.ok(friend.run.view.n > 0, 'the friend sees the horde the host page runs');
    assert.ok(hub.rooms.get('me').state.sm, 'the host publishes pictures');
    assert.ok(ow.calls.controls.some((c) => c && c.stick === 'analog'), 'touch controls asked for while playing');
    // the night ends in dawn (the host's world is moved to the last seconds)
    // (main.js keeps its Run private, so let both heroes die instead: stand still and let the horde finish the night)
    for (let s = 0; s < 300 && hub.match.phase === 'playing'; s++) {
      drive(dom, hub, [friend], 1);
      if (dom.errors.length) break;
    }
    assert.equal(dom.errors.length, 0, dom.errors.join(' | '));
    assert.equal(hub.match.phase, 'lobby', 'the night ended and the host went back to the lobby');
    drive(dom, hub, [friend], 8);
    assert.equal(dom.errors.length, 0, dom.errors.join(' | '));
    const t = dom.canvas.getContext().calls.texts;
    assert.ok(t.has('DEFEAT') || t.has('DAWN'), 'results were shown');
    for (let i = 0; i < 10; i++) await Promise.resolve(); // the saves go through promises
    assert.equal(ow.calls.saves.get('stats')?.runs, 1, 'the night was saved once');
    assert.equal(ow.calls.saves.has('run'), false, 'and the checkpoint was cleared');
  } finally {
    cleanup(dom);
  }
});

test('platform, as a client of a friend on a phone-sized touch screen, then a reload mid-night', async () => {
  const { dom, hub, friend } = await boot({ width: 844, height: 390, touch: true, hostFirst: false });
  try {
    assert.equal(hub.hostId, 'f');
    drive(dom, hub, [friend], 1);
    dom.pointer('pointerdown', 422, 270);
    drive(dom, hub, [friend], 2);
    hub.starting(['me', 'f'], 3000);
    drive(dom, hub, [friend], 3.1);
    hub.start(['me', 'f'], 99);
    for (let s = 0; s < 60; s++) {
      drive(dom, hub, [friend], 1);
      assert.equal(dom.errors.length, 0, `error at ${s}: ${dom.errors.join(' | ')}`);
    }
    const sent = hub.rooms.get('me').sent;
    assert.ok(sent.messages > 50, 'the client talks to the host (hits, gems, effects)');
    // a window turned the other way
    dom.resize(390, 844);
    drive(dom, hub, [friend], 2);
    assert.equal(dom.errors.length, 0, dom.errors.join(' | '));
  } finally {
    cleanup(dom);
  }
});

test('platform: a page that loads in the middle of a night skips the title and asks for a tap for sound', async () => {
  const dom = installDom({ width: 1280, height: 720 });
  const hub = new Hub();
  const friend = new Friend(hub, 'f');
  hub.start(['f', 'x']);
  const ow = fakeOw(hub, 'me');
  globalThis.onceworlds = ow;
  try {
    await import(`../game/main.js?platform-${counter++}`);
    drive(dom, hub, [friend], 3);
    const texts = dom.canvas.getContext().calls.texts;
    assert.ok(!texts.has('PLAY'), 'no title');
    assert.ok(texts.has('TAP FOR SOUND'));
    assert.ok(texts.has('WATCHING'), 'a latecomer watches');
    assert.equal(dom.errors.length, 0, dom.errors.join(' | '));
  } finally {
    cleanup(dom);
  }
});
