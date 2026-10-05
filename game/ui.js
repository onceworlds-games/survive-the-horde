// Every screen drawn on the canvas: title, lobby bits, countdown, HUD, level-up cards and results. Flat dark panels with
// a thin edge, uppercase labels of one to three words, big numerals. Buttons register hit regions for taps.
import { MAX_LEVEL, WEAPON_DEFS, PASSIVE_DEFS, U_PASSIVE_BASE, U_RECOVER, BOSS_BEFORE_END } from './data.js';
import { FONT } from './render.js';

const TAU = Math.PI * 2;
const GOLD = '#ffb23e';
const RED = '#ff4a3a';
const PANEL = 'rgba(9,13,20,0.80)';
const EDGE = 'rgba(255,255,255,0.14)';
const DIM = 'rgba(255,255,255,0.62)';

const ICON_COLORS = {
  0: '#7fc8ff', 1: '#d0e4ff', 2: '#ff8a3a', 3: '#ffe45a', 4: '#ffd88a', 5: '#8fe6ff', 6: '#ffe9a0',
  10: '#ff6a7a', 11: '#7dffb0', 12: '#c06bff', 13: '#6fd8ff', 14: '#ff5a3a', 15: '#7be05b', 20: '#ff6a7a',
};
export const upgradeColor = (id) => ICON_COLORS[id] ?? '#ffffff';

export function upgradeName(id) {
  if (id === U_RECOVER) return 'RECOVER';
  if (id >= U_PASSIVE_BASE) return (PASSIVE_DEFS[id - U_PASSIVE_BASE]?.name ?? '').toUpperCase();
  return (WEAPON_DEFS[id]?.name ?? '').toUpperCase();
}

