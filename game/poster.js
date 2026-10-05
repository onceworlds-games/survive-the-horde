// Store art, drawn by the game itself: /index.html?poster=cover|action|win|icon|badge-<id>. No room, no SDK: one staged,
// deterministic frame from the real renderer (a fixed seed, the action frozen at its best moment), then
// document.body.dataset.ready = '1'.
import { Renderer, FONT } from './render.js';
import { UI } from './ui.js';
import { Effects } from './fx.js';
import { Game } from './game.js';
import { RHero, drainEvents } from './run.js';
import { mulberry32 } from './rng.js';
import { STEP, ID_MASK, HERO_COLORS } from './data.js';
import { A_RING, A_LIGHTNING, FXK_BOLT } from './combat.js';

const TAU = Math.PI * 2;
const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512] };

export async function renderPoster(name) {
  const rng = mulberry32(20261004);
  Math.random = rng; // every spark and wobble from here on is the same on every run
  try {
    await Promise.all([document.fonts.load('800 80px "Barlow Condensed"'), document.fonts.load('700 24px "Barlow Condensed"')]);
    await document.fonts.ready;
  } catch {
    /* the fallback face draws */
  }
  const badge = name.startsWith('badge-') ? name.slice(6) : null;
  const [w, h] = badge ? [256, 256] : (SIZES[name] ?? SIZES.cover);
  const canvas = document.getElementById('c');
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  document.body.style.margin = '0';
  document.body.style.background = '#000';
  const renderer = new Renderer(canvas);
  renderer.resize(w, h, 1);
  let info = {};
  if (badge) drawBadge(renderer.ctx, badge, w);
  else if (name === 'action') info = actionPoster(renderer, rng);
  else if (name === 'win') info = winPoster(renderer, rng);
  else if (name === 'icon') info = iconPoster(renderer, rng);
  else info = coverPoster(renderer, rng);
  document.body.dataset.info = JSON.stringify(info);
  document.body.dataset.ready = '1';
}

// ---------------------------------------------------------------- staging
function stage(seed, { ids, length = 300, weapons, T }) {
  const fx = new Effects();
  fx.setQuality('high', false);
  const g = new Game({ seed, length, ids, ai: false, solo: false, players: ids.length });
  const flashUntil = new Float32Array(ID_MASK + 1);
  g.world.T = T;
  g.world.ringIdx = Math.floor(T / 60);
  g.world.waveIdx = Math.floor(T / 30);
  ids.forEach((id, i) => {
    const hero = g.heroes[i];
    hero.godmode = true;
    weapons[i].forEach(([wi, lv]) => {
      hero.wl[wi] = lv;
    });
    hero.nW = hero.wl.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
    hero.level = 12 + i * 3;
    hero.hp = hero.maxHp;
  });
  g.hooks.hit = (hero, slot, amt, crit) => {
    const m = g.world.mon;
    flashUntil[m.id[slot] & ID_MASK] = 0.08;
    fx.hit(m.x[slot], m.y[slot], amt, crit, false);
  };
  const budget = { n: 14 };
  const st = { g, fx, flashUntil, budget, anim: 0 };
  return st;
}

function stepStage(st, seconds) {
  const g = st.g;
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    g.step(STEP);
    st.budget.n = 14;
    drainEvents(g.world, st.fx, null, st.budget);
    for (const f of g.fighters) f.fx.n = 0;
    for (const hh of g.heroes) hh.takeEvents();
    st.fx.update(STEP);
  }
}

/** Steps until `done(g)` is true (at most `max` seconds); returns whether it was. */
function stepUntil(st, max, done) {
  const n = Math.round(max / STEP);
  for (let i = 0; i < n; i++) {
    stepStage(st, STEP);
    if (done(st.g)) return true;
  }
  return false;
}

function rheroes(st, ids) {
  return st.g.heroes.map((h, i) => {
    const r = new RHero(ids[i], i);
    r.name = ids[i];
    r.isMe = true; // a ring, no name tag
    r.fromState(h, st.g.fighters[i]);
    r.bladeAng = st.g.fighters[i].bladeAng;
    r.wl[1] = h.wl[1];
    return r;
  });
}

function sceneFor(st, list, camX, camY, extra = {}) {
  st.fx.numbers.clear(); // store art has no numbers, only what the brief asks for
  return {
    quality: 'high', camX, camY, anim: 1.37, t: st.g.world.T, mon: st.g.world.mon, gem: st.g.world.gem, hiddenGem: null, heroes: list,
    nHeroes: list.length, fighters: st.g.fighters, fx: st.fx, flashUntil: st.flashUntil, focusX: list[0].x, darkness: 0.9, dawn: 0, crumble: 0,
    youArrow: 0, noBars: true, ...extra,
  };
}

