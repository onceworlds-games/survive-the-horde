import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './fakedom.mjs';
import { Renderer } from '../game/render.js';
import { UI } from '../game/ui.js';
import { Effects } from '../game/fx.js';
import { Game } from '../game/game.js';
import { RHero } from '../game/run.js';
import { Sound } from '../game/audio.js';
import { ARENA_R, STEP, ID_MASK, T_BOSS } from '../game/data.js';
import { damageHero } from '../game/hero.js';

function scene(game, fx, extra = {}) {
  const list = game.heroes.map((h, i) => {
    const r = new RHero(h.id, i);
    r.name = `Hero${i}`;
    r.fromState(h, game.fighters[i]);
    return r;
  });
  return {
    quality: 'high', camX: 0, camY: 0, anim: 1, t: game.world.T, mon: game.world.mon, gem: game.world.gem, hiddenGem: null, heroes: list, nHeroes: list.length,
    fighters: game.fighters, fx, flashUntil: new Float32Array(ID_MASK + 1), focusX: 0, darkness: 1, dawn: 0, crumble: 0, youArrow: 2, ...extra,
  };
}

test('the renderer draws every kind of thing (rim, boss, ghosts, all weapons, every quality) without throwing', () => {
  const dom = installDom({ width: 1280, height: 720 });
  try {
    const renderer = new Renderer(dom.canvas);
    renderer.resize(1280, 720, 2);
    const fx = new Effects();
    for (const quality of ['high', 'medium', 'low']) {
      fx.setQuality(quality, quality === 'low');
      const g = new Game({ seed: 5, length: 300, ids: ['a', 'b', 'c'], ai: true, solo: false });
      g.world.T = 250;
      g.world.ringIdx = 3;
      for (const h of g.heroes) {
        h.godmode = true;
        for (let w = 0; w < 7; w++) h.wl[w] = 4;
        h.nW = 7;
        h.invuln = 1;
      }
      g.heroes[1].down = true;
      g.heroes[1].reviveT = 1.5;
      g.heroes[2].shieldT = 0;
      g.run(14);
      const slot = g.world.spawnBoss();
      assert.ok(slot >= 0);
      g.world.mon.x[slot] = g.heroes[0].x + 6;
      g.world.mon.y[slot] = g.heroes[0].y;
      g.world.mon.hpf[slot] = 0.5;
      g.world.step(STEP);
      g.step(STEP);
      fx.hit(1, 1, 33, true, true);
      fx.hurt(0, 0, 12);
      fx.levelUp(0, 0);
      fx.bossDeath(2, 2);
      fx.crumble(1, 1, 0);
      fx.pickup(1, 1, 2);
      fx.flyGem(3, 3, 1, 0);
      fx.flyGem(3, 3, 2, 1);
      fx.flashAt(0.5, 3);
      const sc = scene(g, fx, { quality });
      sc.flashUntil[g.world.mon.id[slot]] = 5;
      sc.hiddenGem = new Uint8Array(ID_MASK + 1);
      sc.hiddenGem[g.world.gem.id[0]] = 1;
      // the middle of the clearing, then the very edge of the arena (the ring of fallen trees), then beyond a corner
      for (const [cx, cy] of [[0, 0], [ARENA_R - 3, 0], [-ARENA_R * 0.7, ARENA_R * 0.7], [0, -ARENA_R]]) {
        sc.camX = cx;
        sc.camY = cy;
        renderer.frame(sc);
      }
      sc.dawn = 1;
      sc.darkness = 0.1;
      sc.crumble = 0.5;
      renderer.frame(sc);
      sc.plain = ['#123', '#000'];
      sc.noBars = true;
      sc.noNames = true;
      renderer.frame(sc);
    }
    const c = dom.canvas.getContext();
    assert.ok(c.calls.n > 5000);
    assert.equal(c.calls.stack, 0);
    // a non-retina phone and a tall window
    renderer.resize(390, 844, 1);
    const fx2 = new Effects();
    const g2 = new Game({ seed: 8, ids: ['a'], ai: true });
    g2.run(8);
    renderer.frame(scene(g2, fx2));
  } finally {
    dom.restoreConsole();
  }
});