export function upgradeDelta(id, nextLevel) {
  if (id === U_RECOVER) return '+40% HP';
  if (id >= U_PASSIVE_BASE) return PASSIVE_DEFS[id - U_PASSIVE_BASE]?.delta ?? '';
  return WEAPON_DEFS[id]?.deltas[Math.max(0, Math.min(4, nextLevel - 1))] ?? '';
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

export class UI {
  constructor() {
    this.W = 640;
    this.H = 360;
    this.u = 1;
    this.btn = []; // hit regions: { x, y, w, h, id, i }
    this.nbtn = 0;
    for (let i = 0; i < 24; i++) this.btn.push({ x: 0, y: 0, w: 0, h: 0, id: '', i: 0 });
    this.hover = '';
  }

  layout(W, H) {
    this.W = W;
    this.H = H;
    this.u = Math.max(0.7, Math.min(1.4, Math.min(W / 1280, H / 720)));
  }

  begin() {
    this.nbtn = 0;
  }

  region(x, y, w, h, id, i = 0) {
    if (this.nbtn >= this.btn.length) return;
    const b = this.btn[this.nbtn++];
    b.x = x;
    b.y = y;
    b.w = w;
    b.h = h;
    b.id = id;
    b.i = i;
  }

  /** The topmost region at (x, y), or null. */
  hit(x, y) {
    for (let k = this.nbtn - 1; k >= 0; k--) {
      const b = this.btn[k];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  // ---------------------------------------------------------------- helpers
  text(ctx, s, x, y, size, o = {}) {
    ctx.font = `${o.weight ?? 800} ${size.toFixed(1)}px ${FONT}`;
    ctx.textAlign = o.align ?? 'center';
    ctx.textBaseline = o.base ?? 'middle';
    ctx.lineJoin = 'round';
    if (o.ls && 'letterSpacing' in ctx) ctx.letterSpacing = `${o.ls}px`;
    if (o.stroke !== 0) {
      ctx.lineWidth = o.strokeW ?? Math.max(2.5, size * 0.16);
      ctx.strokeStyle = o.strokeColor ?? 'rgba(0,0,0,0.85)';
      ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = o.color ?? '#ffffff';
    ctx.fillText(s, x, y);
    if (o.ls && 'letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  panel(ctx, x, y, w, h, edge = EDGE, accent = null) {
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (accent) {
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, w, Math.max(2, 3 * this.u));
    }
  }

  // ---------------------------------------------------------------- glyphs (0..1 box centred at x, y)
  icon(ctx, id, x, y, size, color) {
    const s = size / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.14;
    ctx.strokeStyle = '#0a0d14';
    ctx.fillStyle = color;
    switch (id) {
      case 0: // magic bolt: an orb with a streak
        ctx.beginPath();
        ctx.moveTo(-0.9, 0.6);
        ctx.lineTo(0.1, -0.1);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 0.3;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#0a0d14';
        ctx.lineWidth = 0.14;
        ctx.beginPath();
        ctx.arc(0.3, -0.3, 0.42, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0.22, -0.38, 0.14, 0, TAU);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        break;
      case 1: // blades: a spinning star
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU - 0.3;
          const r = i % 2 === 0 ? 0.95 : 0.4;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 0.16, 0, TAU);
        ctx.fillStyle = '#0a0d14';
        ctx.fill();
        break;
      case 2: // fire ring
        ctx.beginPath();
        ctx.arc(0, 0.1, 0.62, 0, TAU);
        ctx.lineWidth = 0.3;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.fillStyle = '#ffd24a';
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.55;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 0.5, 0.1 + Math.sin(a) * 0.5);
          ctx.lineTo(Math.cos(a + 0.12) * 0.92, 0.1 + Math.sin(a + 0.12) * 0.92 - 0.1);
          ctx.lineTo(Math.cos(a + 0.28) * 0.5, 0.1 + Math.sin(a + 0.28) * 0.5);
          ctx.fill();
        }
        break;
      case 3: // lightning
        ctx.beginPath();
        ctx.moveTo(0.25, -0.95);
        ctx.lineTo(-0.5, 0.1);
        ctx.lineTo(-0.05, 0.1);
        ctx.lineTo(-0.3, 0.95);
        ctx.lineTo(0.55, -0.15);
        ctx.lineTo(0.1, -0.15);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case 4: // arrow rain
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.14;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * 0.55 - 0.3, -0.9 + Math.abs(i) * 0.25);
          ctx.lineTo(i * 0.55 + 0.1, 0.55 + Math.abs(i) * 0.1);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(i * 0.55 + 0.1, 0.7 + Math.abs(i) * 0.1);
          ctx.lineTo(i * 0.55 - 0.1, 0.35 + Math.abs(i) * 0.1);
          ctx.lineTo(i * 0.55 + 0.3, 0.4 + Math.abs(i) * 0.1);
          ctx.closePath();
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
        break;
      case 5: // frost nova: a snowflake
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.17;
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 0.9, Math.sin(a) * 0.9);
          ctx.lineTo(-Math.cos(a) * 0.9, -Math.sin(a) * 0.9);
          ctx.stroke();
        }
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, 0.2, 0, TAU);
        ctx.fill();
        break;
      case 6: // holy shield
        ctx.beginPath();
        ctx.moveTo(0, -0.95);
        ctx.lineTo(0.8, -0.6);
        ctx.quadraticCurveTo(0.8, 0.4, 0, 0.98);
        ctx.quadraticCurveTo(-0.8, 0.4, -0.8, -0.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = '#a8761a';
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.moveTo(0, -0.6);
        ctx.lineTo(0, 0.6);
        ctx.moveTo(-0.45, -0.1);
        ctx.lineTo(0.45, -0.1);
        ctx.stroke();
        break;
      case 10: // max hp: a heart
      case 20:
        ctx.beginPath();
        ctx.moveTo(0, 0.85);
        ctx.bezierCurveTo(-1.1, 0.1, -0.85, -0.85, 0, -0.35);
        ctx.bezierCurveTo(0.85, -0.85, 1.1, 0.1, 0, 0.85);
        ctx.fill();
        ctx.stroke();
        break;
      case 11: // speed: chevrons
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.24;
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.moveTo(-0.6 + i * 0.6, -0.65);
          ctx.lineTo(-0.05 + i * 0.6, 0);
          ctx.lineTo(-0.6 + i * 0.6, 0.65);
          ctx.stroke();
        }
        break;
      case 12: // pickup: a magnet
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.36;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(-0.55, -0.75);
        ctx.lineTo(-0.55, 0.1);
        ctx.arc(0, 0.1, 0.55, Math.PI, 0, true);
        ctx.lineTo(0.55, -0.75);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.2;
        ctx.beginPath();
        ctx.moveTo(-0.55, -0.9);
        ctx.lineTo(-0.55, -0.55);
        ctx.moveTo(0.55, -0.9);
        ctx.lineTo(0.55, -0.55);
        ctx.stroke();
        break;
      case 13: // cooldown: a clock
        ctx.beginPath();
        ctx.arc(0, 0, 0.8, 0, TAU);
        ctx.fillStyle = '#0a0d14';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -0.5);
        ctx.lineTo(0, 0);
        ctx.lineTo(0.38, 0.22);
        ctx.stroke();
        break;
      case 14: // damage: a burst
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          const r = i % 2 === 0 ? 0.98 : 0.48;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 0.22, 0, TAU);
        ctx.fillStyle = '#ffe9a0';
        ctx.fill();
        break;
      case 15: // regen: a plus
        ctx.beginPath();
        ctx.rect(-0.28, -0.85, 0.56, 1.7);
        ctx.rect(-0.85, -0.28, 1.7, 0.56);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-0.28, -0.85);
        ctx.lineTo(0.28, -0.85);
        ctx.lineTo(0.28, -0.28);
        ctx.lineTo(0.85, -0.28);
        ctx.lineTo(0.85, 0.28);
        ctx.lineTo(0.28, 0.28);
        ctx.lineTo(0.28, 0.85);
        ctx.lineTo(-0.28, 0.85);
        ctx.lineTo(-0.28, 0.28);
        ctx.lineTo(-0.85, 0.28);
        ctx.lineTo(-0.85, -0.28);
        ctx.lineTo(-0.28, -0.28);
        ctx.closePath();
        ctx.stroke();
        break;
      default:
        ctx.beginPath();
        ctx.arc(0, 0, 0.7, 0, TAU);
        ctx.fill();
        break;
    }
    ctx.restore();
  }

  skull(ctx, x, y, s, color = '#ffffff') {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#0a0d14';
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.arc(0, -0.1, 0.62, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(-0.32, 0.35, 0.64, 0.38);
    ctx.fillStyle = '#0a0d14';
    ctx.beginPath();
    ctx.arc(-0.24, -0.12, 0.16, 0, TAU);
    ctx.arc(0.24, -0.12, 0.16, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  sun(ctx, x, y, r, color = GOLD) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.55, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
      ctx.lineTo(Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- title
  title(ctx, S) {
    const { W, H, u } = this;
    // a veil for the logo
    const gr = ctx.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(0.5, 'rgba(0,0,0,0.25)');
    gr.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H * 0.37;
    const a = Math.min(1, S.anim * 2.2);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(cx, cy);
    ctx.transform(1, 0, -0.1, 1, 0, 0);
    const big = Math.min(150 * u, W * 0.2);
    this.text(ctx, 'SURVIVE', 0, -big * 0.46, big, { color: '#ffffff', strokeW: big * 0.1, ls: big * 0.03 });
    this.text(ctx, 'THE HORDE', 0, big * 0.5, big * 0.88, { color: '#ff5a2e', strokeW: big * 0.1, ls: big * 0.03 });
    // a slash through the middle
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(3, big * 0.05);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-big * 2.2, big * 0.02);
    ctx.lineTo(-big * 1.5, big * 0.02);
    ctx.moveTo(big * 1.5, big * 0.02);
    ctx.lineTo(big * 2.2, big * 0.02);
    ctx.stroke();
    ctx.restore();
    // the one button
    const bw = Math.max(240, 300 * u);
    const bh = Math.max(64, 84 * u);
    const bx = cx - bw / 2;
    const by = H * 0.68;
    const pulse = 1 + Math.sin(S.anim * 3) * 0.015;
    ctx.save();
    ctx.translate(cx, by + bh / 2);
    ctx.scale(pulse, pulse);
    const hot = this.hover === 'play';
    ctx.fillStyle = hot ? '#ffc25e' : GOLD;
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-bw / 2, -bh / 2, bw, 4);
    ctx.strokeStyle = '#0a0d14';
    ctx.lineWidth = 3;
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    this.text(ctx, 'PLAY', 0, 2, bh * 0.58, { color: '#14100a', stroke: 0, ls: 4 });
    ctx.restore();
    if (!S.touch) {
      this.text(ctx, 'SPACE', cx, by + bh + 22 * u, 15 * u + 2, { color: DIM, weight: 700, ls: 3 });
    }
    this.region(bx, by, bw, bh, 'play');
  }

  // ---------------------------------------------------------------- lobby
  lobby(ctx, S) {
    const { W, u } = this;
    const bw = Math.max(150, 200 * u);
    const bh = Math.max(56, 68 * u);
    const gap = 12 * u;
    const n = S.settings.length;
    const total = n * bw + (n - 1) * gap;
    let x = W / 2 - total / 2;
    const y = Math.max(64, 70 * u);
    for (let i = 0; i < n; i++) {
      const s = S.settings[i];
      const edit = s.editable;
      ctx.fillStyle = PANEL;
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeStyle = edit ? GOLD : EDGE;
      ctx.lineWidth = edit ? 2 : 1;
      ctx.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
      this.text(ctx, s.label, x + bw / 2, y + bh * 0.26, 13 * u + 3, { color: DIM, weight: 700, stroke: 0, ls: 2 });
      this.text(ctx, s.value, x + bw / 2 - (edit ? 6 : 0), y + bh * 0.64, 30 * u + 4, { color: '#ffffff' });
      if (edit) {
        // a small cycle mark on the right
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.moveTo(x + bw - 16 * u, y + bh * 0.64 - 7 * u);
        ctx.lineTo(x + bw - 8 * u, y + bh * 0.64);
        ctx.lineTo(x + bw - 16 * u, y + bh * 0.64 + 7 * u);
        ctx.closePath();
        ctx.fill();
        this.region(x, y, bw, bh, 'setting', i);
      }
      x += bw + gap;
    }
    this.text(ctx, S.hint, W / 2, y + bh + 22 * u, 17 * u + 2, { color: DIM, weight: 700, ls: 3 });
    if (S.stubStart) {
      // outside Onceworlds there is no Start strip: a button of our own
      const sw = Math.max(200, 240 * u);
      const sh = Math.max(56, 64 * u);
      const sx = W / 2 - sw / 2;
      const sy = this.H - sh - 24;
      ctx.fillStyle = this.hover === 'start' ? '#ffc25e' : GOLD;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = '#0a0d14';
      ctx.lineWidth = 3;
      ctx.strokeRect(sx, sy, sw, sh);
      this.text(ctx, 'START', W / 2, sy + sh / 2 + 1, sh * 0.5, { color: '#14100a', stroke: 0, ls: 3 });
      this.region(sx, sy, sw, sh, 'start');
    }
    if (S.canInvite) {
      const iw = Math.max(118, 140 * u);
      const ih = Math.max(44, 48 * u);
      const ix = W - iw - 14;
      const iy = 14;
      ctx.fillStyle = PANEL;
      ctx.fillRect(ix, iy, iw, ih);
      ctx.strokeStyle = this.hover === 'invite' ? GOLD : EDGE;
      ctx.lineWidth = 1;
      ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
      this.text(ctx, '+ INVITE', ix + iw / 2, iy + ih / 2 + 1, 20 * u + 2, { ls: 2 });
      this.region(ix, iy, iw, ih, 'invite');
    }
  }

  // ---------------------------------------------------------------- the countdown
  countdown(ctx, S) {
    const { W, H, u } = this;
    const n = S.count;
    const label = n <= 0 ? 'GO' : String(n);
    const f = S.countFrac; // 0..1 within this second
    const pop = 1 + Math.max(0, 1 - f * 4) * 0.5;
    const size = Math.min(H * 0.34, 260 * u) * pop;
    ctx.globalAlpha = n <= 0 ? Math.max(0, 1 - f * 1.1) : 1;
    this.text(ctx, label, W / 2, H * 0.4, size, { color: n <= 0 ? GOLD : '#ffffff', strokeW: size * 0.07 });
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- the HUD
  hud(ctx, S) {
    const { W, H, u } = this;
    // XP bar along the top edge, clear of the platform's buttons on the left
    const x0 = 136;
    const bw = W - x0 - 10;
    const bh = Math.max(7, 9 * u);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x0, 0, bw, bh);
    const xf = Math.max(0, Math.min(1, S.xpFrac));
    const g = ctx.createLinearGradient(x0, 0, x0 + bw, 0);
    g.addColorStop(0, '#2fd0a0');
    g.addColorStop(1, '#6dffb8');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, bw * xf, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x0, 0, bw * xf, 2);

    // the clock to dawn, the night's progress and the boss mark
    const cx = W / 2;
    const ty = bh + 8 + 20 * u;
    const remain = Math.max(0, S.length - S.t);
    this.sun(ctx, cx - 62 * u - 4, ty, 11 * u + 3, S.t > S.length - 15 ? '#ffe28a' : GOLD);
    this.text(ctx, fmtTime(remain), cx + 10, ty + 1, 36 * u + 4, { color: S.t > S.length - BOSS_BEFORE_END ? '#ff8a7a' : '#ffffff' });
    const pw = Math.min(240 * u + 40, W * 0.34);
    const py = ty + 22 * u + 4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(cx - pw / 2, py, pw, 5);
    ctx.fillStyle = GOLD;
    ctx.fillRect(cx - pw / 2, py, pw * Math.max(0, Math.min(1, S.t / S.length)), 5);
    const bossX = cx - pw / 2 + pw * ((S.length - BOSS_BEFORE_END) / S.length);
    this.skull(ctx, bossX, py + 2.5, 7 * u + 2, S.boss && S.boss.on ? '#ff4a3a' : '#d8d2c4');

    // my health, level and kills: top right (below the clock on a narrow screen)
    const pw2 = Math.max(180, 232 * u);
    const narrow = W < 560;
    const px = narrow ? W / 2 - pw2 / 2 : W - pw2 - 12;
    const pyy = narrow ? py + 18 * u + 12 : bh + 8;

    // the Night Warden's health
    if (S.boss && S.boss.on) {
      const room = narrow ? W - 24 : 2 * (px - 16 - cx);
      const w = Math.max(120, Math.min(460 * u + 60, room));
      const bx = cx - w / 2;
      const by = narrow ? pyy + 56 * u + 14 + S.mates.length * (28 * u + 4) : py + 22 * u;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(bx - 2, by - 2, w + 4, 16 * u + 6);
      ctx.fillStyle = '#ff2a3a';
      ctx.fillRect(bx, by, w * Math.max(0, Math.min(1, S.boss.frac)), 16 * u + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(bx, by, w * Math.max(0, Math.min(1, S.boss.frac)), 3);
      this.text(ctx, 'NIGHT WARDEN', cx, by + 8 * u + 1, 14 * u + 3, { ls: 3 });
    }

    this.panel(ctx, px, pyy, pw2, 56 * u + 8);
    const hf = Math.max(0, Math.min(1, S.hp / Math.max(1, S.maxHp)));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(px + 10, pyy + 10, pw2 - 20, 18 * u + 2);
    ctx.fillStyle = hf > 0.5 ? '#6fdc4a' : hf > 0.25 ? '#ffb92e' : '#ff4a3a';
    ctx.fillRect(px + 10, pyy + 10, (pw2 - 20) * hf, 18 * u + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(px + 10, pyy + 10, (pw2 - 20) * hf, 3);
    this.text(ctx, `${Math.ceil(S.hp)}`, px + pw2 / 2, pyy + 19 * u + 1, 15 * u + 4, { weight: 800 });
    const ry = pyy + 40 * u + 4;
    this.text(ctx, `LV ${S.level}`, px + 12, ry, 22 * u + 2, { align: 'left', color: GOLD });
    this.skull(ctx, px + pw2 - 74 * u - 6, ry, 9 * u + 2, '#e9e3cf');
    this.text(ctx, `${S.kills}`, px + pw2 - 12, ry, 22 * u + 2, { align: 'right' });
    // the others, small
    let my = pyy + 56 * u + 14;
    for (let i = 0; i < S.mates.length; i++) {
      const m = S.mates[i];
      ctx.fillStyle = PANEL;
      ctx.fillRect(px, my, pw2, 24 * u + 4);
      ctx.fillStyle = m.color;
      ctx.fillRect(px, my, 3, 24 * u + 4);
      this.text(ctx, m.name, px + 10, my + 12 * u + 2, 14 * u + 2, { align: 'left', weight: 700 });
      const w = pw2 * 0.4;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(px + pw2 - w - 8, my + 8 * u, w, 8 * u);
      ctx.fillStyle = m.down ? '#7aa8c8' : '#6fdc4a';
      ctx.fillRect(px + pw2 - w - 8, my + 8 * u, w * (m.down ? m.rv : Math.max(0, Math.min(1, m.hp))), 8 * u);
      if (m.down) this.text(ctx, 'DOWN', px + pw2 - w - 14, my + 12 * u + 2, 12 * u + 2, { align: 'right', color: '#9cd0f0', weight: 700 });
      my += 28 * u + 4;
    }

    // weapons and passives, bottom centre
    this.loadout(ctx, S);

    // a callout in the middle of the screen
    const c = S.callout;
    if (c && c.age < c.dur) {
      const p = c.age / c.dur;
      const pop = 1 + Math.max(0, 0.25 - c.age) * 3;
      const al = p < 0.12 ? p / 0.12 : p > 0.75 ? Math.max(0, (1 - p) / 0.25) : 1;
      ctx.globalAlpha = al;
      this.text(ctx, c.text, W / 2, H * 0.26, (c.size ?? 54) * u * pop + 6, { color: c.color ?? '#ffffff', ls: 5 });
      ctx.globalAlpha = 1;
    }
    if (S.down) {
      this.text(ctx, 'DOWN', W / 2, H * 0.42, 70 * u + 8, { color: '#9cd0f0', ls: 6 });
    }
  }

  loadout(ctx, S) {
    const { W, H, u } = this;
    const gap = 6 * u + 2;
    const slots = 10;
    const sz = Math.max(20, Math.min(Math.max(30, 38 * u), (W - 16 - 14 * u - (slots - 1) * gap) / slots));
    const total = slots * sz + (slots - 1) * gap + 14 * u;
    let x = W / 2 - total / 2;
    const y = H - sz - Math.max(10, 14 * u);
    for (let i = 0; i < slots; i++) {
      const isW = i < 5;
      if (i === 5) x += 14 * u;
      const arr = isW ? S.weapons : S.passives;
      const id = arr[isW ? i : i - 5];
      ctx.fillStyle = id ? PANEL : 'rgba(9,13,20,0.4)';
      ctx.fillRect(x, y, sz, sz);
      ctx.strokeStyle = id ? upgradeColor(id.id) : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = id ? 2 : 1;
      ctx.strokeRect(x + 1, y + 1, sz - 2, sz - 2);
      if (id) {
        this.icon(ctx, id.id, x + sz / 2, y + sz / 2 - 2, sz * 0.62, upgradeColor(id.id));
        for (let p = 0; p < MAX_LEVEL; p++) {
          ctx.fillStyle = p < id.lv ? upgradeColor(id.id) : 'rgba(255,255,255,0.18)';
          ctx.fillRect(x + 4 + p * ((sz - 8) / MAX_LEVEL), y + sz - 5, (sz - 8) / MAX_LEVEL - 1.5, 3);
        }
      }
      x += sz + gap;
    }
  }

  // ---------------------------------------------------------------- level-up cards
  cards(ctx, S) {
    const o = S.offer;
    if (!o) return;
    const { W, H, u } = this;
    const n = o.n;
    const gap = 14 * u;
    const margin = S.touch ? 214 : 20;
    const avail = W - margin - 20;
    const cw = Math.max(96, Math.min(232 * u + 20, (avail - gap * (n - 1)) / n));
    const ch = Math.max(132, Math.min(172 * u + 12, H * 0.34));
    const total = n * cw + (n - 1) * gap;
    const x0 = S.touch ? margin + (avail - total) / 2 : W / 2 - total / 2;
    const slotH = Math.max(20, Math.min(Math.max(30, 38 * u), (W - 16 - 14 * u - 9 * (6 * u + 2)) / 10));
    const y = S.touch ? Math.max(70, H / 2 - ch / 2 + 14) : H - ch - Math.max(10, 14 * u) - slotH - 20 * u - 22;
    this.text(ctx, 'LEVEL UP', W / 2, y - 30 * u, 34 * u + 4, { color: GOLD, ls: 5 });
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (cw + gap);
      const id = o.ids[i];
      const col = upgradeColor(id);
      const hot = this.hover === `card${i}`;
      ctx.fillStyle = hot ? 'rgba(20,28,40,0.95)' : 'rgba(9,13,20,0.9)';
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = hot ? col : EDGE;
      ctx.lineWidth = hot ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
      ctx.fillStyle = col;
      ctx.fillRect(x, y, cw, 4);
      // key hint
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 8, y + 12, 22 * u + 4, 22 * u + 4);
      this.text(ctx, String(i + 1), x + 8 + (22 * u + 4) / 2, y + 12 + (22 * u + 4) / 2 + 1, 16 * u + 4, { color: DIM, stroke: 0 });
      this.icon(ctx, id, x + cw / 2, y + ch * 0.3, Math.min(54 * u + 8, ch * 0.34), col);
      this.text(ctx, upgradeName(id), x + cw / 2, y + ch * 0.58, Math.min(24 * u + 4, cw / 7.2), { ls: 1 });
      const cur = o.levels[i];
      this.text(ctx, upgradeDelta(id, cur + 1), x + cw / 2, y + ch * 0.74, Math.min(16 * u + 3, cw / 10), { color: col, weight: 700, ls: 1 });
      // level pips: what it has, and the one it gets
      const pw = 12 * u + 2;
      const pg = 5 * u;
      const px = x + cw / 2 - (MAX_LEVEL * pw + (MAX_LEVEL - 1) * pg) / 2;
      for (let p = 0; p < MAX_LEVEL; p++) {
        ctx.fillStyle = p < cur ? col : p === cur ? '#ffffff' : 'rgba(255,255,255,0.16)';
        ctx.fillRect(px + p * (pw + pg), y + ch - 20 * u - 4, pw, 6 * u + 1);
      }
      if (cur === 0 && id !== U_RECOVER) {
        // the NEW tag sits on a small gold plate
        ctx.fillStyle = GOLD;
        const tw = 44 * u;
        ctx.fillRect(x + cw - tw - 8, y + 12, tw, 22 * u + 4);
        this.text(ctx, 'NEW', x + cw - tw / 2 - 8, y + 12 + (22 * u + 4) / 2 + 1, 14 * u + 2, { color: '#14100a', stroke: 0 });
      }
      this.region(x, y, cw, ch, 'card', i);
    }
    // co-op: the pick is made for you when the bar runs out
    if (o.timer >= 0) {
      const bw = total;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x0, y + ch + 8, bw, 5);
      ctx.fillStyle = GOLD;
      ctx.fillRect(x0, y + ch + 8, bw * Math.max(0, Math.min(1, o.timer)), 5);
    }
  }

  // ---------------------------------------------------------------- results
  results(ctx, S) {
    const r = S.res;
    if (!r) return;
    const { W, H, u } = this;
    const win = r.result === 'dawn';
    const slide = Math.min(1, r.age / 0.5);
    const e = 1 - Math.pow(1 - slide, 3);
    const rows = r.rows.length > 1 ? r.rows.length : 0;
    const pw = Math.min(W - 24, 600 * u + 40);
    const ph = (230 + rows * 38) * u + 40;
    const x = W / 2 - pw / 2;
    const y = Math.max(54, H / 2 - ph / 2 - 20) + (1 - e) * 40;
    ctx.globalAlpha = e;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, H);
    this.panel(ctx, x, y, pw, ph, EDGE, win ? GOLD : RED);
    this.text(ctx, win ? 'DAWN' : 'DEFEAT', W / 2, y + 62 * u + 6, 92 * u + 8, { color: win ? '#ffe28a' : '#ff6a5a', ls: 8, strokeW: 8 });
    if (win) this.sun(ctx, W / 2 - 150 * u - 50, y + 62 * u + 6, 26 * u + 6);
    const cols = [
      ['TIME', fmtTime(r.time)],
      ['KILLS', String(r.kills)],
      ['LEVEL', String(r.level)],
    ];
    const cw = pw / 3;
    for (let i = 0; i < 3; i++) {
      this.text(ctx, cols[i][1], x + cw * i + cw / 2, y + 140 * u + 10, 52 * u + 6, { color: '#ffffff' });
      this.text(ctx, cols[i][0], x + cw * i + cw / 2, y + 180 * u + 8, 15 * u + 3, { color: DIM, weight: 700, ls: 3, stroke: 0 });
    }
    let ry = y + 214 * u + 14;
    for (let i = 0; i < rows; i++) {
      const row = r.rows[i];
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x + 16, ry, pw - 32, 32 * u + 2);
      ctx.fillStyle = row.color;
      ctx.fillRect(x + 16, ry, 3, 32 * u + 2);
      this.avatar(ctx, row, x + 40, ry + 16 * u + 1, 11 * u + 2);
      this.text(ctx, row.name, x + 60 * u, ry + 17 * u + 1, 20 * u + 2, { align: 'left', weight: 700 });
      this.text(ctx, `LV ${row.level}`, x + pw - 150 * u, ry + 17 * u + 1, 18 * u + 2, { align: 'right', color: GOLD });
      this.skull(ctx, x + pw - 112 * u, ry + 17 * u, 8 * u + 2, '#e9e3cf');
      this.text(ctx, String(row.kills), x + pw - 24, ry + 17 * u + 1, 20 * u + 2, { align: 'right' });
      ry += 38 * u;
    }
    if (r.again) {
      const bw = Math.max(180, 220 * u);
      const bh = Math.max(48, 56 * u);
      const bx = W / 2 - bw / 2;
      const by = y + ph + 16;
      ctx.fillStyle = this.hover === 'again' ? '#ffc25e' : GOLD;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#0a0d14';
      ctx.lineWidth = 3;
      ctx.strokeRect(bx, by, bw, bh);
      this.text(ctx, 'AGAIN', W / 2, by + bh / 2 + 1, bh * 0.52, { color: '#14100a', stroke: 0, ls: 3 });
      this.region(bx, by, bw, bh, 'again');
    }
    ctx.globalAlpha = 1;
  }

  avatar(ctx, row, x, y, r) {
    const img = row.avatar;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    if (img && img.complete && img.naturalWidth > 0) ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    else {
      ctx.fillStyle = row.color;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      this.text(ctx, (row.name || '?').slice(0, 1).toUpperCase(), x, y + 1, r * 1.3, { color: '#0a0d14', stroke: 0 });
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- the room closed
  closed(ctx, S) {
    const { W, H, u } = this;
    ctx.fillStyle = 'rgba(4,7,12,0.88)';
    ctx.fillRect(0, 0, W, H);
    this.text(ctx, S.closedText, W / 2, H * 0.4, 46 * u + 8, { ls: 4 });
    const bw = Math.max(220, 260 * u);
    const bh = Math.max(56, 68 * u);
    const bx = W / 2 - bw / 2;
    const by = H * 0.55;
    ctx.fillStyle = this.hover === 'rejoin' ? '#ffc25e' : GOLD;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#0a0d14';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, bw, bh);
    this.text(ctx, S.closedButton, W / 2, by + bh / 2 + 1, bh * 0.5, { color: '#14100a', stroke: 0, ls: 3 });
    this.region(bx, by, bw, bh, 'rejoin');
  }

  // ---------------------------------------------------------------- small labels
  banner(ctx, text, sub) {
    const { W, H, u } = this;
    this.text(ctx, text, W / 2, H * 0.12, 22 * u + 6, { ls: 4 });
    if (sub) this.text(ctx, sub, W / 2, H * 0.12 + 26 * u, 14 * u + 3, { color: DIM, weight: 700, ls: 2 });
  }

  /** Bottom centre label for someone watching a run. */
  watching(ctx, name, color) {
    const { W, H, u } = this;
    const w = Math.max(200, 260 * u);
    const h = Math.max(44, 50 * u);
    const x = W / 2 - w / 2;
    const y = H - h - 16;
    ctx.fillStyle = PANEL;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 3, h);
    this.text(ctx, 'WATCHING', x + 16, y + h * 0.32, 13 * u + 3, { align: 'left', color: DIM, weight: 700, ls: 3, stroke: 0 });
    this.text(ctx, name, x + 16, y + h * 0.7, 21 * u + 3, { align: 'left' });
    this.region(x, y, w, h, 'switch');
  }

  /** A quiet label, e.g. "TAP FOR SOUND". */
  tip(ctx, text) {
    const { W, u } = this;
    const w = Math.max(190, 230 * u);
    const h = Math.max(36, 40 * u);
    ctx.fillStyle = PANEL;
    ctx.fillRect(W / 2 - w / 2, 70 * u + 40, w, h);
    this.text(ctx, text, W / 2, 70 * u + 40 + h / 2 + 1, 17 * u + 3, { ls: 3 });
  }
}