/** A crowd on rings around (cx, cy). */
function horde(world, rng, cx, cy, count, inner, outer) {
  for (let k = 0; k < count; k++) {
    const f = (k + 0.5) / count;
    const r = inner + Math.sqrt(f) * (outer - inner);
    const a = k * 2.399963 + rng() * 0.3;
    const type = world.pickType();
    world.spawn(type, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.82, k % 23 === 0, 1, 1);
  }
}

function gemsAround(world, rng, cx, cy, n) {
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU;
    const r = 2 + rng() * 9;
    world.dropGem(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, i % 9 === 0 ? 2 : i % 3 === 0 ? 1 : 0);
  }
}

function titleOver(renderer, text1, text2) {
  const ctx = renderer.ctx;
  const { W, H } = renderer;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const gr = ctx.createLinearGradient(0, 0, 0, H * 0.46);
  gr.addColorStop(0, 'rgba(0,0,0,0.8)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H * 0.46);
  const ui = new UI();
  ui.layout(W, H);
  const big = 158;
  ctx.font = `800 ${big}px ${FONT}`;
  const gap = big * 0.28;
  const w1 = ctx.measureText(text1).width;
  const w2 = ctx.measureText(text2).width;
  let x = W / 2 - (w1 + gap + w2) / 2;
  const y = H * 0.16;
  ctx.save();
  ctx.transform(1, 0, -0.1, 1, y * 0.1, 0);
  ui.text(ctx, text1, x, y, big, { color: '#ffffff', strokeW: big * 0.09, align: 'left' });
  x += w1 + gap;
  ui.text(ctx, text2, x, y, big, { color: '#ff5a2e', strokeW: big * 0.09, align: 'left' });
  ctx.restore();
}

function coverPoster(renderer, rng) {
  const ids = ['p1'];
  const st = stage(11, {
    ids, T: 205, weapons: [[[0, 5], [1, 4], [2, 3], [3, 3], [4, 2]]],
  });
  const g = st.g;
  const hero = g.heroes[0];
  hero.x = 0;
  hero.y = 0;
  horde(g.world, rng, 0, 0, 390, 3.2, 17);
  gemsAround(g.world, rng, 0, 0, 70);
  // let the weapons carve for a while, then hold the frame with a ring pulse and lightning in the air
  stepStage(st, 1.2);
  stepUntil(st, 8, (gg) => {
    const f = gg.fighters[0];
    let ring = false;
    let bolt = false;
    for (let i = 0; i < f.an; i++) {
      if (f.akind[i] === A_RING && f.aage[i] > 0.1 && f.aage[i] < 0.25) ring = true;
      if (f.akind[i] === A_LIGHTNING && f.aage[i] < 0.14) bolt = true;
    }
    return ring && bolt;
  });
  // top the crowd up again and put bolts in the air
  horde(g.world, rng, 0, 0, Math.max(0, 399 - g.world.mon.n), 5.5, 17.5);
  for (let k = 0; k < 8; k++) {
    const a = 0.3 + k * 0.82;
    const r = 1.8 + (k % 4) * 1.2;
    g.fighters[0].spawnCosmetic(FXK_BOLT, Math.cos(a) * r, Math.sin(a) * r * 0.82, a, 0);
  }
  // gems on their way in
  for (let i = 0; i < 9; i++) st.fx.flyGem(Math.cos(i * 0.7) * 3.5, Math.sin(i * 0.7) * 3.0, i % 3, 0);
  for (let i = 0; i < st.fx.fn; i++) st.fx.fage[i] = 0.02 + (i / 9) * 0.14;
  const list = rheroes(st, ids);
  const sc = sceneFor(st, list, 0, -1.6);
  renderer.frame(sc);
  titleOver(renderer, 'SURVIVE', 'THE HORDE');
  return { monsters: g.world.mon.n, bolts: g.fighters[0].pn, areas: g.fighters[0].an, particles: st.fx.particles.n, gems: g.world.gem.n };
}

function actionPoster(renderer, rng) {
  const ids = ['p1', 'p2'];
  const st = stage(23, {
    ids, T: 250, weapons: [[[0, 5], [3, 3], [2, 2]], [[0, 4], [1, 3], [4, 2]]],
  });
  const g = st.g;
  g.heroes[0].x = -3.6;
  g.heroes[0].y = 2.2;
  g.heroes[1].x = -1.4;
  g.heroes[1].y = 3.8;
  g.heroes[0].dx = 1;
  g.heroes[1].dx = 1;
  const w = g.world;
  const slot = w.spawnBoss();
  w.mon.x[slot] = 5.2;
  w.mon.y[slot] = -0.6;
  w.mon.hp[slot] = w.mon.maxHp[slot] * 0.62;
  w.mon.hpf[slot] = 0.62;
  horde(w, rng, -1, 2, 60, 4.5, 14);
  gemsAround(w, rng, -2, 3, 25);
  stepStage(st, 0.4);
  stepUntil(st, 5, (gg) => gg.fighters[0].pn + gg.fighters[1].pn >= 7);
  const bossSlot = w.mon.boss;
  if (bossSlot >= 0) st.flashUntil[w.mon.id[bossSlot] & ID_MASK] = 0.08;
  const list = rheroes(st, ids);
  list[1].color = HERO_COLORS[1];
  renderer.ppu = 60;
  const sc = sceneFor(st, list, 1.4, 0.4, { focusX: 0, darkness: 0.85 });
  sc.focusX = -2;
  renderer.frame(sc);
  return { monsters: w.mon.n, boss: w.mon.boss >= 0 ? 1 : 0, bolts: g.fighters[0].pn + g.fighters[1].pn, particles: st.fx.particles.n };
}

function winPoster(renderer, rng) {
  const ids = ['p1', 'p2', 'p3'];
  const st = stage(31, {
    ids, T: 298.5, weapons: [[[0, 5], [1, 5], [2, 4]], [[0, 4], [3, 4], [5, 3]], [[0, 4], [4, 4], [6, 3]]],
  });
  const g = st.g;
  g.heroes[0].x = 0;
  g.heroes[0].y = 0.4;
  g.heroes[1].x = -3.4;
  g.heroes[1].y = 1.6;
  g.heroes[2].x = 3.2;
  g.heroes[2].y = 1.8;
  horde(g.world, rng, 0, 0, 300, 2.6, 15);
  gemsAround(g.world, rng, 0, 0, 20);
  // run into the dawn and stop while the horde is half gone
  stepUntil(st, 6, (gg) => gg.world.dawn && gg.world.mon.n < 150);
  const list = rheroes(st, ids);
  const sc = sceneFor(st, list, 0, -0.8, { darkness: 0.1, dawn: 1 });
  renderer.frame(sc);
  // the sun coming up over the trees
  const ctx = renderer.ctx;
  const { W, H } = renderer;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  const sun = ctx.createRadialGradient(W / 2, -H * 0.05, 0, W / 2, -H * 0.05, H * 0.95);
  sun.addColorStop(0, 'rgba(255,225,150,0.75)');
  sun.addColorStop(0.35, 'rgba(255,170,90,0.3)');
  sun.addColorStop(1, 'rgba(255,120,60,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(255,230,170,0.16)';
  ctx.lineWidth = 36;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2, -20);
    ctx.lineTo(W / 2 + i * W * 0.2, H);
    ctx.stroke();
  }
  return { monsters: g.world.mon.n, heroes: list.length, dawn: g.world.dawn ? 1 : 0, particles: st.fx.particles.n };
}