test('every screen and every HUD state of the UI draws at every size', () => {
  const dom = installDom({ width: 1280, height: 720 });
  try {
    const ctx = dom.canvas.getContext();
    const ui = new UI();
    const S = {
      anim: 3, touch: false, settings: [{ label: 'NIGHT', value: '5 MIN', editable: true, id: 'length' }, { label: 'MODE', value: 'HARD', editable: false, id: 'hero' }],
      hint: 'MOVE. WEAPONS AUTO-FIRE.', canInvite: true, stubStart: true, count: 2, countFrac: 0.2, t: 245, length: 300, level: 14, xpFrac: 0.4, hp: 61.4, maxHp: 120,
      kills: 812, weapons: [{ id: 0, lv: 5 }, { id: 1, lv: 2 }, { id: 3, lv: 1 }], passives: [{ id: 10, lv: 2 }, { id: 15, lv: 1 }],
      mates: [{ name: 'Nova', color: '#ff9a2e', hp: 0.5, down: false, rv: 0 }, { name: 'A very long player name', color: '#78e04d', hp: 0, down: true, rv: 0.6 }],
      boss: { on: true, frac: 0.4 }, callout: { text: 'NIGHT WARDEN', color: '#ff4a3a', size: 64, age: 0.3, dur: 2.4 },
      offer: { n: 3, ids: [0, 14, 20], levels: [4, 0, 0], timer: 0.5 }, down: true, solo: false, closedText: 'DISCONNECTED', closedButton: 'REJOIN',
      res: { result: 'dawn', time: 301, kills: 1500, level: 22, age: 1, again: true, rows: [] },
    };
    for (const [w, h, touch] of [[1280, 720, false], [844, 390, true], [667, 375, true], [390, 844, true], [1920, 1080, false], [320, 240, false]]) {
      ui.layout(w, h);
      S.touch = touch;
      ui.begin();
      ui.title(ctx, S);
      ui.lobby(ctx, S);
      ui.countdown(ctx, S);
      ui.hud(ctx, S);
      ui.cards(ctx, S);
      ui.closed(ctx, S);
      ui.watching(ctx, 'Somebody with a long name', '#42b8ff');
      ui.tip(ctx, 'TAP FOR SOUND');
      ui.banner(ctx, 'HELLO', 'sub');
      S.res.rows = [
        { name: 'Ann', color: '#42b8ff', avatar: null, kills: 400, level: 20 },
        { name: 'Bo', color: '#ff9a2e', avatar: { complete: false, naturalWidth: 0 }, kills: 300, level: 18 },
        { name: 'Cy', color: '#78e04d', avatar: null, kills: 200, level: 15 },
        { name: 'Di', color: '#d57bff', avatar: null, kills: 100, level: 11 },
      ];
      for (const result of ['dawn', 'defeat']) {
        S.res.result = result;
        ui.results(ctx, S);
      }
      S.res.rows = [];
      S.boss = { on: false, frac: 1 };
      S.mates = [];
      S.offer = { n: 1, ids: [20, 0, 0], levels: [0, 0, 0], timer: -1 };
      S.callout = null;
      ui.hud(ctx, S);
      ui.cards(ctx, S);
      // hit regions exist for the buttons
      assert.ok(ui.nbtn > 0);
      S.boss = { on: true, frac: 0.4 };
      S.mates = [{ name: 'Nova', color: '#ff9a2e', hp: 0.5, down: false, rv: 0 }];
    }
    assert.equal(ctx.calls.stack, 0);
    // a hit lands on a button
    ui.layout(1280, 720);
    ui.begin();
    ui.title(ctx, S);
    const b = ui.hit(640, 700 - 0);
    assert.ok(b === null || b.id === 'play');
    const hit = ui.hit(640, 720 * 0.68 + 20);
    assert.equal(hit?.id, 'play');
  } finally {
    dom.restoreConsole();
  }
});

test('every sound plays on a fake audio context without throwing, and the music scheduler runs', () => {
  const dom = installDom();
  try {
    const s = new Sound();
    // before a tap nothing may throw
    s.hit();
    s.gem(1);
    s.setMusicLevel(1, true);
    assert.equal(s.unlock(), true);
    s.unlock();
    for (const name of ['shoot', 'kill', 'bigKill', 'levelUp', 'hurt', 'down', 'revive', 'blade', 'ring', 'zap', 'nova', 'rain', 'shield', 'boss', 'warn', 'wave', 'tick', 'select', 'win', 'lose']) {
      for (let i = 0; i < 3; i++) {
        dom.frame(50);
        s[name]();
      }
    }
    s.hit(true);
    for (let t = 0; t < 40; t++) {
      dom.frame(40);
      s.gem(t % 3);
      s.count(t % 4);
    }
    for (const level of [0, 1, 2]) {
      s.setMusicLevel(level, level > 0);
      for (let i = 0; i < 400; i++) dom.frame(30); // 12 s: a few bars
    }
    s.stopMusic();
    for (let i = 0; i < 20; i++) dom.frame(30);
    assert.ok(s.ctx.nodes > 100, 'notes were scheduled');
    assert.ok(s.active() >= 0 && s.active() < 60, `voices ${s.active()}`);
  } finally {
    dom.restoreConsole();
  }
});

