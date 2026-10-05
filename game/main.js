// Survive the Horde: boot, screens, input and the frame loop. Rules and numbers live in the pure modules; the network
// part of a night is in run.js. See the README for the shape of it.
import { U_PASSIVE_BASE, N_WEAPONS, N_PASSIVES, xpNeeded } from './data.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { Effects } from './fx.js';
import { Sound } from './audio.js';
import { Run, Camp, Demo } from './run.js';
import { Gems } from './field.js';
import { upgradeLevel } from './hero.js';
import { createStubOw } from './stub.js';

// What the room is: a friends game, one to four players, the platform draws Ready and Start at the bottom.
const JOIN = {
  private: true,
  maxPlayers: 4,
  minPlayers: 1,
  lobby: 'bar',
  settings: [
    { id: 'length', label: 'Night', options: [{ value: 300, label: '5 min' }, { value: 600, label: '10 min' }], default: 300 },
    { id: 'hero', label: 'Mode', options: [{ value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }], default: 'normal' },
  ],
};

const posterName = new URLSearchParams(location.search).get('poster');

if (posterName) {
  const { renderPoster } = await import('./poster.js');
  await renderPoster(posterName);
} else {
  await main();
}

async function main() {
  const ow = window.onceworlds ?? createStubOw();
  const platform = !!window.onceworlds;
  try {
    ow.ui.setOrientation('landscape');
  } catch {
    /* desktop and the stub ignore it */
  }

  // ---------------------------------------------------------------- state
  let run = null;
  let camp = null;
  let results = null;
  let titleOpen = true;
  let lobbyHidden = false;
  let musicKey = -1;
  let audioOn = false;
  let anim = 0;
  let last = 0;
  let paused = false;
  let callout = null;
  let lastCount = -1;
  let goUntil = 0;
  let controlsMode = '';
  let errorAt = -10;
  let room = null;
  let skippedTitle = false;
  let closedReason = null;
  const listeners = { off: [] };
  let savedRun = null;
  let savedReady = false;
  let stats = { runs: 0, dawns: 0, bestTime: 0, bestKills: 0, bestLevel: 0, totalKills: 0 };
  const badges = new Set();
  const avatars = new Map();
  const keys = new Set();
  const wish = { x: 0, y: 0 };
  const S = {
    anim: 0, touch: false, settings: [], hint: 'MOVE. WEAPONS AUTO-FIRE.', canInvite: false, stubStart: false, count: 3, countFrac: 0,
    t: 0, length: 300, level: 1, xpFrac: 0, hp: 100, maxHp: 100, kills: 0, weapons: [], passives: [], mates: [], boss: null, callout: null,
    offer: { n: 0, ids: [0, 0, 0], levels: [0, 0, 0], timer: -1 }, down: false, res: null, solo: true, closedText: '', closedButton: '',
  };
  const slotPool = Array.from({ length: 12 }, () => ({ id: 0, lv: 0 }));

  // ---------------------------------------------------------------- join first, build later
  async function connect() {
    try {
      for (const off of listeners.off) off();
      listeners.off.length = 0;
      room = await ow.rooms.join(JOIN);
      closedReason = null;
      wire(room);
      if (run) run.dispose();
      if (camp) camp.dispose();
      run = null;
      camp = null;
      results = null;
      lobbyHidden = false;
    } catch (err) {
      console.error(err);
      closedReason = 'failed';
    }
  }
  await connect();

  const canvas = document.getElementById('c');
  const renderer = new Renderer(canvas);
  const ui = new UI();
  const fx = new Effects();
  const sound = new Sound();
  const demo = new Demo({ fx });
  const emptyGems = new Gems(8);

  try {
    document.fonts?.load('800 24px "Barlow Condensed"');
    document.fonts?.load('700 16px "Barlow Condensed"');
  } catch {
    /* the fallback face will do */
  }

  // ---------------------------------------------------------------- what we remember about the player
  Promise.resolve()
    .then(() => ow.save.get('stats'))
    .then((v) => {
      if (v && typeof v === 'object') stats = { ...stats, ...v };
    })
    .catch(() => {});
  // a reload mid-night restores the hero from its checkpoint: the night's page waits (a moment) for the lookup
  Promise.resolve()
    .then(() => ow.save.get('run'))
    .then((v) => {
      if (v && typeof v === 'object') savedRun = v;
    })
    .catch(() => {})
    .then(() => {
      savedReady = true;
    });
  setTimeout(() => {
    savedReady = true;
  }, 2500);

  function avatar(id) {
    let a = avatars.get(id);
    if (a) return a;
    a = new Image();
    a.crossOrigin = 'anonymous';
    avatars.set(id, a);
    Promise.resolve()
      .then(() => ow.player.avatarUrl(id, 'head'))
      .then((url) => {
        if (url) a.src = url;
      })
      .catch(() => {});
    return a;
  }

  function badge(id) {
    if (badges.has(id)) return;
    badges.add(id);
    Promise.resolve()
      .then(() => ow.badges.award(id))
      .catch(() => {});
  }

  function save(key, value) {
    Promise.resolve()
      .then(() => (value === null ? ow.save.delete(key) : ow.save.set(key, value)))
      .catch(() => {});
  }

  function showCallout(text, color, size) {
    callout = { text, color, size, age: 0, dur: 2.4 };
  }

  const nowSec = () => performance.now() / 1000;
  const env = { fx, sound, avatar, badge, save, callout: showCallout, now: nowSec, finish: onFinish };

  // ---------------------------------------------------------------- the room's events
  function wire(r) {
    const on = (event, fn) => listeners.off.push(r.on(event, fn));
    on('starting', () => {
      if (titleOpen) titleOpen = false;
      lastCount = -1;
      // friends may drop in to watch while the night plays
      if (r.isHost && !r.stub) r.setOpen(true);
    });
    on('matchstart', () => {
      goUntil = nowSec() + 0.9;
      showCallout('SURVIVE UNTIL DAWN', '#ffd36b', 50);
      if (audioOn) sound.count(0);
    });
    on('close', (reason) => {
      if (reason === 'moved' || reason === 'left') return;
      closedReason = reason;
    });
  }

  function onFinish(res, theRun) {
    results = { res, t: 0, hideAt: -1, delay: res.result === 'dawn' ? 3 : 1.6, again: false };
    if (audioOn) {
      if (res.result === 'dawn') sound.win();
      else sound.lose();
    }
    if (res.result === 'dawn') fx.flashAt(0.4, 19);
    if (res.watch) return;
    // one record per night: stats, badges and the board
    stats.runs++;
    stats.totalKills += res.kills;
    stats.bestKills = Math.max(stats.bestKills, res.kills);
    stats.bestLevel = Math.max(stats.bestLevel, res.level);
    if (res.result === 'dawn') {
      stats.dawns++;
      stats.bestTime = Math.max(stats.bestTime, res.time);
      badge('dawn');
      Promise.resolve()
        .then(() => ow.leaderboards.submit('dawns', stats.dawns))
        .catch(() => {});
    }
    save('stats', stats);
    save('run', null);
    void theRun;
  }

  // ---------------------------------------------------------------- input
  function setControls(mode) {
    if (mode === controlsMode) return;
    controlsMode = mode;
    try {
      ow.controls.set(mode === 'play' ? { stick: 'analog', zone: 'corner' } : null);
    } catch {
      /* no controls outside the platform */
    }
  }

  function music(level, loud) {
    const k = level * 2 + (loud ? 1 : 0);
    if (k === musicKey || !audioOn) return;
    musicKey = k;
    sound.setMusicLevel(level, loud);
  }

  function unlockAudio() {
    if (!audioOn) {
      audioOn = sound.unlock();
      musicKey = -1;
    } else sound.unlock();
  }

  function playPressed() {
    if (!titleOpen) return;
    titleOpen = false;
    unlockAudio();
    try {
      room.hideLobby(false);
      lobbyHidden = false;
    } catch {
      /* ok */
    }
    sound.select();
  }

  function cycleSetting(i) {
    const def = JOIN.settings[i];
    if (!def || !room.isHost || room.match.phase !== 'lobby') return;
    const cur = room.settings[def.id];
    const at = Math.max(0, def.options.findIndex((o) => o.value === cur));
    const next = def.options[(at + 1) % def.options.length].value;
    room.setSetting(def.id, next);
    sound.tick();
  }

  function activate(b) {
    switch (b.id) {
      case 'play':
        playPressed();
        break;
      case 'card':
        if (run && run.pick(b.i)) fx.flashAt(0.05, 17);
        break;
      case 'setting':
        cycleSetting(b.i);
        break;
      case 'invite':
        try {
          ow.ui.showInvite();
        } catch {
          /* ok */
        }
        break;
      case 'again':
        if (room.isHost) room.endMatch();
        break;
      case 'start':
        room.startMatch();
        break;
      case 'switch':
        if (run) run.switchWatch();
        break;
      case 'rejoin':
        connect();
        break;
      default:
        break;
    }
  }

  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    unlockAudio();
    if (MOVE_KEYS.has(e.code) || e.code === 'Space') e.preventDefault();
    if (MOVE_KEYS.has(e.code)) {
      keys.add(e.code);
      return;
    }
    if (e.repeat) return;
    if (closedReason) {
      if (e.code === 'Space' || e.code === 'Enter') connect();
      return;
    }
    if (titleOpen) {
      if (e.code === 'Space' || e.code === 'Enter') playPressed();
      return;
    }
    const digit = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : e.code.startsWith('Numpad') ? Number(e.code.slice(6)) : NaN;
    if (digit >= 1 && digit <= 3 && run && run.pick(digit - 1)) fx.flashAt(0.05, 17);
    else if (e.code === 'Enter' && results && room.isHost && room.match.phase === 'playing' && results.t >= results.delay) room.endMatch();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) keys.clear();
  });

  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  canvas.addEventListener('pointerdown', (e) => {
    unlockAudio();
    const p = pointerPos(e);
    const b = ui.hit(p.x, p.y);
    if (b) {
      e.preventDefault();
      activate(b);
    } else if (titleOpen && !closedReason) {
      // the whole title is a button: a tap anywhere starts
      playPressed();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointerPos(e);
    const b = ui.hit(p.x, p.y);
    ui.hover = b ? (b.id === 'card' ? `card${b.i}` : b.id) : '';
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  try {
    ow.on('pause', () => {
      paused = true;
    });
    ow.on('resume', () => {
      paused = false;
    });
  } catch {
    /* the stub has nothing to tell */
  }

  // ---------------------------------------------------------------- size and settings
  function applySettings() {
    fx.setQuality(ow.settings.quality, ow.settings.reducedMotion);
    sound.reduced = ow.settings.reducedMotion;
  }
  function resize() {
    const w = window.innerWidth || 640;
    const h = window.innerHeight || 360;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    renderer.resize(w, h, ow.settings.pixelRatio(2));
    ui.layout(renderer.W, renderer.H);
  }
  window.addEventListener('resize', resize);
  try {
    ow.settings.on('change', () => {
      applySettings();
      resize();
    });
  } catch {
    /* no settings outside the platform */
  }
  applySettings();
  resize();

  // ---------------------------------------------------------------- the camp and the night follow the room
  function startCamp() {
    if (camp) camp.dispose();
    camp = new Camp({ room, fx, sound, avatar });
    fx.clear();
  }

  function startRun() {
    titleOpen = false;
    results = null;
    if (camp) camp.dispose();
    camp = null;
    if (run) run.dispose();
    fx.clear();
    run = new Run({ ...env, room, saved: savedRun });
    savedRun = null;
  }

  function endRun() {
    if (run) run.dispose();
    run = null;
    if (results) results.hideAt = nowSec() + 6;
    fx.clear();
  }

  function reconcile() {
    const m = room.match;
    if (m.phase === 'playing') {
      if (!run || run.mid !== m.id) {
        if (!savedReady) return; // the checkpoint is still being read
        startRun();
      }
    } else {
      if (run) endRun();
      if (!camp) startCamp();
    }
    if (results && results.hideAt > 0 && nowSec() > results.hideAt) results = null;
  }

  // ---------------------------------------------------------------- the HUD's numbers
  function fillHud() {
    const f = run;
    f.hudFor(S);
    const me = f.me;
    const wl = me ? me.wl : f.followed()?.wl;
    let n = 0;
    S.weapons.length = 0;
    S.passives.length = 0;
    if (wl) {
      for (let i = 0; i < N_WEAPONS && n < 5; i++) {
        if (wl[i] > 0) {
          const slot = slotPool[n++];
          slot.id = i;
          slot.lv = wl[i];
          S.weapons.push(slot);
        }
      }
    }
    if (me) {
      let p = 0;
      for (let i = 0; i < N_PASSIVES && p < 5; i++) {
        if (me.pl[i] > 0) {
          const slot = slotPool[5 + p++];
          slot.id = U_PASSIVE_BASE + i;
          slot.lv = me.pl[i];
          S.passives.push(slot);
        }
      }
      S.xpFrac = me.xp / xpNeeded(me.level);
      const o = S.offer;
      o.n = me.nOffer;
      for (let i = 0; i < me.nOffer; i++) {
        o.ids[i] = me.offer[i];
        o.levels[i] = upgradeLevel(me, me.offer[i]);
      }
      o.timer = f.solo ? -1 : me.offerT / 8;
    } else {
      S.xpFrac = 0;
      S.offer.n = 0;
    }
    S.solo = f.solo;
  }

  // ---------------------------------------------------------------- the frame
  function wishVector() {
    let x = 0;
    let y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    try {
      const st = ow.controls.stick;
      x += st.x;
      y += st.y;
    } catch {
      /* no stick */
    }
    wish.x = x;
    wish.y = y;
    return wish;
  }

  function tick(dt) {
    anim += dt;
    S.anim = anim;
    S.touch = !!ow.controls.touch;
    const ctx = renderer.ctx;
    ui.begin();
    ctx.setTransform(renderer.pr, 0, 0, renderer.pr, 0, 0);
    fx.update(dt);
    if (callout) {
      callout.age += dt;
      if (callout.age >= callout.dur) callout = null;
    }
    S.callout = callout;
    S.closedText = closedReason === 'kicked' ? 'YOU WERE REMOVED' : closedReason === 'replaced' ? 'PLAYING IN ANOTHER TAB' : closedReason === 'failed' ? 'NO CONNECTION' : 'DISCONNECTED';
    S.closedButton = closedReason === 'disconnected' || closedReason === 'failed' ? 'REJOIN' : 'PLAY';

    if (closedReason || !room) {
      demo.frame(dt, anim);
      demo.scene.quality = ow.settings.quality;
      renderer.frame(demo.scene);
      ctx.setTransform(renderer.pr, 0, 0, renderer.pr, 0, 0);
      ui.closed(ctx, S);
      setControls('');
      return;
    }

    const phase = room.match.phase;
    if (titleOpen && phase !== 'lobby') titleOpen = false;
    if (!titleOpen) reconcile();

    if (titleOpen) {
      if (!lobbyHidden) {
        lobbyHidden = true;
        try {
          room.hideLobby(true);
        } catch {
          /* ok */
        }
      }
      demo.frame(dt, anim);
      demo.scene.quality = ow.settings.quality;
      renderer.frame(demo.scene);
      ctx.setTransform(renderer.pr, 0, 0, renderer.pr, 0, 0);
      ui.title(ctx, S);
      setControls('');
      music(0, false);
      return;
    }

    if (run) {
      const input = wishVector();
      const live = !run.watch;
      run.frame(dt, input, anim, paused && run.solo);
      run.scene.quality = ow.settings.quality;
      renderer.frame(run.scene);
      ctx.setTransform(renderer.pr, 0, 0, renderer.pr, 0, 0);
      fillHud();
      if (results) {
        results.t += dt;
        S.res = results.t >= results.delay ? { ...results.res, age: results.t - results.delay, again: room.isHost } : null;
      } else S.res = null;
      const showResults = S.res !== null;
      if (showResults) {
        ui.results(ctx, S);
        setControls('');
      } else {
        ui.hud(ctx, S);
        if (live && S.offer.n > 0) ui.cards(ctx, S);
        if (run.watch) {
          const f = run.followed();
          if (f) ui.watching(ctx, f.name || 'PLAYER', f.color);
        }
        setControls(live ? 'play' : '');
        if (skippedTitle && !audioOn) ui.tip(ctx, 'TAP FOR SOUND');
        const goLeft = goUntil - nowSec();
        if (goLeft > 0) {
          S.count = 0;
          S.countFrac = 1 - goLeft / 0.9;
          ui.countdown(ctx, S);
        }
      }
      music(showResults ? 0 : S.boss && S.boss.on ? 2 : 1, !showResults);
      return;
    }

    if (!run && !camp) {
      // still reading the checkpoint (a reload in the middle of a night): the quiet night behind, nothing else
      demo.frame(dt, anim);
      demo.scene.quality = ow.settings.quality;
      renderer.frame(demo.scene);
      return;
    }

    // the camp, and the countdown over it
    if (camp) {
      camp.frame(dt, wishVector(), anim);
      const sc = campScene();
      renderer.frame(sc);
      ctx.setTransform(renderer.pr, 0, 0, renderer.pr, 0, 0);
      const editable = room.isHost && phase === 'lobby';
      S.settings.length = 0;
      S.settings.push({ label: 'NIGHT', value: room.settings.length === 600 ? '10 MIN' : '5 MIN', editable, id: 'length' });
      S.settings.push({ label: 'MODE', value: room.settings.hero === 'hard' ? 'HARD' : 'NORMAL', editable, id: 'hero' });
      S.canInvite = platform && room.kind === 'private' && room.players.size < 4;
      S.stubStart = !!room.stub && phase === 'lobby';
      if (phase === 'starting') {
        const left = Math.max(0, (room.match.startsAt - ow.now()) / 1000);
        const n = Math.max(1, Math.min(3, Math.ceil(left)));
        S.count = n;
        S.countFrac = Math.min(1, Math.max(0, n - left));
        if (n !== lastCount) {
          lastCount = n;
          if (audioOn) sound.count(n);
        }
        ui.countdown(ctx, S);
      } else {
        lastCount = -1;
        ui.lobby(ctx, S);
      }
      if (results) {
        results.t += dt;
        S.res = { ...results.res, age: 1, again: false };
        ui.results(ctx, S);
      }
      setControls(results ? '' : 'play');
      music(0, false);
    }
  }

  const campCache = {
    quality: 'high', camX: 0, camY: 0, anim: 0, t: 0, mon: null, gem: emptyGems, hiddenGem: null, heroes: null, nHeroes: 0, fighters: [],
    fx, flashUntil: null, focusX: 0, darkness: 0.5, dawn: 0, crumble: 0, youArrow: 0,
  };
  function campScene() {
    const sc = campCache;
    sc.quality = ow.settings.quality;
    sc.camX = camp.camX + fx.shake.x;
    sc.camY = camp.camY + fx.shake.y;
    sc.anim = anim;
    sc.mon = camp.game.world.mon;
    sc.heroes = camp.list;
    sc.nHeroes = camp.list.length;
    sc.fighters.length = 0;
    sc.fighters.push(camp.fighter, camp.cos);
    sc.flashUntil = camp.flashUntil;
    sc.focusX = camp.me.x;
    sc.youArrow = 0;
    return sc;
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    const now = ts / 1000;
    const dt = Math.min(0.1, Math.max(0, now - (last || now)));
    last = now;
    try {
      tick(dt);
    } catch (err) {
      // a slip in one frame must not stop the game; report it, at most every few seconds
      console.error(err);
      if (now - errorAt > 4) {
        errorAt = now;
        setTimeout(() => {
          throw err;
        }, 0);
      }
    }
  }
  requestAnimationFrame(loop);

  // a page that loads in the middle of a night skips the title
  if (room && room.match.phase !== 'lobby') {
    titleOpen = false;
    skippedTitle = true;
  }
}