function iconPoster(renderer) {
  const ids = ['p1'];
  const st = stage(41, { ids, T: 120, weapons: [[[0, 3], [1, 3]]] });
  const g = st.g;
  const hero = g.heroes[0];
  hero.x = 0;
  hero.y = 0;
  hero.dx = 0.7;
  hero.dy = 0.35;
  const f = g.fighters[0];
  f.bladeAng = 0.5;
  stepStage(st, 0.01);
  f.bladeAng = 0.55;
  const list = rheroes(st, ids);
  list[0].bladeAng = 0.55;
  renderer.ppu = 70;
  const sc = sceneFor(st, list, 0, 0.1, { plain: ['#17394a', '#050a0e'], darkness: 0, mon: g.world.mon });
  sc.fighters = [];
  renderer.frame(sc);
  return { heroes: list.length };
}

// ---------------------------------------------------------------- badges: a bold symbol on a coloured disc
function disc(ctx, s, c0, c1, ring) {
  const r = s * 0.46;
  const gr = ctx.createLinearGradient(0, 0, s, s);
  gr.addColorStop(0, c0);
  gr.addColorStop(1, c1);
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, r, 0, TAU);
  ctx.fill();
  ctx.lineWidth = s * 0.035;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.lineWidth = s * 0.01;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, r - s * 0.045, 0, TAU);
  ctx.stroke();
}