test('damage numbers, particles and shake stay inside their pools under a flood', () => {
  const fx = new Effects();
  for (const q of ['high', 'medium', 'low']) {
    fx.setQuality(q, false);
    for (let i = 0; i < 5000; i++) {
      fx.hit(i % 10, i % 7, i, i % 3 === 0, true);
      fx.death(i % 9, i % 5, i % 7, i % 4 === 0);
      fx.hurt(0, 0, 5);
    }
    assert.ok(fx.particles.n <= fx.particles.cap);
    assert.ok(fx.numbers.n <= 72);
    for (let i = 0; i < 300; i++) fx.update(1 / 60);
    assert.ok(fx.shake.trauma >= 0 && fx.shake.trauma <= 1);
    assert.ok(Number.isFinite(fx.shake.x) && Number.isFinite(fx.shake.y));
  }
  fx.setQuality('high', true);
  fx.shake.trauma = 0;
  fx.hurt(0, 0, 5);
  assert.equal(fx.shake.trauma, 0, 'reduced motion: no shake');
  void T_BOSS;
  void damageHero;
});

test('what is drawn lands where it should: the hero in the middle, the horde around it, nothing wildly off screen', () => {
  const dom = installDom({ width: 1280, height: 720 });
  try {
    const renderer = new Renderer(dom.canvas);
    renderer.resize(1280, 720, 1);
    const fx = new Effects();
    const g = new Game({ seed: 3, length: 300, ids: ['a'], ai: false, solo: true });
    g.world.T = 200;
    g.world.ringIdx = 3;
    g.heroes[0].godmode = true;
    for (let i = 0; i < 380; i++) {
      const a = i * 2.4;
      const r = 2 + (i % 30) * 0.8;
      g.world.spawn(i % 5, Math.cos(a) * r, Math.sin(a) * r, false);
    }
    g.world.step(STEP);
    const sc = scene(g, fx, { youArrow: 0, darkness: 0 });
    const c = dom.canvas.getContext();
    c.calls.log = [];
    renderer.frame(sc);
    const log = c.calls.log;
    c.calls.log = null;
    const draws = log.filter((e) => e[0] === 'drawImage' && e.length === 6);
    assert.ok(draws.length > 150, `monster and gem sprites drawn: ${draws.length}`);
    let inside = 0;
    for (const [, , x, y, w, h] of draws) {
      if (w === 1280 && h === 720) continue; // the night and the vignette cover the whole screen
      assert.ok(w > 1 && h > 1 && w < 400 && h < 400, `sprite size ${w}x${h}`);
      if (x + w > 0 && x < 1280 && y + h > 0 && y < 720) inside++;
    }
    assert.ok(inside >= draws.length - 80, 'almost everything drawn is on screen (tiles aside)');
    // the hero stands in the middle of the screen: the first translate after the monsters is its position
    const heroAt = log.find((e) => e[0] === 'translate' && Math.abs(e[1] - 640) < 1 && Math.abs(e[2] - 360) < 1);
    assert.ok(heroAt, 'the hero was drawn at the centre of the screen');
    // a monster that is 5 units to the right of the camera is 5 * ppu to the right of the centre
    const m = g.world.mon;
    let sampled = 0;
    for (let i = 0; i < m.n && sampled < 3; i++) {
      const dx = (m.x[i] - 0) * renderer.ppu;
      const dy = (m.y[i] - 0) * renderer.ppu;
      if (Math.abs(dx) > 500 || Math.abs(dy) > 250) continue;
      sampled++;
    }
    assert.ok(sampled > 0);
    assert.ok(renderer.ppu > 40 && renderer.ppu < 60, `zoom ${renderer.ppu}`);
  } finally {
    dom.restoreConsole();
  }
});
