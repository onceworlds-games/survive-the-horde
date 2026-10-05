// Draws the world: the dark forest clearing, gems, monsters, heroes, weapons, effects and the night. Canvas 2D, no
// allocation per frame (typed arrays, counting sorts, cached canvases). The HUD is in ui.js.
import { ARENA_R, MAX_MON, ID_MASK, BLADES, T_BOSS, T_DUMMY, T_KNIGHT, MON_R, W_BLADES, BOSS_ART } from './data.js';
import { hash2 } from './rng.js';
import { SpriteSet, newCanvas } from './sprites.js';
import { drawMonster, drawShadow, drawHero, setWhite, hexA } from './art.js';
import {
  A_RING, A_LIGHTNING, A_RAIN, A_NOVA, A_WAVE, bladePos, easeOut,
} from './combat.js';
import { PAL, K_DOT, K_SPARK, K_RING, K_GLOW, numText, N_CRIT, N_HURT, N_HEAL } from './fx.js';

const TILE = 8; // world units per ground tile
const HERO_SCALE = 0.5; // world units per hero art unit
const TAU = Math.PI * 2;
const FONT = '"Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
export { FONT };

const fract = (v) => v - Math.floor(v);
const rnd = (seed) => fract(Math.sin(seed * 12.9898) * 43758.5453);

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.W = 640;
    this.H = 360;
    this.pr = 1;
    this.ppu = 40;
    this.sprites = new SpriteSet();
    this.tile = null;
    this.tilePx = 0;
    this.dark = null;
    this.darkCtx = null;
    this.vig = null;
    this.red = null;
    this.lightDot = null;
    this.order = new Int32Array(MAX_MON + 24);
    this.keys = new Int16Array(MAX_MON + 24);
    this.counts = new Int32Array(514);
    this.quality = 'high';
    this.faceR = new Uint8Array(ID_MASK + 1).fill(1);
    this.camX = 0;
    this.camY = 0;
    this.view = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.seed = 7;
  }

  /** Sizes the canvas to the window (css pixels) at the pixel ratio `pr`, and works out the zoom. */
  resize(w, h, pr) {
    this.W = Math.max(64, Math.floor(w));
    this.H = Math.max(64, Math.floor(h));
    this.pr = Math.max(0.5, pr);
    this.cv.width = Math.round(this.W * this.pr);
    this.cv.height = Math.round(this.H * this.pr);
    const half = Math.sqrt(this.W * this.W + this.H * this.H) / 2;
    this.ppu = Math.min(80, Math.max(Math.min(this.W / 26, this.H / 14.5), half / 17));
    this.sprites.ensure(this.ppu * this.pr);
    this.tilePx = 0; // rebuilt on the next frame
    this.dark = null;
    this.vig = null;
    this.red = null;
  }

  // ---------------------------------------------------------------- cached layers
  ensureTile() {
    const px = Math.max(128, Math.min(1024, Math.round(TILE * this.ppu * this.pr)));
    if (this.tile && Math.abs(px - this.tilePx) < 8) return;
    this.tilePx = px;
    const c = newCanvas(px, px);
    const g = c.getContext('2d');
    this.tile = c;
    if (!g) return;
    const S = px;
    g.fillStyle = '#0f1a14';
    g.fillRect(0, 0, S, S);
    const at = (x, y, r, fn) => {
      // draw at every wrap offset the element touches, so the tile repeats seamlessly
      for (let ox = -1; ox <= 1; ox++) {
        // a copy shifted right is needed only if the element spills over the left edge, and so on
        if ((ox === 1 && x - r >= 0) || (ox === -1 && x + r <= S)) continue;
        for (let oy = -1; oy <= 1; oy++) {
          if ((oy === 1 && y - r >= 0) || (oy === -1 && y + r <= S)) continue;
          fn(x + ox * S, y + oy * S);
        }
      }
    };
    let s = 11;
    const R = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    // soft patches of lighter and darker moss
    for (let i = 0; i < 46; i++) {
      const x = R() * S;
      const y = R() * S;
      const r = (0.04 + R() * 0.1) * S;
      const light = R() > 0.45;
      at(x, y, r, (ax, ay) => {
        const gr = g.createRadialGradient(ax, ay, 0, ax, ay, r);
        gr.addColorStop(0, light ? 'rgba(54,84,52,0.30)' : 'rgba(4,10,8,0.38)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(ax - r, ay - r, r * 2, r * 2);
      });
    }
    // fine grain
    for (let i = 0; i < Math.round(S * 1.3); i++) {
      const x = R() * S;
      const y = R() * S;
      const sz = Math.max(1, Math.round((0.5 + R() * 1.6) * this.pr));
      g.fillStyle = R() > 0.5 ? 'rgba(120,170,110,0.10)' : 'rgba(0,0,0,0.22)';
      at(x, y, sz, (ax, ay) => g.fillRect(ax, ay, sz, sz));
    }
    // fallen leaves and twigs
    for (let i = 0; i < 70; i++) {
      const x = R() * S;
      const y = R() * S;
      const a = R() * TAU;
      const l = (0.012 + R() * 0.02) * S;
      g.strokeStyle = R() > 0.5 ? 'rgba(80,60,36,0.35)' : 'rgba(70,100,60,0.3)';
      g.lineWidth = Math.max(1, 1.2 * this.pr);
      at(x, y, l, (ax, ay) => {
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(ax + Math.cos(a) * l, ay + Math.sin(a) * l);
        g.stroke();
      });
    }
  }

  ensureOverlays() {
    const { W, H } = this;
    if (!this.lightDot) {
      const c = newCanvas(48, 48);
      const g = c.getContext('2d');
      if (g) {
        const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
        gr.addColorStop(0, 'rgba(0,0,0,1)');
        gr.addColorStop(0.5, 'rgba(0,0,0,0.5)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, 48, 48);
      }
      this.lightDot = c;
    }
    if (!this.dark) {
      const dw = Math.max(32, Math.ceil(W / 4));
      const dh = Math.max(32, Math.ceil(H / 4));
      this.dark = newCanvas(dw, dh);
      this.darkCtx = this.dark.getContext('2d');
    }
    if (!this.vig) {
      const c = newCanvas(Math.max(64, Math.ceil(W / 2)), Math.max(64, Math.ceil(H / 2)));
      const g = c.getContext('2d');
      if (g) {
        const cx = c.width / 2;
        const cy = c.height / 2;
        const gr = g.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.55, cx, cy, Math.hypot(cx, cy) * 1.02);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(0.7, 'rgba(0,0,0,0.30)');
        gr.addColorStop(1, 'rgba(0,0,0,0.72)');
        g.fillStyle = gr;
        g.fillRect(0, 0, c.width, c.height);
      }
      this.vig = c;
      const r = newCanvas(Math.max(64, Math.ceil(W / 4)), Math.max(64, Math.ceil(H / 4)));
      const rg = r.getContext('2d');
      if (rg) {
        const cx = r.width / 2;
        const cy = r.height / 2;
        const gr = rg.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.5, cx, cy, Math.hypot(cx, cy));
        gr.addColorStop(0, 'rgba(255,20,30,0)');
        gr.addColorStop(1, 'rgba(255,20,30,0.85)');
        rg.fillStyle = gr;
        rg.fillRect(0, 0, r.width, r.height);
      }
      this.red = r;
    }
  }

  // ---------------------------------------------------------------- the frame
  /** Draws one frame of the world described by `scene` (see main.js). */
  frame(scene) {
    const ctx = this.ctx;
    const { W, H, pr, ppu } = this;
    this.quality = scene.quality || 'high';
    this.camX = scene.camX;
    this.camY = scene.camY;
    const halfW = W / 2 / ppu;
    const halfH = H / 2 / ppu;
    this.view.x0 = scene.camX - halfW - 1;
    this.view.x1 = scene.camX + halfW + 1;
    this.view.y0 = scene.camY - halfH - 1;
    this.view.y1 = scene.camY + halfH + 1;
    this.sprites.ensure(ppu * pr);
    this.ensureTile();
    this.ensureOverlays();

    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#070c0a';
    ctx.fillRect(0, 0, W, H);

    if (scene.plain) this.drawPlain(scene);
    else this.drawGround(scene);
    this.drawGems(scene);
    this.drawAreas(scene);
    this.drawEntities(scene);
    this.drawWeaponsAbove(scene);
    this.drawFlyingGems(scene);
    this.drawParticles(scene);
    this.drawNumbers(scene);
    this.drawNight(scene);
    this.drawNames(scene);
    this.drawScreenFx(scene);
  }

  /** world -> css pixels */
  sx(x) {
    return (x - this.camX) * this.ppu + this.W / 2;
  }
  sy(y) {
    return (y - this.camY) * this.ppu + this.H / 2;
  }

  /** Switches ctx to world units (1 = one unit, y down) around the camera. */
  worldSpace() {
    const { pr, ppu, W, H } = this;
    this.ctx.setTransform(pr * ppu, 0, 0, pr * ppu, pr * (W / 2 - this.camX * ppu), pr * (H / 2 - this.camY * ppu));
  }
  screenSpace() {
    this.ctx.setTransform(this.pr, 0, 0, this.pr, 0, 0);
  }

  // ---------------------------------------------------------------- ground
  drawGround(scene) {
    const ctx = this.ctx;
    const { W, H, ppu } = this;
    const size = Math.ceil(TILE * ppu) + 1;
    // tile edges sit at world multiples of TILE
    const wx0 = Math.floor((this.camX - W / 2 / ppu) / TILE);
    const wy0 = Math.floor((this.camY - H / 2 / ppu) / TILE);
    const wx1 = Math.floor((this.camX + W / 2 / ppu) / TILE);
    const wy1 = Math.floor((this.camY + H / 2 / ppu) / TILE);
    this.screenSpace();
    for (let ty = wy0; ty <= wy1; ty++) {
      for (let tx = wx0; tx <= wx1; tx++) {
        ctx.drawImage(this.tile, Math.floor(this.sx(tx * TILE)), Math.floor(this.sy(ty * TILE)), size, size);
      }
    }
    this.drawDecor(scene);
    this.drawRim(scene);
  }

  /** A plain backdrop (the icon): a deep radial colour instead of the forest. */
  drawPlain(scene) {
    const ctx = this.ctx;
    const { W, H } = this;
    this.screenSpace();
    const gr = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.75);
    gr.addColorStop(0, scene.plain[0]);
    gr.addColorStop(1, scene.plain[1]);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  }

  drawDecor(scene) {
    const ctx = this.ctx;
    const CELL = 5;
    const cx0 = Math.floor(this.view.x0 / CELL);
    const cx1 = Math.floor(this.view.x1 / CELL);
    const cy0 = Math.floor(this.view.y0 / CELL);
    const cy1 = Math.floor(this.view.y1 / CELL);
    const low = this.quality === 'low';
    this.worldSpace();
    ctx.lineCap = 'round';
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const h = hash2(cx, cy, 3);
        const px = (cx + hash2(cx, cy, 11)) * CELL;
        const py = (cy + hash2(cx, cy, 12)) * CELL;
        if (px * px + py * py > (ARENA_R + 1) * (ARENA_R + 1)) continue;
        if (h < 0.3) {
          // a stone with a lit edge
          const s = 0.35 + hash2(cx, cy, 13) * 0.7;
          ctx.beginPath();
          ctx.ellipse(px, py + s * 0.18, s * 1.1, s * 0.4, 0, 0, TAU);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(px, py, s, s * 0.72, hash2(cx, cy, 14) * 0.6 - 0.3, 0, TAU);
          ctx.fillStyle = '#39413f';
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(px - s * 0.18, py - s * 0.2, s * 0.62, s * 0.4, -0.3, 0, TAU);
          ctx.fillStyle = '#4c5755';
          ctx.fill();
          ctx.lineWidth = 0.05;
          ctx.strokeStyle = 'rgba(8,12,12,0.8)';
          ctx.beginPath();
          ctx.ellipse(px, py, s, s * 0.72, hash2(cx, cy, 14) * 0.6 - 0.3, 0, TAU);
          ctx.stroke();
        } else if (h < 0.72) {
          // a tuft of grass
          const blades = 4 + ((hash2(cx, cy, 15) * 3) | 0);
          ctx.strokeStyle = h < 0.5 ? '#24432b' : '#2d5233';
          ctx.lineWidth = 0.07;
          ctx.beginPath();
          for (let b = 0; b < blades; b++) {
            const a = -0.9 + (b / (blades - 1)) * 1.8;
            const len = 0.5 + hash2(cx, cy, 20 + b) * 0.5;
            ctx.moveTo(px, py);
            ctx.quadraticCurveTo(px + Math.sin(a) * len * 0.4, py - len * 0.6, px + Math.sin(a) * len, py - len * Math.cos(a * 0.8));
          }
          ctx.stroke();
        } else if (h < 0.8 && !low) {
          // glowing mushrooms
          for (let m = 0; m < 3; m++) {
            const mx = px + (hash2(cx, cy, 30 + m) - 0.5) * 1.1;
            const my = py + (hash2(cx, cy, 33 + m) - 0.5) * 0.6;
            const r = 0.12 + hash2(cx, cy, 36 + m) * 0.1;
            ctx.fillStyle = 'rgba(70,200,180,0.16)';
            ctx.beginPath();
            ctx.arc(mx, my - r * 0.5, r * 3.2, 0, TAU);
            ctx.fill();
            ctx.fillStyle = '#d8f2e6';
            ctx.fillRect(mx - r * 0.2, my - r * 0.4, r * 0.4, r * 1.1);
            ctx.beginPath();
            ctx.ellipse(mx, my - r * 0.5, r * 1.1, r * 0.7, 0, Math.PI, TAU);
            ctx.fillStyle = '#4fd3b9';
            ctx.fill();
          }
        } else if (h < 0.86) {
          // old bones
          ctx.strokeStyle = 'rgba(210,205,180,0.55)';
          ctx.lineWidth = 0.1;
          const a = hash2(cx, cy, 40) * TAU;
          ctx.beginPath();
          ctx.moveTo(px - Math.cos(a) * 0.4, py - Math.sin(a) * 0.4);
          ctx.lineTo(px + Math.cos(a) * 0.4, py + Math.sin(a) * 0.4);
          ctx.stroke();
          ctx.fillStyle = 'rgba(210,205,180,0.55)';
          ctx.beginPath();
          ctx.arc(px + Math.cos(a) * 0.4, py + Math.sin(a) * 0.4, 0.09, 0, TAU);
          ctx.arc(px - Math.cos(a) * 0.4, py - Math.sin(a) * 0.4, 0.09, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  /** The edge of the arena: the dark forest beyond a ring of fallen trees. */
  drawRim(scene) {
    const cr = Math.hypot(this.camX, this.camY);
    const viewR = Math.hypot(this.W, this.H) / 2 / this.ppu + 2;
    if (cr + viewR < ARENA_R - 1) return;
    const ctx = this.ctx;
    this.worldSpace();
    // everything outside the ring goes dark
    const v = this.view;
    ctx.beginPath();
    ctx.rect(v.x0 - 2, v.y0 - 2, v.x1 - v.x0 + 4, v.y1 - v.y0 + 4);
    ctx.moveTo(ARENA_R + 0.4, 0);
    ctx.arc(0, 0, ARENA_R + 0.4, 0, TAU, true);
    ctx.fillStyle = '#04080a';
    ctx.fill();
    // canopy shapes in the dark
    const NT = 150;
    for (let i = 0; i < NT; i++) {
      const a = (i / NT) * TAU + hash2(i, 1, 5) * 0.03;
      const r = ARENA_R + 3.5 + hash2(i, 2, 5) * 6;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (Math.abs(x - this.camX) > viewR + 6 || Math.abs(y - this.camY) > viewR + 6) continue;
      const s = 2.2 + hash2(i, 3, 5) * 2.4;
      ctx.fillStyle = '#071410';
      ctx.beginPath();
      ctx.arc(x, y, s, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#0c1f18';
      ctx.beginPath();
      ctx.arc(x - s * 0.25, y - s * 0.3, s * 0.65, 0, TAU);
      ctx.fill();
    }
    // the fallen trees
    const NL = 84;
    for (let i = 0; i < NL; i++) {
      const a = (i / NL) * TAU + (hash2(i, 4, 6) - 0.5) * 0.03;
      const r = ARENA_R + 1.0 + hash2(i, 5, 6) * 0.7;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (Math.abs(x - this.camX) > viewR + 4 || Math.abs(y - this.camY) > viewR + 4) continue;
      const len = 3.2 + hash2(i, 6, 6) * 2.4;
      const th = 0.55 + hash2(i, 7, 6) * 0.35;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + Math.PI / 2 + (hash2(i, 8, 6) - 0.5) * 0.5);
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, th * 0.55, len * 0.55, th * 0.5, 0, 0, TAU);
      ctx.fill();
      // trunk
      const gr = ctx.createLinearGradient(0, -th, 0, th);
      gr.addColorStop(0, '#6b4a30');
      gr.addColorStop(0.5, '#4a3222');
      gr.addColorStop(1, '#2a1b12');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(-len / 2, -th, len, th * 2, th * 0.7) : ctx.rect(-len / 2, -th, len, th * 2);
      ctx.fill();
      ctx.lineWidth = 0.07;
      ctx.strokeStyle = '#150d08';
      ctx.stroke();
      // bark lines and a cut end
      ctx.strokeStyle = 'rgba(20,12,8,0.7)';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) {
        ctx.moveTo(-len * 0.45, k * th * 0.32);
        ctx.lineTo(len * 0.42, k * th * 0.32 + (hash2(i, k + 9, 6) - 0.5) * 0.2);
      }
      ctx.stroke();
      ctx.fillStyle = '#b79366';
      ctx.beginPath();
      ctx.ellipse(len / 2 - 0.05, 0, th * 0.28, th * 0.95, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#6b4a30';
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- gems
  drawGems(scene) {
    const g = scene.gem;
    if (!g || g.n === 0) return;
    const ctx = this.ctx;
    const hidden = scene.hiddenGem;
    const sp = this.sprites;
    const { pr } = this;
    this.screenSpace();
    const anim = scene.anim;
    const T = scene.t;
    for (let i = 0; i < g.n; i++) {
      const id = g.id[i];
      if (hidden && hidden[id & ID_MASK]) continue;
      const x = g.x[i];
      const y = g.y[i];
      if (x < this.view.x0 || x > this.view.x1 || y < this.view.y0 || y > this.view.y1) continue;
      const tier = g.tier[i];
      const c = sp.gem[tier];
      const info = sp.gemInfo[tier];
      if (!c || !info) continue;
      const bob = Math.sin(anim * 3 + id * 1.7) * 0.07;
      const age = T - g.born[i];
      const pop = age < 0.25 && age >= 0 ? 1 + (1 - age / 0.25) * 0.8 : 1;
      const w = (info.s / pr) * pop;
      ctx.drawImage(c, this.sx(x) - w / 2, this.sy(y + bob) - w / 2, w, w);
    }
  }

  drawFlyingGems(scene) {
    const fx = scene.fx;
    if (!fx || fx.fn === 0) return;
    const ctx = this.ctx;
    const sp = this.sprites;
    this.screenSpace();
    for (let i = 0; i < fx.fn; i++) {
      const hero = scene.heroes[fx.fh[i]];
      if (!hero) continue;
      const p = Math.min(1, fx.fage[i] / 0.22);
      const e = p * p * (3 - 2 * p);
      const x = fx.fx0[i] + (hero.x - fx.fx0[i]) * e;
      const y = fx.fy0[i] + (hero.y - 0.4 - fx.fy0[i]) * e - Math.sin(p * Math.PI) * 0.6;
      const tier = fx.ft[i];
      const c = sp.gem[tier];
      const info = sp.gemInfo[tier];
      if (!c) continue;
      const w = (info.s / this.pr) * (1 - 0.4 * e);
      ctx.drawImage(c, this.sx(x) - w / 2, this.sy(y) - w / 2, w, w);
    }
  }

  // ---------------------------------------------------------------- ground effects
  drawAreas(scene) {
    const fighters = scene.fighters;
    if (!fighters) return;
    const ctx = this.ctx;
    this.worldSpace();
    for (let fi = 0; fi < fighters.length; fi++) {
      const f = fighters[fi];
      for (let i = 0; i < f.an; i++) {
        const kind = f.akind[i];
        const p = Math.min(1, f.aage[i] / f.adur[i]);
        const R = f.ar[i];
        const x = f.ax[i];
        const y = f.ay[i];
        if (x < this.view.x0 - R || x > this.view.x1 + R || y < this.view.y0 - R || y > this.view.y1 + R) continue;
        if (kind === A_RING) this.drawPulse(x, y, R * easeOut(p), 1 - p, 'rgba(255,170,60,', 'rgba(255,80,20,', '#ffe2a0', f.aseed[i], true);
        else if (kind === A_NOVA) this.drawPulse(x, y, R * easeOut(p), 1 - p, 'rgba(160,230,255,', 'rgba(60,150,255,', '#e6fbff', f.aseed[i], false);
        else if (kind === A_WAVE) this.drawPulse(x, y, R * easeOut(p), 1 - p, 'rgba(255,240,170,', 'rgba(255,200,60,', '#ffffff', f.aseed[i], false);
        else if (kind === A_RAIN) this.drawRain(x, y, R, f.aage[i], f.adur[i], f.aseed[i]);
      }
    }
  }

  drawPulse(x, y, r, a, c1, c2, edge, seed, flames) {
    const ctx = this.ctx;
    if (r < 0.05) return;
    const gr = ctx.createRadialGradient(x, y, r * 0.35, x, y, r);
    gr.addColorStop(0, c1 + '0)');
    gr.addColorStop(0.7, c1 + (0.22 * a).toFixed(3) + ')');
    gr.addColorStop(1, c2 + (0.6 * a).toFixed(3) + ')');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = Math.min(1, a * 1.4);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 0.14 + 0.1 * a;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    if (this.quality !== 'low') {
      // licks of flame or shards of ice around the edge
      const n = 14;
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + seed * 6;
        const l = 0.25 + rnd(seed * 100 + i) * (flames ? 0.55 : 0.4);
        ctx.moveTo(x + Math.cos(ang) * (r - 0.05), y + Math.sin(ang) * (r - 0.05));
        ctx.lineTo(x + Math.cos(ang + (flames ? 0.12 : 0)) * (r + l), y + Math.sin(ang + (flames ? 0.12 : 0)) * (r + l));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawRain(x, y, R, age, dur, seed) {
    const ctx = this.ctx;
    const fade = age < 0.15 ? age / 0.15 : age > dur - 0.25 ? Math.max(0, (dur - age) / 0.25) : 1;
    ctx.globalAlpha = 0.5 * fade;
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = 0.08;
    ctx.setLineDash([0.3, 0.25]);
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,200,90,0.10)';
    ctx.fill();
    ctx.globalAlpha = fade;
    const n = this.quality === 'low' ? 8 : 16;
    ctx.strokeStyle = '#fff1c4';
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = rnd(seed * 50 + k) * TAU;
      const rr = Math.sqrt(rnd(seed * 70 + k * 3)) * R * 0.95;
      const phase = fract(age / 0.32 + rnd(seed * 90 + k));
      const fall = (1 - phase) * 5.5;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr - fall;
      if (phase > 0.97) continue;
      ctx.moveTo(px - 0.12, py - 0.9);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- monsters and heroes, sorted by depth
  drawEntities(scene) {
    const mon = scene.mon;
    const heroes = scene.heroes;
    const nh = scene.nHeroes;
    const n = mon ? mon.n : 0;
    const ctx = this.ctx;
    const { H, ppu } = this;
    const top = this.camY - H / 2 / ppu - 4;
    const span = H / ppu + 8;
    const counts = this.counts;
    counts.fill(0);
    const total = n + nh;
    const keys = this.keys;
    const order = this.order;
    const B = 512;
    for (let i = 0; i < total; i++) {
      const y = i < n ? mon.y[i] : heroes[i - n].y;
      let k = (((y - top) / span) * B) | 0;
      if (k < 0) k = 0;
      else if (k >= B) k = B - 1;
      keys[i] = k;
      counts[k + 1]++;
    }
    for (let k = 1; k <= B; k++) counts[k] += counts[k - 1];
    for (let i = 0; i < total; i++) order[counts[keys[i]]++] = i;

    const anim = scene.anim;
    const sp = this.sprites;
    const pr = this.pr;
    const flashUntil = scene.flashUntil;
    const fx = scene.focusX;
    const faceR = this.faceR;
    this.screenSpace();
    const x0 = this.view.x0 - 3;
    const x1 = this.view.x1 + 3;
    const y0 = this.view.y0 - 3;
    const y1 = this.view.y1 + 3;
    const crumble = scene.crumble || 0;
    for (let q = 0; q < total; q++) {
      const i = order[q];
      if (i >= n) {
        this.drawHeroEntity(scene, heroes[i - n]);
        continue;
      }
      if (mon.dead[i] === 1) continue;
      const x = mon.x[i];
      const y = mon.y[i];
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const type = mon.type[i];
      const id = mon.id[i] & ID_MASK;
      if (type === T_BOSS) {
        this.drawBoss(scene, i);
        continue;
      }
      const spr = sp.mon[type];
      const info = sp.info[type];
      if (!spr || !info) continue;
      const dx = fx - x;
      if (dx > 0.3) faceR[id] = 1;
      else if (dx < -0.3) faceR[id] = 0;
      const dir = faceR[id] === 1 ? 0 : 1;
      const speed = type === 1 ? 14 : type === 2 ? 3 : 7;
      const ph = anim * speed + id * 0.77;
      const frame = Math.sin(ph) > 0 ? 1 : 0;
      const bob = type === T_DUMMY ? 0 : Math.sin(ph) * 0.045 * (type === 1 ? 2.2 : 1);
      const w = info.w / pr;
      const h = info.h / pr;
      const px = this.sx(x) - info.ox / pr;
      const py = this.sy(y + bob) - info.oy / pr;
      if (mon.elite[i] === 1) {
        // an elite: a golden ring on the ground and a glow
        const r = MON_R[type];
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = '#ffd24a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(this.sx(x), this.sy(y + r * 1.05), r * ppu * 1.2, r * ppu * 0.45, 0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (crumble > 0) ctx.globalAlpha = Math.max(0.15, 1 - crumble * 0.6);
      ctx.drawImage(spr[dir][frame], px, py, w, h);
      if (flashUntil && flashUntil[id] > anim) {
        ctx.globalAlpha = Math.min(1, (flashUntil[id] - anim) * 10);
        ctx.drawImage(sp.white[type][dir][frame], px, py, w, h);
      }
      ctx.globalAlpha = 1;
      if ((type === T_KNIGHT || mon.elite[i] === 1 || type === 3) && mon.hpf[i] < 0.995 && mon.hpf[i] > 0) {
        const bw = MON_R[type] * ppu * 1.8;
        const bx = this.sx(x) - bw / 2;
        const by = this.sy(y - MON_R[type] * 1.9);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, 4);
        ctx.fillStyle = mon.hpf[i] > 0.4 ? '#e8e8e8' : '#ff4a3a';
        ctx.fillRect(bx, by, bw * mon.hpf[i], 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawBoss(scene, i) {
    const mon = scene.mon;
    const ctx = this.ctx;
    const { ppu } = this;
    const anim = scene.anim;
    const id = mon.id[i] & ID_MASK;
    const sx = this.sx(mon.x[i]);
    const sy = this.sy(mon.y[i]);
    const k = ppu * BOSS_ART;
    // a dark aura and the shadow
    ctx.save();
    ctx.translate(sx, sy);
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(0, 0, k * 0.4, 0, 0, k * 2.6);
    gr.addColorStop(0, 'rgba(255,40,60,0.20)');
    gr.addColorStop(1, 'rgba(255,40,60,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(-k * 3, -k * 3, k * 6, k * 6);
    ctx.globalCompositeOperation = 'source-over';
    const bob = Math.sin(anim * 2.2) * 0.04 * k;
    ctx.translate(0, bob);
    ctx.scale(scene.focusX > mon.x[i] ? k : -k, k);
    drawShadow(ctx, 0, 1.15, 1.5, 0.45, 0.5);
    const frame = Math.sin(anim * 3) > 0 ? 1 : 0;
    drawMonster(ctx, T_BOSS, frame);
    const fl = scene.flashUntil ? scene.flashUntil[id] - anim : 0;
    if (fl > 0) {
      ctx.globalAlpha = Math.min(0.9, fl * 8);
      setWhite(true);
      drawMonster(ctx, T_BOSS, frame);
      setWhite(false);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    this.screenSpace();
  }

  drawHeroEntity(scene, h) {
    const ctx = this.ctx;
    const { ppu } = this;
    const s = ppu * HERO_SCALE;
    const x = this.sx(h.x);
    const y = this.sy(h.y);
    const down = h.down;
    // the ground: a shadow and, for me, a ring in my colour
    ctx.save();
    ctx.translate(x, y);
    if (!down) {
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.beginPath();
      ctx.ellipse(0, s * 1.15, s * 0.95, s * 0.34, 0, 0, TAU);
      ctx.fill();
    }
    if (h.isMe && !down) {
      ctx.strokeStyle = h.color;
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, s * 1.15, s * 1.25, s * 0.5, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // revive progress
    if (down && h.rv > 0.01) {
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(0, 0, s * 1.5, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = '#7dffb0';
      ctx.beginPath();
      ctx.arc(0, 0, s * 1.5, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, h.rv));
      ctx.stroke();
    }
    if (down && !h.isMe) {
      // a ghost a teammate can bring back: a plus over its head
      const bob = Math.sin(scene.anim * 3 + h.idx) * 3;
      ctx.fillStyle = '#7dffb0';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      const cy = -s * 3.2 + bob;
      ctx.beginPath();
      ctx.rect(-4, cy - 11, 8, 22);
      ctx.rect(-11, cy - 4, 22, 8);
      ctx.stroke();
      ctx.fill();
    }
    const flicker = h.invuln > 0 && !(scene.fx && scene.fx.reduced) && Math.sin(scene.anim * 40) > 0;
    if (flicker) ctx.globalAlpha = 0.45;
    const lift = down ? Math.sin(scene.anim * 2 + h.idx) * 0.12 * s - s * 0.4 : 0;
    ctx.translate(0, lift);
    ctx.scale(s, s);
    h.art.color = h.color;
    h.art.dark = h.dark;
    h.art.dx = h.dx;
    h.art.dy = h.dy;
    h.art.walk = h.walk;
    h.art.side = h.side;
    h.art.moving = h.moving;
    h.art.ghost = down;
    h.art.t = scene.anim;
    drawHero(ctx, h.art);
    ctx.globalAlpha = 1;
    // a Holy Shield that is ready
    if (h.shield && !down) {
      ctx.restore();
      ctx.save();
      ctx.translate(x, y);
      const a = 0.5 + 0.2 * Math.sin(scene.anim * 4);
      ctx.strokeStyle = `rgba(255,236,150,${a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * TAU + scene.anim * 0.8;
        const px = Math.cos(ang) * s * 1.55;
        const py = Math.sin(ang) * s * 1.55;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = `rgba(255,236,150,${a * 0.12})`;
      ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- weapons drawn over the monsters
  drawWeaponsAbove(scene) {
    const ctx = this.ctx;
    const heroes = scene.heroes;
    const nh = scene.nHeroes;
    this.worldSpace();
    const pos = this.bpos || (this.bpos = new Float32Array(2));
    // spinning blades
    for (let hi = 0; hi < nh; hi++) {
      const h = heroes[hi];
      const lv = h.wl[W_BLADES];
      if (lv <= 0 || h.down) continue;
      const n = BLADES.count[lv - 1];
      const R = BLADES.radius[lv - 1];
      const ang = h.bladeAng;
      // a sweep behind the blades
      ctx.lineWidth = 0.36;
      ctx.strokeStyle = 'rgba(140,220,255,0.18)';
      for (let j = 0; j < n; j++) {
        const a0 = ang + (j / n) * TAU;
        ctx.beginPath();
        ctx.arc(h.x, h.y, R, a0 - 0.9, a0);
        ctx.stroke();
      }
      for (let j = 0; j < n; j++) {
        bladePos(j, n, ang, R, h.x, h.y, pos);
        this.drawBlade(pos[0], pos[1], scene.anim * 13 + j, h.color);
      }
    }
    // bolts
    const fighters = scene.fighters;
    if (fighters) {
      const glow = this.sprites.glow;
      for (let fi = 0; fi < fighters.length; fi++) {
        const f = fighters[fi];
        for (let i = 0; i < f.pn; i++) {
          const x = f.px[i];
          const y = f.py[i];
          if (x < this.view.x0 || x > this.view.x1 || y < this.view.y0 || y > this.view.y1) continue;
          const vx = f.pvx[i];
          const vy = f.pvy[i];
          const sp = Math.hypot(vx, vy) || 1;
          const ux = vx / sp;
          const uy = vy / sp;
          const a = Math.min(1, f.plife[i] * 6);
          ctx.globalAlpha = a;
          const gr = ctx.createLinearGradient(x - ux * 1.1, y - uy * 1.1, x, y);
          gr.addColorStop(0, 'rgba(120,200,255,0)');
          gr.addColorStop(1, 'rgba(160,220,255,0.9)');
          ctx.strokeStyle = gr;
          ctx.lineWidth = 0.26;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x - ux * 1.1, y - uy * 1.1);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.12;
          ctx.beginPath();
          ctx.moveTo(x - ux * 0.35, y - uy * 0.35);
          ctx.lineTo(x, y);
          ctx.stroke();
          if (glow) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = a * 0.8;
            ctx.drawImage(glow, x - 0.7, y - 0.7, 1.4, 1.4);
            ctx.globalCompositeOperation = 'source-over';
          }
        }
        ctx.globalAlpha = 1;
        // lightning
        for (let i = 0; i < f.an; i++) {
          if (f.akind[i] !== A_LIGHTNING) continue;
          const p = f.aage[i] / f.adur[i];
          if (p >= 1) continue;
          this.drawLightning(f.ax[i], f.ay[i], 1 - p, f.aseed[i]);
        }
      }
    }
  }

  drawBlade(x, y, spin, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.1);
    gr.addColorStop(0, 'rgba(160,230,255,0.45)');
    gr.addColorStop(1, 'rgba(160,230,255,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(0, 0, 1.1, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(spin);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const r = i % 2 === 0 ? 0.68 : 0.3;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const sg = ctx.createLinearGradient(-0.6, -0.6, 0.6, 0.6);
    sg.addColorStop(0, '#f3f8ff');
    sg.addColorStop(1, '#7f90ad');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.lineWidth = 0.07;
    ctx.strokeStyle = '#0a0d14';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 0.12, 0, TAU);
    ctx.fillStyle = color || '#7fe0ff';
    ctx.fill();
    ctx.restore();
  }

  drawLightning(x, y, a, seed) {
    const ctx = this.ctx;
    const topY = y - 13;
    const sx = x + (rnd(seed * 31) - 0.5) * 3;
    const segs = 9;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.moveTo(sx, topY);
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        const jx = (rnd(seed * 17 + i * 3.1) - 0.5) * 1.5 * (1 - t * 0.5);
        ctx.lineTo(sx + (x - sx) * t + jx, topY + (y - topY) * t);
      }
      ctx.lineTo(x, y);
      if (pass === 0) {
        ctx.strokeStyle = `rgba(110,170,255,${0.55 * a})`;
        ctx.lineWidth = 0.55;
      } else {
        ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, a * 1.6)})`;
        ctx.lineWidth = 0.16;
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(x, y, 0, x, y, 1.9);
    gr.addColorStop(0, `rgba(200,225,255,${0.9 * a})`);
    gr.addColorStop(1, 'rgba(120,170,255,0)');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(x, y, 1.9, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------- particles and numbers
  drawParticles(scene) {
    const fx = scene.fx;
    if (!fx) return;
    const P = fx.particles;
    if (P.n === 0) return;
    const ctx = this.ctx;
    P.sortByColour();
    this.worldSpace();
    const order = P.order;
    let col = -1;
    // dots, sparks and puffs
    ctx.lineCap = 'round';
    for (let q = 0; q < P.n; q++) {
      const i = order[q];
      const kind = P.kind[i];
      if (kind === K_GLOW || kind === K_RING) continue;
      if (P.col[i] !== col) {
        col = P.col[i];
        ctx.fillStyle = PAL[col];
        ctx.strokeStyle = PAL[col];
      }
      const t = P.life[i] / P.max[i];
      if (kind === K_DOT) {
        const s = P.size[i] * (0.4 + 0.6 * t);
        ctx.globalAlpha = Math.min(1, t * 2);
        ctx.fillRect(P.x[i] - s, P.y[i] - s, s * 2, s * 2);
      } else if (kind === K_SPARK) {
        ctx.globalAlpha = Math.min(1, t * 2.5);
        ctx.lineWidth = P.size[i];
        ctx.beginPath();
        ctx.moveTo(P.x[i], P.y[i]);
        ctx.lineTo(P.x[i] - P.vx[i] * 0.05, P.y[i] - P.vy[i] * 0.05);
        ctx.stroke();
      } else {
        // a puff grows as it fades
        const s = P.size[i] * (1.6 - t * 0.9);
        ctx.globalAlpha = t * 0.45;
        ctx.beginPath();
        ctx.arc(P.x[i], P.y[i], s, 0, TAU);
        ctx.fill();
      }
    }
    // rings
    col = -1;
    for (let q = 0; q < P.n; q++) {
      const i = order[q];
      if (P.kind[i] !== K_RING) continue;
      if (P.col[i] !== col) {
        col = P.col[i];
        ctx.strokeStyle = PAL[col];
      }
      const t = P.life[i] / P.max[i];
      ctx.globalAlpha = Math.min(1, t * 1.6);
      ctx.lineWidth = 0.08 + 0.1 * t;
      ctx.beginPath();
      ctx.arc(P.x[i], P.y[i], P.size[i] * (1 - t * t), 0, TAU);
      ctx.stroke();
    }
    // glows (additive)
    const glow = this.sprites.glow;
    if (glow) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < P.n; i++) {
        if (P.kind[i] !== K_GLOW) continue;
        const t = P.life[i] / P.max[i];
        ctx.globalAlpha = t * 0.7;
        const s = P.size[i] * 2.2;
        ctx.drawImage(glow, P.x[i] - s, P.y[i] - s, s * 2, s * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  drawNumbers(scene) {
    const fx = scene.fx;
    if (!fx) return;
    const N = fx.numbers;
    if (N.n === 0) return;
    const ctx = this.ctx;
    this.screenSpace();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < N.n; i++) {
      const t = N.life[i] / N.max[i];
      const kind = N.kind[i];
      const pop = 1 + Math.max(0, (t - 0.8) * 5) * 0.6;
      const size = (kind === N_CRIT ? 22 : kind === N_HURT ? 24 : 15) * pop;
      ctx.font = `800 ${size.toFixed(1)}px ${FONT}`;
      ctx.globalAlpha = Math.min(1, t * 2.4);
      const x = this.sx(N.x[i]);
      const y = this.sy(N.y[i]);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      const txt = numText(N.val[i]);
      ctx.strokeText(txt, x, y);
      ctx.fillStyle = kind === N_CRIT ? '#ffd24a' : kind === N_HURT ? '#ff5a4a' : kind === N_HEAL ? '#7dffb0' : '#ffffff';
      ctx.fillText(txt, x, y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- the night
  drawNight(scene) {
    const ctx = this.ctx;
    const { W, H, ppu } = this;
    const dark = Math.max(0, Math.min(1, scene.darkness));
    if (dark > 0.01 && this.darkCtx) {
      const g = this.darkCtx;
      const dw = this.dark.width;
      const dh = this.dark.height;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, dw, dh);
      g.fillStyle = `rgba(3,9,24,${(0.58 * dark).toFixed(3)})`;
      g.fillRect(0, 0, dw, dh);
      g.globalCompositeOperation = 'destination-out';
      const kx = dw / W;
      const ky = dh / H;
      const light = (wx, wy, r, a) => {
        const sx = (wx - this.camX) * ppu * kx + dw / 2;
        const sy = (wy - this.camY) * ppu * ky + dh / 2;
        const rr = r * ppu * kx;
        const gr = g.createRadialGradient(sx, sy, rr * 0.08, sx, sy, rr);
        gr.addColorStop(0, `rgba(0,0,0,${a})`);
        gr.addColorStop(0.5, `rgba(0,0,0,${a * 0.62})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
      };
      for (let i = 0; i < scene.nHeroes; i++) {
        const h = scene.heroes[i];
        light(h.x, h.y, h.down ? 3 : 11, h.down ? 0.5 : 0.97);
      }
      if (this.quality !== 'low' && scene.fighters) {
        let lights = 0;
        for (let fi = 0; fi < scene.fighters.length && lights < 14; fi++) {
          const f = scene.fighters[fi];
          for (let i = 0; i < f.an && lights < 14; i++) {
            const k = f.akind[i];
            if (k === A_LIGHTNING) light(f.ax[i], f.ay[i], 6, 0.9 * (1 - f.aage[i] / f.adur[i]));
            else if (k === A_RING || k === A_NOVA) light(f.ax[i], f.ay[i], f.ar[i] * 1.6, 0.5 * (1 - f.aage[i] / f.adur[i]));
            else continue;
            lights++;
          }
          for (let i = 0; i < f.pn && lights < 20; i++) {
            light(f.px[i], f.py[i], 2.2, 0.55);
            lights++;
          }
        }
      }
      // gems and elites glow in the dark
      const gem = scene.gem;
      if (gem && this.lightDot && this.quality !== 'low') {
        g.globalAlpha = 0.8;
        const rr = 1.5 * ppu * kx;
        for (let i = 0; i < gem.n; i++) {
          const gx = (gem.x[i] - this.camX) * ppu * kx + dw / 2;
          const gy = (gem.y[i] - this.camY) * ppu * ky + dh / 2;
          if (gx < -rr || gx > dw + rr || gy < -rr || gy > dh + rr) continue;
          g.drawImage(this.lightDot, gx - rr, gy - rr, rr * 2, rr * 2);
        }
        g.globalAlpha = 1;
      }
      // the boss's eyes
      if (scene.mon && scene.mon.boss >= 0 && scene.mon.dead[scene.mon.boss] !== 1) {
        const b = scene.mon.boss;
        light(scene.mon.x[b], scene.mon.y[b], 7, 0.5);
      }
      g.globalCompositeOperation = 'source-over';
      ctx.setTransform(this.pr, 0, 0, this.pr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.dark, 0, 0, W, H);
      // a cool glow of each hero's colour on the ground
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < scene.nHeroes; i++) {
        const h = scene.heroes[i];
        if (h.down) continue;
        const sx = this.sx(h.x);
        const sy = this.sy(h.y + 0.5);
        const r = ppu * 5;
        const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        gr.addColorStop(0, hexA(h.color, 0.16 * dark));
        gr.addColorStop(1, hexA(h.color, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    // dawn: warm light from above
    const dawn = scene.dawn || 0;
    if (dawn > 0.01) {
      ctx.setTransform(this.pr, 0, 0, this.pr, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, `rgba(255,190,110,${0.38 * dawn})`);
      gr.addColorStop(0.6, `rgba(255,170,90,${0.12 * dawn})`);
      gr.addColorStop(1, `rgba(255,150,80,${0.04 * dawn})`);
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    // the vignette
    ctx.setTransform(this.pr, 0, 0, this.pr, 0, 0);
    ctx.globalAlpha = 1 - 0.5 * dawn;
    ctx.drawImage(this.vig, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- names, bars and markers over heroes
  drawNames(scene) {
    const ctx = this.ctx;
    const { ppu } = this;
    this.screenSpace();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < scene.nHeroes; i++) {
      const h = scene.heroes[i];
      const x = this.sx(h.x);
      const bottom = this.sy(h.y) + ppu * HERO_SCALE * 1.5;
      // health bar under the feet
      if (!h.down && h.maxHp > 0 && !scene.noBars) {
        const bw = Math.max(34, ppu * 1.5);
        const f = Math.max(0, Math.min(1, h.hp / h.maxHp));
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(x - bw / 2 - 1.5, bottom - 1.5, bw + 3, 7);
        ctx.fillStyle = f > 0.5 ? '#7be05b' : f > 0.25 ? '#ffb92e' : '#ff4a3a';
        ctx.fillRect(x - bw / 2, bottom, bw * f, 4);
      }
      if (h.isMe) {
        if (h.ready) this.drawReady(x, this.sy(h.y) - ppu * HERO_SCALE * 3.0 - 14);
        if (scene.youArrow > 0) {
          const bounce = Math.sin(scene.anim * 6) * 4;
          const ty = this.sy(h.y) - ppu * HERO_SCALE * 3.6 - 18 + bounce;
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = 'rgba(0,0,0,0.8)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x, ty + 12);
          ctx.lineTo(x - 10, ty - 2);
          ctx.lineTo(x + 10, ty - 2);
          ctx.closePath();
          ctx.stroke();
          ctx.fill();
        }
        continue;
      }
      if (scene.noNames || !h.name) continue;
      // name tag: small avatar head and the name
      const ty = this.sy(h.y) - ppu * HERO_SCALE * 3.0 - 12;
      ctx.font = `700 13px ${FONT}`;
      const name = h.name || '';
      const tw = ctx.measureText(name).width;
      const total = tw + 22;
      let cx = x - total / 2;
      ctx.fillStyle = 'rgba(8,12,16,0.72)';
      ctx.fillRect(cx - 4, ty - 10, total + 8, 20);
      ctx.fillStyle = h.color;
      ctx.fillRect(cx - 4, ty - 10, 3, 20);
      this.drawAvatar(h, cx + 8, ty, 8);
      cx += 20;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, cx, ty + 1);
      ctx.textAlign = 'center';
      if (h.away) {
        ctx.fillStyle = '#ffd24a';
        ctx.fillText('...', x, ty - 18);
      }
      if (h.ready) this.drawReady(x, ty - 22);
    }
  }

  drawAvatar(h, x, y, r) {
    const ctx = this.ctx;
    const img = h.avatar;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = h.color;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = '#0a0d14';
      ctx.font = `800 ${Math.round(r * 1.3)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText((h.name || '?').slice(0, 1).toUpperCase(), x, y + 1);
    }
    ctx.restore();
  }

  drawReady(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = '#35d07f';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x - 1, y + 3.5);
    ctx.lineTo(x + 5, y - 3.5);
    ctx.stroke();
  }

  drawScreenFx(scene) {
    const fx = scene.fx;
    if (!fx) return;
    const ctx = this.ctx;
    const { W, H } = this;
    ctx.setTransform(this.pr, 0, 0, this.pr, 0, 0);
    if (fx.redPulse > 0.01 && this.red) {
      ctx.globalAlpha = Math.min(1, fx.redPulse) * 0.6;
      ctx.drawImage(this.red, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (fx.flash > 0.01) {
      ctx.globalAlpha = Math.min(1, fx.flash);
      ctx.fillStyle = PAL[fx.flashCol] || '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }
}

export { HERO_SCALE };