function drawBadge(ctx, id, s) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, s, s);
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(0, 0, s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const k = s / 256;
  ctx.save();
  ctx.scale(k, k);
  const S = 256;
  const ink = '#0a0d14';
  if (id === 'dawn') {
    disc(ctx, S, '#3a2a6a', '#e0603a', '#ffd24a');
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.46 - 8, 0, TAU);
    ctx.clip();
    // rays and a half sun on the horizon
    ctx.strokeStyle = 'rgba(255,220,130,0.55)';
    ctx.lineWidth = 9;
    for (let i = 0; i < 9; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(S / 2 + Math.cos(a) * 50, 152 + Math.sin(a) * 50);
      ctx.lineTo(S / 2 + Math.cos(a) * 130, 152 + Math.sin(a) * 130);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(S / 2, 152, 46, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.fillStyle = '#1a1424';
    ctx.fillRect(0, 152, S, 120);
    ctx.fillStyle = '#2b1f3a';
    ctx.beginPath();
    ctx.moveTo(20, 152);
    for (let x = 20; x <= 236; x += 24) ctx.lineTo(x + 12, 128 + ((x / 24) % 2) * 14);
    ctx.lineTo(236, 152);
    ctx.fill();
    ctx.restore();
  } else if (id === 'boss-slayer') {
    disc(ctx, S, '#6a1620', '#1a0a12', '#ff4a3a');
    // a skull wearing a crown
    ctx.fillStyle = '#efe9d6';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(S / 2, 138, 56, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(S / 2 - 30, 168, 60, 38);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ink;
    for (const x of [-22, 22]) {
      ctx.beginPath();
      ctx.arc(S / 2 + x, 134, 14, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ff2a3a';
    for (const x of [-22, 22]) {
      ctx.beginPath();
      ctx.arc(S / 2 + x, 134, 5, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(S / 2, 150);
    ctx.lineTo(S / 2 - 7, 166);
    ctx.lineTo(S / 2 + 7, 166);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = ink;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(S / 2 + i * 11, 180);
      ctx.lineTo(S / 2 + i * 11, 204);
      ctx.stroke();
    }
    // the crown
    ctx.fillStyle = '#ffd24a';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(S / 2 - 52, 100);
    ctx.lineTo(S / 2 - 58, 52);
    ctx.lineTo(S / 2 - 28, 76);
    ctx.lineTo(S / 2, 40);
    ctx.lineTo(S / 2 + 28, 76);
    ctx.lineTo(S / 2 + 58, 52);
    ctx.lineTo(S / 2 + 52, 100);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff2a3a';
    for (const [x, y] of [[-58, 52], [0, 40], [58, 52]]) {
      ctx.beginPath();
      ctx.arc(S / 2 + x, y, 7, 0, TAU);
      ctx.fill();
    }
  } else if (id === 'level-30') {
    disc(ctx, S, '#145a52', '#08201e', '#ffd24a');
    // a laurel on each side
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const a = 1.95 + (i / 8) * 2.4; // along the left arc
        const ang = side < 0 ? a : Math.PI - a;
        const cx = S / 2 + Math.cos(ang) * 88;
        const cy = S / 2 + Math.sin(ang) * 88;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ang + Math.PI / 2 + side * 0.5);
        ctx.fillStyle = i % 2 ? '#7be05b' : '#a8f07a';
        ctx.strokeStyle = ink;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, 8, 17, 0, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.font = `800 118px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = ink;
    ctx.strokeText('30', S / 2, S / 2 + 6);
    ctx.fillStyle = '#ffd24a';
    ctx.fillText('30', S / 2, S / 2 + 6);
  } else if (id === 'thousand') {
    disc(ctx, S, '#4a5468', '#141a26', '#ff8a3a');
    // crossed swords
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(S / 2, S / 2 + 6);
      ctx.rotate(side * 0.78);
      ctx.fillStyle = '#e8edf5';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(0, -92);
      ctx.lineTo(13, -70);
      ctx.lineTo(13, 34);
      ctx.lineTo(-13, 34);
      ctx.lineTo(-13, -70);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#8d99ad';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -80);
      ctx.lineTo(0, 30);
      ctx.stroke();
      ctx.fillStyle = '#ffb23e';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.rect(-40, 34, 80, 14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#6b4a2a';
      ctx.beginPath();
      ctx.rect(-8, 48, 16, 36);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffb23e';
      ctx.beginPath();
      ctx.arc(0, 92, 11, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  } else {
    disc(ctx, S, '#2a3350', '#0e1220', '#ffd24a');
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 40, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
